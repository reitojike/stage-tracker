// Shared DB-dependent orchestration for the TicketOpportunity official import
// (Issue #163). Shape-only validation lives in ticketOpportunitySeed.mjs;
// everything here needs a Supabase admin client because it resolves seed
// locators (Event source_key, Occurrence startsAt) against the current
// catalog and diffs against whatever ticket_opportunities/milestones/
// target-occurrences already exist for the same opportunity source_key.
//
// The only write path this module ever calls is the service_role-only
// import_ticket_opportunity RPC (supabase/migrations/
// 20260828000300_create_import_ticket_opportunity_rpc.sql) - nothing here
// issues a raw INSERT/UPDATE/DELETE against ticket_opportunities/
// ticket_opportunity_target_occurrences/ticket_opportunity_milestones, and
// nothing here ever touches user_ticket_opportunity_states.

import { validateSeedEntryShape } from './ticketOpportunitySeed.mjs';

/**
 * Shape-validates already-loaded raw seed entries. File and directory
 * loading intentionally stays with the caller (the CLI today, a workflow
 * document loader later). Every entry is checked before any DB lookup
 * happens, so a malformed entry deep in a large run is reported without
 * contacting the database (#163 "全seed validationをwrite前に完了").
 *
 * `rawEntries` contains `{ raw, where }` pairs so callers can preserve their
 * own source locator in validation messages. It returns
 * `{ ok: true, entries }` or `{ ok: false, problems }` and never throws for
 * a seed data problem.
 */
