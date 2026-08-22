import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapParticipationRow,
  sortParticipations,
  type RawParticipationRow,
} from '../participation.ts';

function rawParticipationRow(overrides: Partial<RawParticipationRow> = {}): RawParticipationRow {
  return {
    id: 'participation-1',
    occurrence_id: 'occurrence-1',
    user_id: 'user-1',
    status: 'considering',
    visibility: 'private',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapParticipationRow maps every column to its domain field', () => {
  const mapped = mapParticipationRow(
    rawParticipationRow({ status: 'attending', visibility: 'public' }),
  );
  assert.deepEqual(mapped, {
    id: 'participation-1',
    occurrenceId: 'occurrence-1',
    userId: 'user-1',
    status: 'attending',
    visibility: 'public',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
});

void test('sortParticipations orders by createdAt ascending, id as tie-breaker', () => {
  const older = mapParticipationRow(
    rawParticipationRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }),
  );
  const newer = mapParticipationRow(
    rawParticipationRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }),
  );
  const sameInstantA = mapParticipationRow(
    rawParticipationRow({ id: 'z', created_at: '2026-01-03T00:00:00Z' }),
  );
  const sameInstantB = mapParticipationRow(
    rawParticipationRow({ id: 'y', created_at: '2026-01-03T00:00:00Z' }),
  );

  const sorted = sortParticipations([sameInstantA, newer, sameInstantB, older]);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['b', 'a', 'y', 'z'],
  );
});

void test('sortParticipations does not mutate its input array', () => {
  const a = mapParticipationRow(
    rawParticipationRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }),
  );
  const b = mapParticipationRow(
    rawParticipationRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }),
  );
  const input = [a, b];
  sortParticipations(input);
  assert.deepEqual(
    input.map((p) => p.id),
    ['a', 'b'],
  );
});
