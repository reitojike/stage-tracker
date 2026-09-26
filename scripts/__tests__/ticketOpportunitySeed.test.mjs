import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyPlans,
  resolvePlans,
  StaleTicketOpportunityCatalogError,
} from '@stage-tracker/official-import/ticket';
import { validateSeedEntryShape } from '../lib/ticketOpportunitySeed.mjs';
import { loadAndValidateSeed } from '../lib/ticketOpportunityImport.mjs';

function validEntry(overrides = {}) {
  return {
    eventSourceKey: 'takarazuka:2026:example:tokyo',
    sourceKey: 'takarazuka:2026:example:tokyo:lottery1',
    displayName: '第1抽選',
    sourceUrl: 'https://example.invalid/tickets',
    memo: null,
    targetScope: 'event_wide',
    milestones: [],
    ...overrides,
  };
}

void test('reviewed Ticket plan snapshots all target Event match facts', async () => {
  const validated = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-10-10T04:00:00Z'],
    }),
    'seed.json[0]',
  );
  assert.equal(validated.ok, true);
  const event = {
    id: 'event-1',
    source_key: validated.entry.eventSourceKey,
    title: 'Reviewed Event',
    venue: 'Reviewed Hall',
    source_url: 'https://example.invalid/event',
    memo: null,
    genre_id: 'genre-1',
    starts_on: '2026-10-10',
    ends_on: '2026-10-20',
    canceled_at: null,
  };
  const occurrence = {
    id: 'occurrence-1',
    event_id: event.id,
    starts_at: '2026-10-10T04:00:00Z',
    doors_at: null,
    ends_at: null,
    canceled_at: null,
  };
  const rowsByTable = {
    events: [event],
    event_occurrences: [occurrence],
    event_groups: [
      {
        event_id: event.id,
        group_id: 'group-1',
        groups: { key: 'star', display_name: 'Star' },
      },
    ],
    genres: [{ id: 'genre-1', key: 'theatre' }],
  };
  const admin = {
    from(table) {
      return {
        select(columns) {
          if (table === 'events')
            assert.equal(
              columns,
              'id, source_key, title, venue, source_url, memo, genre_id, starts_on, ends_on, canceled_at',
            );
          return {
            in() {
              if (
                table === 'event_occurrences' ||
                table === 'event_groups' ||
                table === 'ticket_opportunity_target_occurrences'
              )
                return {
                  order() {
                    return this;
                  },
                  async range(start, end) {
                    return { data: rowsByTable[table].slice(start, end + 1), error: null };
                  },
                };
              return Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
            },
            async eq() {
              return { data: table === 'event_occurrences' ? [occurrence] : [], error: null };
            },
          };
        },
      };
    },
  };
  const resolved = await resolvePlans(admin, [validated.entry]);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.plans[0].expectedCurrent.event, event);
  assert.equal(resolved.plans[0].expectedCurrent.genreKey, 'theatre');
  assert.deepEqual(resolved.plans[0].expectedCurrent.eventOccurrences, [occurrence]);
  assert.deepEqual(resolved.plans[0].expectedCurrent.eventGroups, [
    { key: 'star', displayName: 'Star' },
  ]);
  assert.deepEqual(resolved.plans[0].expectedCurrent.targetOccurrences, [occurrence]);
  assert.equal(resolved.plans[0].hasCanceledTarget, false);

  occurrence.canceled_at = '2026-10-01T00:00:00Z';
  const canceledOccurrence = await resolvePlans(admin, [validated.entry]);
  assert.equal(canceledOccurrence.ok, true);
  assert.equal(canceledOccurrence.plans[0].hasCanceledTarget, true);
  occurrence.canceled_at = null;

  event.canceled_at = '2026-10-01T00:00:00Z';
  const canceledEvent = await resolvePlans(admin, [validated.entry]);
  assert.equal(canceledEvent.ok, true);
  assert.equal(canceledEvent.plans[0].hasCanceledTarget, true);
  event.canceled_at = null;

  rowsByTable.event_occurrences = Array.from({ length: 1_001 }, (_, index) => ({
    ...occurrence,
    id: `occurrence-${index}`,
    starts_at: new Date(Date.parse(occurrence.starts_at) + index * 60_000).toISOString(),
  }));
  rowsByTable.event_groups = Array.from({ length: 1_001 }, (_, index) => ({
    event_id: event.id,
    group_id: `group-${index}`,
    groups: { key: `group-${index}`, display_name: `Group ${index}` },
  }));
  const paged = await resolvePlans(admin, [validated.entry]);
  assert.equal(paged.ok, true);
  assert.equal(paged.plans[0].expectedCurrent.eventOccurrences.length, 1_001);
  assert.equal(paged.plans[0].expectedCurrent.eventGroups.length, 1_001);
  const lateTarget = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: [rowsByTable.event_occurrences[1_000].starts_at],
    }),
    'late-target.json',
  );
  assert.equal(lateTarget.ok, true);
  const latePlan = await resolvePlans(admin, [lateTarget.entry]);
  assert.equal(latePlan.ok, true);
  assert.equal(latePlan.plans[0].expectedCurrent.targetOccurrences[0].id, 'occurrence-1000');

  rowsByTable.ticket_opportunities = [
    {
      id: 'opportunity-1',
      event_id: event.id,
      source_key: validated.entry.sourceKey,
      display_name: validated.entry.displayName,
      target_scope: 'selected_occurrences',
      source_url: validated.entry.sourceUrl,
      memo: null,
    },
  ];
  rowsByTable.ticket_opportunity_target_occurrences = Array.from({ length: 1_001 }, (_, index) => ({
    opportunity_id: 'opportunity-1',
    occurrence_id: `occurrence-${index}`,
  }));
  const existingTargets = await resolvePlans(admin, [validated.entry]);
  assert.equal(existingTargets.ok, true);
  assert.equal(existingTargets.plans[0].expectedCurrent.targets.length, 1_001);

  rowsByTable.ticket_opportunity_target_occurrences = Array.from({ length: 5_001 }, (_, index) => ({
    opportunity_id: 'opportunity-1',
    occurrence_id: `occurrence-${index}`,
  }));
  const oversizedTargets = await resolvePlans(admin, [validated.entry]);
  assert.equal(oversizedTargets.ok, false);
  assert.match(oversizedTargets.problems[0], /exceeds the reviewed match-fact limit/);
  rowsByTable.ticket_opportunity_target_occurrences = [];

  rowsByTable.event_occurrences = Array.from({ length: 5_001 }, (_, index) => ({
    ...occurrence,
    id: `occurrence-${index}`,
  }));
  const oversized = await resolvePlans(admin, [validated.entry]);
  assert.equal(oversized.ok, false);
  assert.match(oversized.problems[0], /exceeds the reviewed match-fact limit/);
});