export function validateSeedEntries(rawEntries) {
  const problems = [];
  const entries = [];

  for (const { raw, where } of rawEntries) {
    const result = validateSeedEntryShape(raw, where);
    if (result.ok) {
      entries.push(result.entry);
    } else {
      problems.push(...result.problems);
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const duplicateKeys = entries
    .map((entry) => entry.sourceKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    return {
      ok: false,
      problems: [
        `Duplicate opportunity sourceKey across seed files: ${[...new Set(duplicateKeys)].join(', ')}`,
      ],
    };
  }

  return { ok: true, entries };
}

function instantOf(iso) {
  return Date.parse(iso);
}

function sameInstant(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return instantOf(a) === instantOf(b);
}

function milestonesEqual(existing, proposed) {
  return (
    existing.temporal_precision === proposed.temporal_precision &&
    existing.date_value === (proposed.date_value ?? null) &&
    sameInstant(existing.at, proposed.at ?? null) &&
    sameInstant(existing.starts_at, proposed.starts_at ?? null) &&
    sameInstant(existing.ends_at, proposed.ends_at ?? null)
  );
}

const MATCH_FACT_PAGE_SIZE = 500;
const MAX_MATCH_FACT_ROWS = 5_000;

async function readBoundedMatchRows(admin, table, columns, filterColumn, ids, orderColumns) {
  const rows = [];
  for (let start = 0; start <= MAX_MATCH_FACT_ROWS; start += MATCH_FACT_PAGE_SIZE) {
    let query = admin.from(table).select(columns).in(filterColumn, ids);
    for (const column of orderColumns) query = query.order(column);
    const { data, error } = await query.range(start, start + MATCH_FACT_PAGE_SIZE - 1);
    if (error)
      return { ok: false, problem: `Failed to read ${table}: ${error.message}`, retryable: true };
    if (!Array.isArray(data))
      return { ok: false, problem: `Failed to read ${table} completely.`, retryable: true };
    if (rows.length + data.length > MAX_MATCH_FACT_ROWS)
      return { ok: false, problem: `${table} exceeds the reviewed match-fact limit.` };
    rows.push(...data);
    if (data.length < MATCH_FACT_PAGE_SIZE) return { ok: true, rows };
  }
  return { ok: false, problem: `${table} exceeds the reviewed match-fact limit.` };
}

/**
 * Resolves every shape-validated entry against the current catalog: the
 * target Event (by events.source_key - a separate identity space from the
 * opportunity's own source_key, see the ticket_opportunities migration's
 * own comment), each targetOccurrences locator (by (event id, starts_at)
 * instant - the same pair that uniquely identifies an occurrence today,
 * event_occurrences_event_id_starts_at_key), and any existing Opportunity
 * of the same source_key (for the create/update/unchanged diff).
 *
 * Every entry is resolved before any RPC is called - a locator that fails
 * to resolve for entry #9 must not leave entries #1-8 already applied
 * (#163 "全seed validationをwrite前に完了"), mirroring
 * import-catalog-events.mjs's own all-before-any-write discipline.
 */
export async function resolvePlans(admin, entries, { targetEventId = null } = {}) {
  const problems = [];
  const plans = [];

  if (targetEventId !== null && entries.length !== 1) {
    return { ok: false, problems: ['An Event id override requires exactly one ticket entry.'] };
  }

  const eventSourceKeys = [...new Set(entries.map((entry) => entry.eventSourceKey))];
  const eventQuery = admin
    .from('events')
    .select(
      'id, source_key, title, venue, source_url, memo, genre_id, starts_on, ends_on, canceled_at',
    );
  const { data: eventRows, error: eventError } =
    targetEventId === null
      ? await eventQuery.in('source_key', eventSourceKeys)
      : await eventQuery.eq('id', targetEventId);
  if (eventError) {
    return {
      ok: false,
      problems: [`Failed to look up events: ${eventError.message}`],
      retryable: true,
    };
  }
  const eventBySourceKey = new Map(eventRows.map((row) => [row.source_key, row]));
  const eventIds = eventRows.map((row) => row.id);
  const eventOccurrencesById = new Map();
  const eventGroupsById = new Map();
  const genreKeyById = new Map();
  if (eventIds.length > 0) {
    const [occurrenceResult, groupResult] = await Promise.all([
      readBoundedMatchRows(
        admin,
        'event_occurrences',
        'id, event_id, starts_at, doors_at, ends_at, canceled_at',
        'event_id',
        eventIds,
        ['id'],
      ),
      readBoundedMatchRows(
        admin,
        'event_groups',
        'event_id, group_id, groups(key, display_name)',
        'event_id',
        eventIds,
        ['event_id', 'group_id'],
      ),
    ]);
    if (!occurrenceResult.ok || !groupResult.ok)
      return {
        ok: false,
        problems: [occurrenceResult.problem ?? groupResult.problem],
        retryable: occurrenceResult.retryable ?? groupResult.retryable ?? false,
      };
    for (const row of occurrenceResult.rows) {
      const rows = eventOccurrencesById.get(row.event_id) ?? [];
      rows.push(row);
      eventOccurrencesById.set(row.event_id, rows);
    }
    for (const row of groupResult.rows) {
      if (row.groups === null) continue;
      const rows = eventGroupsById.get(row.event_id) ?? [];
      rows.push({ key: row.groups.key, displayName: row.groups.display_name });
      eventGroupsById.set(row.event_id, rows);
    }
    const genreIds = [...new Set(eventRows.map((row) => row.genre_id).filter((id) => id !== null))];
    if (genreIds.length > 0) {
      const { data: genreRows, error: genreError } = await admin
        .from('genres')
        .select('id, key')
        .in('id', genreIds);
      if (genreError || genreRows.length !== genreIds.length)
        return {
          ok: false,
          problems: ['Failed to read target Event genre facts.'],
          retryable: !!genreError,
        };
      for (const row of genreRows) genreKeyById.set(row.id, row.key);
    }
  }

  const opportunitySourceKeys = entries.map((entry) => entry.sourceKey);
  const { data: existingOpportunities, error: opportunityError } = await admin
    .from('ticket_opportunities')
    .select('id, event_id, source_key, display_name, target_scope, source_url, memo')
    .in('source_key', opportunitySourceKeys);
  if (opportunityError) {
    return {
      ok: false,
      problems: [`Failed to look up existing opportunities: ${opportunityError.message}`],
      retryable: true,
    };
  }
  const existingBySourceKey = new Map(existingOpportunities.map((row) => [row.source_key, row]));
  const existingIds = existingOpportunities.map((row) => row.id);

  const existingTargetsById = new Map();
  const existingMilestonesById = new Map();
  if (existingIds.length > 0) {
    const targetResult = await readBoundedMatchRows(
      admin,
      'ticket_opportunity_target_occurrences',
      'opportunity_id, occurrence_id',
      'opportunity_id',
      existingIds,
      ['opportunity_id', 'occurrence_id'],
    );
    if (!targetResult.ok) {
      return {
        ok: false,
        problems: [targetResult.problem],
        retryable: targetResult.retryable ?? false,
      };
    }
    for (const row of targetResult.rows) {
      const list = existingTargetsById.get(row.opportunity_id) ?? [];
      list.push(row.occurrence_id);
      existingTargetsById.set(row.opportunity_id, list);
    }

    const { data: milestoneRows, error: milestoneError } = await admin
      .from('ticket_opportunity_milestones')
      .select(
        'opportunity_id, milestone_type, temporal_precision, date_value, at, starts_at, ends_at',
      )
      .in('opportunity_id', existingIds);
    if (milestoneError) {
      return {
        ok: false,
        problems: [`Failed to look up existing milestones: ${milestoneError.message}`],
        retryable: true,
      };
    }
    for (const row of milestoneRows) {
      const list = existingMilestonesById.get(row.opportunity_id) ?? [];
      list.push(row);
      existingMilestonesById.set(row.opportunity_id, list);
    }
  }

  // Reuse the complete, bounded Event snapshot for locator resolution.
  // A second unpaged SELECT could silently omit targets after row 1,000.
  const occurrencesByEventId = new Map();
  function occurrenceInstantsFor(eventId) {
    if (occurrencesByEventId.has(eventId)) return occurrencesByEventId.get(eventId);
    const rows = eventOccurrencesById.get(eventId) ?? [];
    const map = new Map(rows.map((row) => [instantOf(row.starts_at), row]));
    occurrencesByEventId.set(eventId, map);
    return map;
  }

  for (const entry of entries) {
    const event =
      targetEventId === null
        ? eventBySourceKey.get(entry.eventSourceKey)
        : eventRows.find((row) => row.id === targetEventId);
    if (event === undefined) {
      problems.push(
        targetEventId === null
          ? `${entry.sourceKey}: no Event found with source_key "${entry.eventSourceKey}"`
          : `${entry.sourceKey}: reviewed Event is no longer available`,
      );
      continue;
    }

    let occurrenceIds = [];
    let targetOccurrenceFacts = [];
    if (entry.targetScope === 'selected_occurrences') {
      const instants = occurrenceInstantsFor(event.id);
      const missing = [];
      for (const locator of entry.targetOccurrences) {
        const occurrence = instants.get(instantOf(locator));
        if (occurrence === undefined) {
          missing.push(locator);
          continue;
        }
        occurrenceIds.push(occurrence.id);
        targetOccurrenceFacts.push(occurrence);
      }
      if (missing.length > 0) {
        problems.push(
          `${entry.sourceKey}: target occurrence(s) not found for event "${entry.eventSourceKey}": ${missing.join(', ')}`,
        );
        continue;
      }
    }

    const proposedMilestones = entry.milestones.map((milestone) => ({
      milestone_type: milestone.milestone_type,
      temporal_precision: milestone.temporal_precision,
      date_value: milestone.date_value ?? null,
      at: milestone.at ?? null,
      starts_at: milestone.starts_at ?? null,
      ends_at: milestone.ends_at ?? null,
    }));

    const existing = existingBySourceKey.get(entry.sourceKey) ?? null;

    // Re-pointing an existing Opportunity at a different Event via
    // re-import is not rejected by the RPC (event_id is one of the columns
    // ON CONFLICT overwrites) - it is surfaced as an explicit `eventChanged`
    // plan detail below (see formatPlanReport's "!" line) rather than a
    // hard error, since it may be an intentional correction (e.g. the
    // Opportunity was imported against the wrong Event initially).
    let action = 'create';
    let existingTargetIds = [];
    let existingMilestones = [];
    let detailsChanged = false;
    let occurrencesChanged = false;
    let milestonesChanged = false;
    let eventChanged = false;

    if (existing !== null) {
      existingTargetIds = existingTargetsById.get(existing.id) ?? [];
      existingMilestones = existingMilestonesById.get(existing.id) ?? [];

      eventChanged = existing.event_id !== event.id;
      detailsChanged =
        existing.display_name !== entry.displayName ||
        existing.target_scope !== entry.targetScope ||
        existing.source_url !== entry.sourceUrl ||
        existing.memo !== entry.memo;

      const existingTargetSet = new Set(existingTargetIds);
      const proposedTargetSet = new Set(occurrenceIds);
      occurrencesChanged =
        existingTargetSet.size !== proposedTargetSet.size ||
        [...proposedTargetSet].some((id) => !existingTargetSet.has(id));

      const existingByType = new Map(existingMilestones.map((row) => [row.milestone_type, row]));
      const proposedByType = new Map(
        proposedMilestones.map((milestone) => [milestone.milestone_type, milestone]),
      );
      milestonesChanged =
        existingByType.size !== proposedByType.size ||
        [...proposedByType.entries()].some(([type, proposed]) => {
          const existingMilestone = existingByType.get(type);
          return existingMilestone === undefined || !milestonesEqual(existingMilestone, proposed);
        });

      action =
        eventChanged || detailsChanged || occurrencesChanged || milestonesChanged
          ? 'update'
          : 'unchanged';
    }

    plans.push({
      entry,
      event,
      hasCanceledTarget:
        event.canceled_at !== null ||
        targetOccurrenceFacts.some((occurrence) => occurrence.canceled_at !== null),
      expectedCurrent: {
        event,
        genreKey: event.genre_id === null ? null : genreKeyById.get(event.genre_id),
        eventOccurrences: eventOccurrencesById.get(event.id) ?? [],
        eventGroups: eventGroupsById.get(event.id) ?? [],
        opportunity: existing,
        targets: existingTargetIds,
        milestones: existingMilestones,
        targetOccurrences: targetOccurrenceFacts,
      },
      action,
      existing,
      existingTargetIds,
      existingMilestones,
      occurrenceIds,
      milestones: proposedMilestones,
      eventChanged,
      detailsChanged,
      occurrencesChanged,
      milestonesChanged,
    });
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, plans };
}

function milestoneDisplay(milestone) {
  if (milestone.temporal_precision === 'date')
    return `${milestone.milestone_type}=${milestone.date_value}`;
  if (milestone.temporal_precision === 'datetime')
    return `${milestone.milestone_type}=${milestone.at}`;
  return `${milestone.milestone_type}=${milestone.starts_at}..${milestone.ends_at}`;
}

/**
 * Renders an operator-reviewable dry-run summary. Deliberately a bounded
 * per-opportunity text block, not a generic diff framework
 * (#163 "巨大generic diff frameworkを作らない") - every field an operator
 * needs to cross-check against the source is one line.
 */
export function formatPlanReport(plans, { apply, remote }) {
  const lines = [];
  const label = apply ? 'APPLY' : 'DRY RUN';
  lines.push(`[${label}] ${remote ? 'remote' : 'local'} target`, '');

  for (const plan of plans) {
    const { entry, event, action } = plan;
    lines.push(`${action.toUpperCase().padEnd(9)} ${entry.sourceKey}`);
    lines.push(`          Event: ${event.title} (${entry.eventSourceKey})`);
    lines.push(`          displayName: ${entry.displayName}`);
    if (entry.sourceUrl !== null) lines.push(`          sourceUrl: ${entry.sourceUrl}`);
    if (entry.memo !== null) lines.push(`          memo: ${entry.memo}`);
    lines.push(`          targetScope: ${entry.targetScope}`);
    if (entry.targetScope === 'selected_occurrences') {
      lines.push(
        `          targetOccurrences: ${plan.occurrenceIds.length} (${entry.targetOccurrences[0]}${entry.targetOccurrences.length > 1 ? `, +${entry.targetOccurrences.length - 1} more` : ''})`,
      );
    }
    if (entry.milestones.length === 0) {
      lines.push('          milestones: (none)');
    } else {
      lines.push(`          milestones: ${entry.milestones.map(milestoneDisplay).join(', ')}`);
    }

    if (action === 'update') {
      if (plan.eventChanged) {
        lines.push(`          ! Event changes from an existing Opportunity of the same source_key`);
      }
      if (plan.detailsChanged) {
        lines.push(
          `          ~ details: displayName "${plan.existing.display_name}"->"${entry.displayName}", ` +
            `targetScope "${plan.existing.target_scope}"->"${entry.targetScope}", ` +
            `sourceUrl "${plan.existing.source_url ?? '(unset)'}"->"${entry.sourceUrl ?? '(unset)'}", ` +
            `memo "${plan.existing.memo ?? '(unset)'}"->"${entry.memo ?? '(unset)'}"`,
        );
      }
      if (plan.occurrencesChanged) {
        lines.push(
          `          ~ targetOccurrences: ${plan.existingTargetIds.length} -> ${plan.occurrenceIds.length} (replace-all)`,
        );
      }
      if (plan.milestonesChanged) {
        const existingDisplay =
          plan.existingMilestones.length === 0
            ? '(none)'
            : plan.existingMilestones.map(milestoneDisplay).join(', ');
        const proposedDisplay =
          entry.milestones.length === 0
            ? '(none)'
            : entry.milestones.map(milestoneDisplay).join(', ');
        lines.push(
          `          ~ milestones (replace-all): ${existingDisplay} -> ${proposedDisplay}`,
        );
      }
    }
    lines.push('');
  }

  const totals = plans.reduce(
    (acc, plan) => ({
      create: acc.create + (plan.action === 'create' ? 1 : 0),
      update: acc.update + (plan.action === 'update' ? 1 : 0),
      unchanged: acc.unchanged + (plan.action === 'unchanged' ? 1 : 0),
    }),
    { create: 0, update: 0, unchanged: 0 },
  );
  lines.push(
    `${plans.length} seed entries: +${totals.create} create, ~${totals.update} update, =${totals.unchanged} unchanged`,
  );
  if (!apply) {
    lines.push('', 'Dry run only. Re-run with --apply to write.');
  }
  return lines.join('\n');
}

/**
 * Applies every plan whose action is not 'unchanged', one
 * import_ticket_opportunity RPC call per Opportunity. Each call is already
 * atomic (Opportunity upsert + target-occurrences replace-all + milestones
 * replace-all in one transaction, see the RPC's own migration) - no
 * client-side transaction wraps the whole run, mirroring
 * import-catalog-events.mjs's own reasoning: partial application across
 * entries is safe and recoverable because every identity here
 * (opportunity source_key) is idempotent to re-apply.
 */
export class StaleTicketOpportunityCatalogError extends Error {
  constructor() {
    super('Ticket Opportunity catalog changed before apply');
    this.name = 'StaleTicketOpportunityCatalogError';
  }
}

export async function applyPlans(admin, plans, { reviewed = false } = {}) {
  for (const plan of plans) {
    if (plan.action === 'unchanged' && !reviewed) continue;
    const { entry } = plan;
    const { error } = await admin.rpc(
      reviewed ? 'apply_reviewed_ticket_opportunity' : 'import_ticket_opportunity',
      {
        p_event_id: plan.event.id,
        p_source_key: entry.sourceKey,
        p_display_name: entry.displayName,
        p_target_scope: entry.targetScope,
        p_occurrence_ids:
          entry.targetScope === 'selected_occurrences'
            ? plan.occurrenceIds
            : reviewed
              ? null
              : undefined,
        p_source_url: entry.sourceUrl,
        p_memo: entry.memo,
        p_milestones: plan.milestones,
        ...(reviewed
          ? {
              p_action: plan.action,
              p_expected_current: plan.expectedCurrent,
            }
          : {}),
      },
    );
    if (error) {
      if (reviewed && error.code === '40001') throw new StaleTicketOpportunityCatalogError();
      throw new Error(`Failed to import ${entry.sourceKey}: ${error.message}`);
    }
  }
}
