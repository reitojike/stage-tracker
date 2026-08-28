// DB-dependent orchestration for the TicketOpportunity operator import
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

import fs from 'node:fs';
import path from 'node:path';
import { validateSeedEntryShape } from './ticketOpportunitySeed.mjs';

export function seedFilePaths(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(entry)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(entry, name));
  }
  return [entry];
}

/**
 * Reads and shape-validates every seed entry under `target` (a file or a
 * directory of files, each holding one entry or an array of entries - same
 * convention as scripts/import-catalog-events.mjs). Every entry is checked
 * before any DB lookup happens, so a malformed entry deep in a large
 * directory is reported without ever contacting the database
 * (#163 "全seed validationをwrite前に完了").
 *
 * Returns `{ ok: true, entries }` or `{ ok: false, problems }`, never
 * throws for a data problem (a malformed file itself, or fs error, still
 * throws - that is an operator mistake outside the seed content this
 * function validates).
 */
export function loadAndValidateSeed(target) {
  const problems = [];
  const entries = [];

  for (const file of seedFilePaths(target)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`${file}: not valid JSON (${error.message})`);
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    list.forEach((raw, index) => {
      const result = validateSeedEntryShape(raw, `${file}[${index}]`);
      if (result.ok) {
        entries.push(result.entry);
      } else {
        problems.push(...result.problems);
      }
    });
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
export async function resolvePlans(admin, entries) {
  const problems = [];
  const plans = [];

  const eventSourceKeys = [...new Set(entries.map((entry) => entry.eventSourceKey))];
  const { data: eventRows, error: eventError } = await admin
    .from('events')
    .select('id, source_key, title')
    .in('source_key', eventSourceKeys);
  if (eventError) {
    return { ok: false, problems: [`Failed to look up events: ${eventError.message}`] };
  }
  const eventBySourceKey = new Map(eventRows.map((row) => [row.source_key, row]));

  const opportunitySourceKeys = entries.map((entry) => entry.sourceKey);
  const { data: existingOpportunities, error: opportunityError } = await admin
    .from('ticket_opportunities')
    .select('id, event_id, source_key, display_name, target_scope, source_url, memo')
    .in('source_key', opportunitySourceKeys);
  if (opportunityError) {
    return {
      ok: false,
      problems: [`Failed to look up existing opportunities: ${opportunityError.message}`],
    };
  }
  const existingBySourceKey = new Map(existingOpportunities.map((row) => [row.source_key, row]));
  const existingIds = existingOpportunities.map((row) => row.id);

  const existingTargetsById = new Map();
  const existingMilestonesById = new Map();
  if (existingIds.length > 0) {
    const { data: targetRows, error: targetError } = await admin
      .from('ticket_opportunity_target_occurrences')
      .select('opportunity_id, occurrence_id')
      .in('opportunity_id', existingIds);
    if (targetError) {
      return {
        ok: false,
        problems: [`Failed to look up existing target occurrences: ${targetError.message}`],
      };
    }
    for (const row of targetRows) {
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
      };
    }
    for (const row of milestoneRows) {
      const list = existingMilestonesById.get(row.opportunity_id) ?? [];
      list.push(row);
      existingMilestonesById.set(row.opportunity_id, list);
    }
  }

  // Occurrences are only fetched per Event actually referenced by a
  // selected_occurrences entry, and only once per Event even if several
  // entries target the same one.
  const occurrencesByEventId = new Map();
  // Returns `{ok:true, instants}` or `{ok:false, message}` rather than
  // throwing - every other lookup in this function reports a failure into
  // `problems` and keeps going (so earlier entries' already-collected
  // problems in the same run are not discarded), and this helper must not
  // be the one exception that turns a transient DB error into an unhandled
  // rejection out of resolvePlans.
  async function occurrenceInstantsFor(eventId) {
    if (occurrencesByEventId.has(eventId)) {
      return { ok: true, instants: occurrencesByEventId.get(eventId) };
    }
    const { data, error } = await admin
      .from('event_occurrences')
      .select('id, starts_at')
      .eq('event_id', eventId);
    if (error) {
      return {
        ok: false,
        message: `Failed to look up occurrences for event ${eventId}: ${error.message}`,
      };
    }
    const map = new Map(data.map((row) => [instantOf(row.starts_at), row.id]));
    occurrencesByEventId.set(eventId, map);
    return { ok: true, instants: map };
  }

  for (const entry of entries) {
    const event = eventBySourceKey.get(entry.eventSourceKey);
    if (event === undefined) {
      problems.push(`${entry.sourceKey}: no Event found with source_key "${entry.eventSourceKey}"`);
      continue;
    }

    let occurrenceIds = [];
    if (entry.targetScope === 'selected_occurrences') {
      const resolvedInstants = await occurrenceInstantsFor(event.id);
      if (!resolvedInstants.ok) {
        problems.push(`${entry.sourceKey}: ${resolvedInstants.message}`);
        continue;
      }
      const instants = resolvedInstants.instants;
      const missing = [];
      for (const locator of entry.targetOccurrences) {
        const occurrenceId = instants.get(instantOf(locator));
        if (occurrenceId === undefined) {
          missing.push(locator);
          continue;
        }
        occurrenceIds.push(occurrenceId);
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
export async function applyPlans(admin, plans) {
  for (const plan of plans) {
    if (plan.action === 'unchanged') continue;
    const { entry } = plan;
    const { error } = await admin.rpc('import_ticket_opportunity', {
      p_event_id: plan.event.id,
      p_source_key: entry.sourceKey,
      p_display_name: entry.displayName,
      p_target_scope: entry.targetScope,
      p_occurrence_ids:
        entry.targetScope === 'selected_occurrences' ? plan.occurrenceIds : undefined,
      p_source_url: entry.sourceUrl,
      p_memo: entry.memo,
      p_milestones: plan.milestones,
    });
    if (error) {
      throw new Error(`Failed to import ${entry.sourceKey}: ${error.message}`);
    }
  }
}