void test('reviewed Event id resolves a manual Event without a source key', async () => {
  const validated = validateSeedEntryShape(
    validEntry({ eventSourceKey: 'unresolved:shochiku:haikusai' }),
    'manual-ticket.json',
  );
  assert.equal(validated.ok, true);
  const event = {
    id: 'manual-event-1',
    source_key: null,
    title: '俳優祭',
    venue: '歌舞伎座',
    source_url: 'https://actors.or.jp/wp/news/340/',
    memo: null,
    genre_id: null,
    starts_on: '2026-10-26',
    ends_on: '2026-10-26',
    canceled_at: null,
  };
  const admin = {
    from(table) {
      return {
        select() {
          return {
            async eq(column, value) {
              assert.equal(table, 'events');
              assert.equal(column, 'id');
              return { data: value === event.id ? [event] : [], error: null };
            },
            in() {
              if (table === 'event_occurrences' || table === 'event_groups')
                return {
                  order() {
                    return this;
                  },
                  async range() {
                    return { data: [], error: null };
                  },
                };
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  };

  const resolved = await resolvePlans(admin, [validated.entry], {
    targetEventId: event.id,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.plans[0].event.id, event.id);
  assert.equal(resolved.plans[0].event.source_key, null);

  const missing = await resolvePlans(admin, [validated.entry], {
    targetEventId: 'other-event',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.problems[0], /reviewed Event is no longer available/);
});

void test('reviewed event-wide apply sends a null target list and surfaces stale catalog state', async () => {
  const validated = validateSeedEntryShape(validEntry(), 'seed.json[0]');
  assert.equal(validated.ok, true);
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { error: { code: '40001', message: 'stale catalog' } };
    },
  };
  const plan = {
    entry: validated.entry,
    event: { id: 'event-1' },
    action: 'create',
    occurrenceIds: [],
    milestones: [],
    expectedCurrent: { event: { id: 'event-1' }, opportunity: null },
  };

  await assert.rejects(
    applyPlans(admin, [plan], { reviewed: true }),
    StaleTicketOpportunityCatalogError,
  );
  assert.equal(calls[0].name, 'apply_reviewed_ticket_opportunity');
  assert.equal(calls[0].args.p_occurrence_ids, null);
});

void test('accepts a minimal valid event_wide entry with no milestones', () => {
  const result = validateSeedEntryShape(validEntry(), 'seed.json[0]');
  assert.equal(result.ok, true);
  assert.equal(result.entry.eventSourceKey, 'takarazuka:2026:example:tokyo');
  assert.equal(result.entry.targetScope, 'event_wide');
  assert.deepEqual(result.entry.targetOccurrences, []);
  assert.deepEqual(result.entry.milestones, []);
});

void test('rejects missing required fields', () => {
  const result = validateSeedEntryShape({}, 'seed.json[0]');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('eventSourceKey is required')));
  assert.ok(result.problems.some((p) => p.includes('sourceKey is required')));
  assert.ok(result.problems.some((p) => p.includes('displayName is required')));
  assert.ok(result.problems.some((p) => p.includes('targetScope is required')));
});

void test('rejects an unrecognized targetScope', () => {
  const result = validateSeedEntryShape(validEntry({ targetScope: 'whole-run' }), 'x');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('targetScope must be one of')));
});

void test('rejects a malformed sourceUrl', () => {
  const result = validateSeedEntryShape(validEntry({ sourceUrl: 'not-a-url' }), 'x');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('sourceUrl must start with')));
});

