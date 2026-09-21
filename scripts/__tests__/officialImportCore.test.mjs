import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEventPlans,
  formatEventPlanReport,
  resolveEventPlans,
  validateEventEntries,
  validateEventEntry,
} from '@stage-tracker/official-import/event';

const owner = { id: 'owner-1', email: 'creator@example.test' };

function validEvent(overrides = {}) {
  return {
    sourceKey: 'official:example:event',
    title: 'Example Event',
    venue: 'Example Hall',
    memo: null,
    sourceUrl: 'https://example.test/event',
    startsOn: '2026-07-11',
    endsOn: '2026-07-11',
    occurrences: [{ startsAt: '2026-07-11T13:00:00+09:00', doorsAt: null, endsAt: null }],
    ...overrides,
  };
}

function fakeAdmin({ event = null, ownerId = owner.id, creator = true } = {}) {
  const rpcCalls = [];
  const rows = { event, ownerId, creator };
  function builder(table) {
    const state = { table };
    return {
      select() {
        return this;
      },
      eq(column, value) {
        state[column] = value;
        return this;
      },
      maybeSingle: async () => {
        if (table === 'catalog_creators')
          return { data: rows.creator ? { user_id: rows.ownerId } : null, error: null };
        if (table === 'events')
          return {
            data: rows.event && rows.event.source_key === state.source_key ? rows.event : null,
            error: null,
          };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        const data =
          table === 'genres' ? [{ id: 'genre-1', key: 'theatre', display_name: 'Theatre' }] : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
  }
  return {
    rpcCalls,
    from(table) {
      if (table === 'event_occurrences') {
        return {
          select: () => ({
            eq: async () => ({ data: rows.event?.occurrences ?? [], error: null }),
          }),
        };
      }
      if (table === 'event_groups') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      return builder(table);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return name === 'import_event_with_occurrences'
        ? { data: { id: 'created-event-1' }, error: null }
        : { data: null, error: null };
    },
  };
}

void test('Event core preserves shape, run-wide duplicate, and classification validation', () => {
  assert.equal(validateEventEntry(validEvent()).ok, true);
  const invalid = validateEventEntry(validEvent({ startsOn: '2026-07-12' }), 'seed.json[0]');
  assert.equal(invalid.ok, false);
  assert.ok(invalid.problems.some((problem) => problem.includes("outside the event's range")));
  const duplicate = validateEventEntries([
    { raw: validEvent(), where: 'a.json[0]' },
    { raw: validEvent(), where: 'b.json[0]' },
  ]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.problems[0], /Duplicate sourceKey/);
  const conflict = validateEventEntries([
    { raw: validEvent({ groups: [{ key: 'cast', displayName: 'Cast A' }] }), where: 'a.json[0]' },
    {
      raw: validEvent({ sourceKey: 'other', groups: [{ key: 'cast', displayName: 'Cast B' }] }),
      where: 'b.json[0]',
    },
  ]);
  assert.equal(conflict.ok, false);
  assert.match(conflict.problems[0], /Conflicting group definitions/);
});

void test('Event core creates and applies through existing atomic RPCs with structured report', async () => {
  const admin = fakeAdmin();
  const validated = validateEventEntries([
    { raw: validEvent({ genre: 'theatre' }), where: 'seed.json[0]' },
  ]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, {
    owner,
    ownerEmail: owner.email,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.plans[0].action, 'create');
  assert.match(
    formatEventPlanReport(resolved.plans, {
      apply: false,
      remote: false,
      ownerEmail: owner.email,
      ownerId: owner.id,
    }),
    /DRY RUN/,
  );
  const applied = await applyEventPlans(admin, resolved.plans, { ownerId: owner.id });
  assert.deepEqual(applied, { ok: true, applied: ['official:example:event'] });
  assert.deepEqual(
    admin.rpcCalls.map((call) => call.name),
    ['import_event_with_occurrences', 'import_event_classification'],
  );
});

void test('Event core refuses an existing Event owned by another user during resolution', async () => {
  const admin = fakeAdmin({
    event: { source_key: 'official:example:event', owner_id: 'other-owner' },
  });
  const validated = validateEventEntries([{ raw: validEvent(), where: 'seed.json[0]' }]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, {
    owner,
    ownerEmail: owner.email,
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.problems[0], /Refusing to touch it/);
});
