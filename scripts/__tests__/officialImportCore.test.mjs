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

function fakeAdmin({ event = null, ownerId = owner.id, creator = true, groups = [] } = {}) {
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
      in(column, values) {
        state[column] = values;
        return this;
      },
      maybeSingle: async () => {
        if (table === 'catalog_creators')
          return { data: rows.creator ? { user_id: rows.ownerId } : null, error: null };
        if (table === 'events')
          return {
            data:
              rows.event &&
              (rows.event.source_key === state.source_key || rows.event.id === state.id)
                ? rows.event
                : null,
            error: null,
          };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        const data =
          table === 'genres'
            ? [{ id: 'genre-1', key: 'theatre', display_name: 'Theatre' }]
            : table === 'groups'
              ? groups.filter((group) => state.key.includes(group.key))
              : [];
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
      return name === 'apply_import_event_plan'
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

void test('Event core rejects impossible calendar dates before planning', () => {
  for (const [field, value] of [
    ['startsOn', '2026-02-30'],
    ['endsOn', '2026-13-01'],
    ['startsOn', '0000-01-01'],
  ]) {
    const result = validateEventEntry(validEvent({ occurrences: [], [field]: value }));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(`${field} must be a real`)));
  }

  assert.equal(
    validateEventEntry(
      validEvent({ startsOn: '2028-02-29', endsOn: '2028-02-29', occurrences: [] }),
    ).ok,
    true,
  );
  assert.equal(
    validateEventEntry(
      validEvent({ startsOn: '2026-02-29', endsOn: '2026-02-29', occurrences: [] }),
    ).ok,
    false,
  );
});

void test('Event core rejects impossible occurrence calendar components', () => {
  for (const occurrence of [
    { startsAt: '2026-02-30T13:00:00+09:00', doorsAt: null, endsAt: null },
    {
      startsAt: '2026-07-11T13:00:00+09:00',
      doorsAt: '2026-02-30T12:00:00+09:00',
      endsAt: null,
    },
    {
      startsAt: '2026-07-11T13:00:00+09:00',
      doorsAt: null,
      endsAt: '2026-02-30T14:00:00+09:00',
    },
  ]) {
    const result = validateEventEntry(validEvent({ occurrences: [occurrence] }));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('must be a real')));
  }
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
    ['apply_import_event_plan'],
  );
});

void test('Event core can plan a deterministic cross-source match by explicit Event id', async () => {
  const admin = fakeAdmin({
    event: {
      id: 'matched-event-1',
      source_key: 'other-official:event',
      owner_id: owner.id,
      title: 'Older title',
      venue: 'Example Hall',
      source_url: 'https://other.example.test/event',
      memo: null,
      starts_on: '2026-07-11',
      ends_on: '2026-07-11',
      genre_id: null,
      occurrences: [],
    },
  });
  const validated = validateEventEntries([{ raw: validEvent(), where: 'seed.json[0]' }]);
  assert.equal(validated.ok, true);

  const resolved = await resolveEventPlans(admin, validated.entries, {
    owner,
    ownerEmail: owner.email,
    targetEventIdsBySourceKey: new Map([['official:example:event', 'matched-event-1']]),
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.plans[0].action, 'update');
  assert.equal(resolved.plans[0].event.id, 'matched-event-1');
});

void test('reviewed Event apply sends its read snapshot and surfaces a stale catalog', async () => {
  const admin = fakeAdmin({
    event: {
      id: 'matched-event-1',
      source_key: 'official:example:event',
      owner_id: owner.id,
      title: 'Older title',
      venue: 'Example Hall',
      source_url: 'https://example.test/event',
      memo: null,
      starts_on: '2026-07-11',
      ends_on: '2026-07-11',
      genre_id: null,
      canceled_at: null,
      occurrences: [],
    },
  });
  const validated = validateEventEntries([{ raw: validEvent(), where: 'seed.json[0]' }]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, { owner });
  assert.equal(resolved.ok, true);
  admin.rpc = async (name, args) => {
    admin.rpcCalls.push({ name, args });
    return { data: null, error: { code: '40001', message: 'stale catalog' } };
  };

  const result = await applyEventPlans(admin, resolved.plans, {
    ownerId: owner.id,
    reviewed: true,
  });

  assert.equal(admin.rpcCalls[0].name, 'apply_reviewed_import_event_plan');
  assert.equal(admin.rpcCalls[0].args.p_expected_current.event.id, 'matched-event-1');
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
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

void test('reviewed Event plans retain proposed canonical Group labels, including absent keys', async () => {
  const admin = fakeAdmin({
    groups: [{ key: 'existing-group', display_name: 'Current canonical label' }],
  });
  const validated = validateEventEntries([
    {
      raw: validEvent({
        groups: [
          { key: 'existing-group', displayName: 'Reviewed correction' },
          { key: 'new-group', displayName: 'New group' },
        ],
      }),
      where: 'seed.json[0]',
    },
  ]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, { owner });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.plans[0].expectedProposedGroups, [
    { key: 'existing-group', displayName: 'Current canonical label' },
    { key: 'new-group', displayName: null },
  ]);
  await applyEventPlans(admin, resolved.plans, { ownerId: owner.id, reviewed: true });
  assert.deepEqual(
    admin.rpcCalls[0].args.p_expected_proposed_groups,
    resolved.plans[0].expectedProposedGroups,
  );
});

void test('Event apply returns committed progress when a later RPC fails', async () => {
  const admin = fakeAdmin();
  let calls = 0;
  const originalRpc = admin.rpc;
  admin.rpc = async (name, args) => {
    calls += 1;
    if (calls === 2) return { data: null, error: { message: 'later failure' } };
    return originalRpc.call(admin, name, args);
  };
  const validated = validateEventEntries([
    { raw: validEvent({ sourceKey: 'first' }), where: 'seed.json[0]' },
    { raw: validEvent({ sourceKey: 'second' }), where: 'seed.json[1]' },
  ]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, {
    owner,
    ownerEmail: owner.email,
  });
  assert.equal(resolved.ok, true);
  const progress = [];
  const result = await applyEventPlans(admin, resolved.plans, {
    ownerId: owner.id,
    onApplied: (sourceKey) => progress.push(sourceKey),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.applied, ['first']);
  assert.deepEqual(progress, ['first']);
});

void test('Event apply emits prior progress before a later RPC rejection', async () => {
  const admin = fakeAdmin();
  let calls = 0;
  const originalRpc = admin.rpc;
  admin.rpc = async (name, args) => {
    calls += 1;
    if (calls === 2) throw new Error('later rejection');
    return originalRpc.call(admin, name, args);
  };
  const validated = validateEventEntries([
    { raw: validEvent({ sourceKey: 'first' }), where: 'seed.json[0]' },
    { raw: validEvent({ sourceKey: 'second' }), where: 'seed.json[1]' },
  ]);
  assert.equal(validated.ok, true);
  const resolved = await resolveEventPlans(admin, validated.entries, {
    owner,
    ownerEmail: owner.email,
  });
  assert.equal(resolved.ok, true);
  const progress = [];
  await assert.rejects(
    applyEventPlans(admin, resolved.plans, {
      ownerId: owner.id,
      onApplied: (sourceKey) => progress.push(sourceKey),
    }),
    /later rejection/,
  );
  assert.deepEqual(progress, ['first']);
});