// --- target scope / occurrence combinations ---

void test('rejects event_wide with targetOccurrences present', () => {
  const result = validateSeedEntryShape(
    validEntry({ targetScope: 'event_wide', targetOccurrences: ['2026-09-01T10:00:00+09:00'] }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must not list targetOccurrences')));
});

void test('rejects selected_occurrences with no targetOccurrences', () => {
  const result = validateSeedEntryShape(
    validEntry({ targetScope: 'selected_occurrences', targetOccurrences: [] }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('requires at least one targetOccurrences')));
});

void test('accepts selected_occurrences with target occurrence locators', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T10:00:00+09:00', '2026-09-02T10:00:00+09:00'],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.targetOccurrences, [
    '2026-09-01T10:00:00+09:00',
    '2026-09-02T10:00:00+09:00',
  ]);
});

void test('deduplicates a repeated targetOccurrences locator rather than rejecting', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T10:00:00+09:00', '2026-09-01T10:00:00+09:00'],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.targetOccurrences, ['2026-09-01T10:00:00+09:00']);
});

void test('deduplicates targetOccurrences locators by instant, not raw string', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T13:00:00+09:00', '2026-09-01T04:00:00Z'],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.equal(
    result.entry.targetOccurrences.length,
    1,
    'both locators name the same instant and must collapse to one',
  );
});

void test('trims a targetOccurrences locator before dedup and storage', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T13:00:00+09:00', ' 2026-09-01T13:00:00+09:00'],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.targetOccurrences, ['2026-09-01T13:00:00+09:00']);
});

void test('rejects a targetOccurrences locator without an explicit UTC offset', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T10:00:00'],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must carry an explicit UTC offset')));
});

// --- milestones: date precision ---

void test('accepts a date-precision milestone and preserves it as a bare date', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'result_announcement', precision: 'date', date: '2026-09-10' }],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.milestones, [
    { milestone_type: 'result_announcement', temporal_precision: 'date', date_value: '2026-09-10' },
  ]);
});

void test('rejects a date-precision milestone with a malformed date', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'result_announcement', precision: 'date', date: '2026/09/10' }],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must be an Asia/Tokyo calendar date')));
});

void test('rejects a date-precision milestone that also carries a datetime field', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        {
          type: 'result_announcement',
          precision: 'date',
          date: '2026-09-10',
          at: '2026-09-10T10:00:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must not be set for precision "date"')));
});

// --- milestones: datetime precision ---

void test('accepts a datetime-precision milestone with explicit offset', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'application_close', precision: 'datetime', at: '2026-09-05T17:00:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.milestones, [
    {
      milestone_type: 'application_close',
      temporal_precision: 'datetime',
      at: '2026-09-05T17:00:00+09:00',
    },
  ]);
});

void test('rejects a datetime-precision milestone with no explicit UTC offset', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'application_close', precision: 'datetime', at: '2026-09-05T17:00:00' }],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must carry an explicit UTC offset')));
});

// --- milestones: window precision ---

void test('accepts a window-precision milestone', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-09-10T18:00:00+09:00',
          endsAt: '2026-09-13T23:59:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.milestones, [
    {
      milestone_type: 'payment_window',
      temporal_precision: 'window',
      starts_at: '2026-09-10T18:00:00+09:00',
      ends_at: '2026-09-13T23:59:00+09:00',
    },
  ]);
});

void test('rejects a window whose end precedes its start', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-09-13T23:59:00+09:00',
          endsAt: '2026-09-10T18:00:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('is earlier than')));
});

void test('rejects a window with a missing endsAt', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'payment_window', precision: 'window', startsAt: '2026-09-10T18:00:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('endsAt is required')));
});

// --- milestones: vocabulary and duplicates ---

void test('rejects an unrecognized milestone type', () => {
  const result = validateSeedEntryShape(
    validEntry({ milestones: [{ type: 'early_bird', precision: 'date', date: '2026-09-10' }] }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('type must be one of')));
});

void test('rejects an unrecognized temporal precision', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'sale_start', precision: 'fuzzy', date: '2026-09-10' }],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('precision must be one of')));
});

void test('rejects two milestones of the same type in one opportunity', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'sale_start', precision: 'date', date: '2026-09-10' },
        { type: 'sale_start', precision: 'date', date: '2026-09-11' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('duplicate milestone type')));
});

// --- optional/conditional phases: absence, not fake presence ---

void test('an opportunity with no result milestone simply omits the row (no synthesized value)', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'application_open', precision: 'date', date: '2026-08-01' }],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.equal(result.entry.milestones.length, 1);
  assert.equal(
    result.entry.milestones.some((m) => m.milestone_type === 'result_announcement'),
    false,
  );
});

// --- multiple problems collected together, not fail-fast on the first ---

void test('collects every problem in one entry rather than stopping at the first', () => {
  const result = validateSeedEntryShape(
    {
      eventSourceKey: '',
      sourceKey: 'x',
      displayName: 'x',
      targetScope: 'not-real',
      milestones: [{ type: 'not-real-either', precision: 'date' }],
    },
    'seed.json[0]',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.length >= 3);
  assert.ok(result.problems.every((p) => p.startsWith('seed.json[0]: ')));
});

// --- required source-shape coverage (Issue #163) ---
//
// Synthetic fixtures only - no copyrighted source text is reproduced here
// (#163 "copyrighted source本文をrepositoryへ転載せず、synthetic fixtureで
// 最低限以下を再現"). Each test proves the seed format can express one
// real source's shape, not that any particular site's markup can be
// parsed - there is no parser for any of these sources in this
// repository.

void test('宝塚型: one Event with 3 lottery phases + one general pre-sale, no fabricated optional phase', () => {
  const entries = [
    validEntry({
      sourceKey: 'takarazuka:tomonokai:2026:example:lottery1',
      displayName: '第1抽選',
      milestones: [
        { type: 'application_open', precision: 'date', date: '2026-07-01' },
        { type: 'application_close', precision: 'date', date: '2026-07-10' },
        { type: 'result_announcement', precision: 'date', date: '2026-07-15' },
      ],
    }),
    validEntry({
      sourceKey: 'takarazuka:tomonokai:2026:example:lottery2',
      displayName: '第2抽選',
      milestones: [
        { type: 'application_open', precision: 'date', date: '2026-07-16' },
        { type: 'application_close', precision: 'date', date: '2026-07-20' },
      ],
    }),
    validEntry({
      sourceKey: 'takarazuka:tomonokai:2026:example:lottery3',
      displayName: '第3抽選',
      milestones: [{ type: 'application_open', precision: 'date', date: '2026-07-21' }],
    }),
    validEntry({
      sourceKey: 'takarazuka:tomonokai:2026:example:general',
      displayName: '一般発売',
      milestones: [{ type: 'sale_start', precision: 'datetime', at: '2026-08-01T10:00:00+09:00' }],
    }),
  ];
  const results = entries.map((entry, index) => validateSeedEntryShape(entry, `x[${index}]`));
  assert.ok(results.every((r) => r.ok));
  // 第3抽選 has no result_announcement - the source did not publish one
  // yet, and this is not padded with a placeholder value.
  const lottery3 = results[2].entry;
  assert.equal(lottery3.milestones.length, 1);
});

void test('Vpass型: exact application deadline, no result datetime, selected Occurrences', () => {
  const result = validateSeedEntryShape(
    validEntry({
      sourceKey: 'vpass:12345:general',
      displayName: 'Vpass先行',
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T13:00:00+09:00', '2026-09-02T13:00:00+09:00'],
      milestones: [
        { type: 'application_close', precision: 'datetime', at: '2026-08-20T23:59:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.equal(result.entry.targetScope, 'selected_occurrences');
  assert.equal(result.entry.targetOccurrences.length, 2);
  // The source never published a result datetime - no row for it, not a
  // fabricated one.
  assert.equal(
    result.entry.milestones.some((m) => m.milestone_type === 'result_announcement'),
    false,
  );
});

void test('松竹型: several sale-start phases per membership tier for the same Event, date-only allowed', () => {
  const entries = [
    validEntry({
      sourceKey: 'shochiku:2026:example:platinum',
      displayName: 'プラチナ会員先行',
      milestones: [{ type: 'sale_start', precision: 'date', date: '2026-08-01' }],
    }),
    validEntry({
      sourceKey: 'shochiku:2026:example:gold',
      displayName: 'ゴールド会員先行',
      milestones: [{ type: 'sale_start', precision: 'date', date: '2026-08-05' }],
    }),
    validEntry({
      sourceKey: 'shochiku:2026:example:general',
      displayName: '一般発売',
      milestones: [{ type: 'sale_start', precision: 'datetime', at: '2026-08-10T10:00:00+09:00' }],
    }),
  ];
  const results = entries.map((entry, index) => validateSeedEntryShape(entry, `x[${index}]`));
  assert.ok(results.every((r) => r.ok));
  assert.equal(results[0].entry.milestones[0].temporal_precision, 'date');
  assert.equal(results[2].entry.milestones[0].temporal_precision, 'datetime');
});

void test('artist/FC型: application window + result/payment window + a later general sale', () => {
  const fcLottery = validateSeedEntryShape(
    validEntry({
      sourceKey: 'fc:example-group:2026:fc-lottery',
      displayName: 'FC先行抽選',
      milestones: [
        { type: 'application_open', precision: 'datetime', at: '2026-06-01T10:00:00+09:00' },
        { type: 'application_close', precision: 'datetime', at: '2026-06-10T23:59:00+09:00' },
        { type: 'result_announcement', precision: 'date', date: '2026-06-15' },
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-06-16T00:00:00+09:00',
          endsAt: '2026-06-20T23:59:00+09:00',
        },
      ],
    }),
    'x[0]',
  );
  const generalSale = validateSeedEntryShape(
    validEntry({
      sourceKey: 'fc:example-group:2026:general',
      displayName: '一般発売',
      milestones: [{ type: 'sale_start', precision: 'datetime', at: '2026-07-01T10:00:00+09:00' }],
    }),
    'x[1]',
  );
  assert.equal(fcLottery.ok, true);
  assert.equal(generalSale.ok, true);
  const byType = new Map(fcLottery.entry.milestones.map((m) => [m.milestone_type, m]));
  assert.equal(byType.get('payment_window').temporal_precision, 'window');
});

// --- strict calendar-component validation (Issue #172 root cause A /
// Codex X1: Date.parse() silently normalizes an impossible calendar date
// like "2026-02-30" into a different, real instant instead of rejecting
// it, which could resolve a malformed locator to the wrong Occurrence) ---

void test('rejects an impossible date-precision milestone (Feb 30)', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'result_announcement', precision: 'date', date: '2026-02-30' }],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must be a real Asia/Tokyo calendar date')));
});

void test('rejects a non-leap-year Feb 29 date-precision milestone', () => {
  // 2026 is not a leap year.
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'result_announcement', precision: 'date', date: '2026-02-29' }],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must be a real Asia/Tokyo calendar date')));
});

void test('accepts a valid leap-day date-precision milestone', () => {
  // 2028 is a leap year.
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [{ type: 'result_announcement', precision: 'date', date: '2028-02-29' }],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.equal(result.entry.milestones[0].date_value, '2028-02-29');
});

void test('rejects an impossible datetime-precision milestone (Feb 30)', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'application_close', precision: 'datetime', at: '2026-02-30T17:00:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must be a real calendar date/time')));
});

void test('rejects a datetime-precision milestone with an impossible clock time', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'application_close', precision: 'datetime', at: '2026-09-05T25:00:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  // Date.parse() itself already rejects an out-of-range clock time (unlike
  // an out-of-range calendar date, which it silently normalizes) - either
  // rejection path is acceptable here, this test only pins the outcome.
  assert.ok(
    result.problems.some(
      (p) =>
        p.includes('must be a real calendar date/time') ||
        p.includes('must be a parseable timestamp'),
    ),
  );
});

void test('accepts a valid leap-day datetime-precision milestone with offset', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        { type: 'application_close', precision: 'datetime', at: '2028-02-29T17:00:00+09:00' },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.equal(result.entry.milestones[0].at, '2028-02-29T17:00:00+09:00');
});

void test('rejects a window milestone with an impossible startsAt', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-02-30T18:00:00+09:00',
          endsAt: '2026-03-05T23:59:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('startsAt must be a real calendar date/time')));
});

void test('rejects a window milestone with an impossible endsAt', () => {
  const result = validateSeedEntryShape(
    validEntry({
      milestones: [
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-03-01T18:00:00+09:00',
          endsAt: '2026-02-30T23:59:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('endsAt must be a real calendar date/time')));
});

void test('rejects an impossible targetOccurrences locator', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-02-30T10:00:00+09:00'],
    }),
    'x',
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('must be a real calendar date/time')));
});

void test('accepts a valid leap-day targetOccurrences locator', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2028-02-29T10:00:00+09:00'],
    }),
    'x',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entry.targetOccurrences, ['2028-02-29T10:00:00+09:00']);
});

void test('valid ISO timestamps with a required offset are still accepted across all precisions', () => {
  const result = validateSeedEntryShape(
    validEntry({
      targetScope: 'selected_occurrences',
      targetOccurrences: ['2026-09-01T13:00:00+09:00'],
      milestones: [
        { type: 'application_open', precision: 'date', date: '2026-08-01' },
        { type: 'application_close', precision: 'datetime', at: '2026-08-20T23:59:00+09:00' },
        {
          type: 'payment_window',
          precision: 'window',
          startsAt: '2026-08-21T00:00:00+09:00',
          endsAt: '2026-08-25T23:59:00+09:00',
        },
      ],
    }),
    'x',
  );
  assert.equal(result.ok, true);
});

// --- invalid seed never reaches a DB write path (Issue #172) ---

void test('an impossible calendar date fails loadAndValidateSeed before any DB lookup would occur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-opportunity-seed-'));
  try {
    const file = path.join(dir, 'seed.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          eventSourceKey: 'takarazuka:2026:example:tokyo',
          sourceKey: 'takarazuka:2026:example:tokyo:lottery1',
          displayName: '第1抽選',
          targetScope: 'event_wide',
          milestones: [{ type: 'result_announcement', precision: 'date', date: '2026-02-30' }],
        },
      ]),
    );
    const result = loadAndValidateSeed(dir);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes('must be a real Asia/Tokyo calendar date')));
    // ok:false here means import-ticket-opportunities.mjs's own
    // `if (!loaded.ok) fail(...)` runs before resolveAdminTarget/
    // resolvePlans/applyPlans are ever reached - no DB client is created
    // for an invalid seed.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
