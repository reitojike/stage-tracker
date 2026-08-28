import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAggregateToggle,
  EMPTY_CATALOG_FILTER_STATE,
  parseCatalogFilterState,
  pruneStaleCatalogFilterState,
  secondaryAggregateState,
  secondaryFacetKindForGenreKey,
  secondaryFacetLabelForGenreKey,
  selectedSecondaryValues,
  serializeCatalogFilterState,
  toCatalogFilterSelection,
  toggleSecondaryValue,
  withGenre,
  withSecondarySelection,
  type CatalogFilterState,
} from '../catalogFilterSheet.ts';

void test('secondaryFacetKindForGenreKey maps Gate A genres to their #158 facet', () => {
  assert.equal(secondaryFacetKindForGenreKey('takarazuka'), 'group');
  assert.equal(secondaryFacetKindForGenreKey('kabuki'), 'venue');
  assert.equal(secondaryFacetKindForGenreKey('idol'), 'group');
});

void test('secondaryFacetKindForGenreKey has no facet for すべて (null) or an unmapped genre', () => {
  assert.equal(secondaryFacetKindForGenreKey(null), null);
  assert.equal(secondaryFacetKindForGenreKey('some-future-genre'), null);
});

void test('secondaryFacetLabelForGenreKey matches product-rules.md facet labels', () => {
  assert.equal(secondaryFacetLabelForGenreKey('takarazuka'), '組');
  assert.equal(secondaryFacetLabelForGenreKey('kabuki'), '会場');
  assert.equal(secondaryFacetLabelForGenreKey('idol'), 'グループ');
  assert.equal(secondaryFacetLabelForGenreKey(null), null);
});

void test('withGenre only changes the active genre, never touching remembered secondary selections', () => {
  const state = withSecondarySelection(EMPTY_CATALOG_FILTER_STATE, 'takarazuka', ['hana']);
  const next = withGenre(state, 'kabuki');
  assert.equal(next.genre, 'kabuki');
  assert.deepEqual(selectedSecondaryValues(next, 'takarazuka'), ['hana']);
});

void test('withSecondarySelection replaces only the given genre entry', () => {
  const state = withSecondarySelection(EMPTY_CATALOG_FILTER_STATE, 'takarazuka', ['hana']);
  const next = withSecondarySelection(state, 'idol', ['group-a']);
  assert.deepEqual(selectedSecondaryValues(next, 'takarazuka'), ['hana']);
  assert.deepEqual(selectedSecondaryValues(next, 'idol'), ['group-a']);
});

void test('toggleSecondaryValue adds an absent value and removes a present one', () => {
  assert.deepEqual(toggleSecondaryValue([], 'hana'), ['hana']);
  assert.deepEqual(toggleSecondaryValue(['hana'], 'hana'), []);
  assert.deepEqual(toggleSecondaryValue(['hana'], 'tsuki'), ['hana', 'tsuki']);
});

void test('secondaryAggregateState is unchecked for none selected (including zero known options)', () => {
  assert.equal(secondaryAggregateState([], ['a', 'b']), 'unchecked');
  assert.equal(secondaryAggregateState([], []), 'unchecked');
});

void test('secondaryAggregateState is indeterminate for a partial selection', () => {
  assert.equal(secondaryAggregateState(['a'], ['a', 'b']), 'indeterminate');
});

void test('secondaryAggregateState is checked when every known option is selected', () => {
  assert.equal(secondaryAggregateState(['a', 'b'], ['a', 'b']), 'checked');
});

void test('applyAggregateToggle selects every known value or clears the selection', () => {
  assert.deepEqual(applyAggregateToggle(['a', 'b'], 'checked'), ['a', 'b']);
  assert.deepEqual(applyAggregateToggle(['a', 'b'], 'unchecked'), []);
});

void test("toCatalogFilterSelection carries only the active genre's facet into groups/venues", () => {
  let state = withGenre(EMPTY_CATALOG_FILTER_STATE, 'takarazuka');
  state = withSecondarySelection(state, 'takarazuka', ['hana']);
  // A different genre's remembered selection must never leak into the
  // applied filter while it isn't the active facet.
  state = withSecondarySelection(state, 'kabuki', ['kabukiza']);

  const selection = toCatalogFilterSelection(state);
  assert.equal(selection.genre, 'takarazuka');
  assert.deepEqual(selection.groups, ['hana']);
  assert.deepEqual(selection.venues, []);
});

void test('toCatalogFilterSelection for すべて (genre null) carries no facet selection at all', () => {
  let state = withSecondarySelection(EMPTY_CATALOG_FILTER_STATE, 'takarazuka', ['hana']);
  state = withGenre(state, null);

  const selection = toCatalogFilterSelection(state);
  assert.equal(selection.genre, null);
  assert.deepEqual(selection.groups, []);
  assert.deepEqual(selection.venues, []);
});

void test('toCatalogFilterSelection routes a venue-facet genre into venues, not groups', () => {
  let state = withGenre(EMPTY_CATALOG_FILTER_STATE, 'kabuki');
  state = withSecondarySelection(state, 'kabuki', ['歌舞伎座']);

  const selection = toCatalogFilterSelection(state);
  assert.deepEqual(selection.venues, ['歌舞伎座']);
  assert.deepEqual(selection.groups, []);
});

void test('pruneStaleCatalogFilterState resets the active genre to すべて when it is no longer known', () => {
  const state = withGenre(EMPTY_CATALOG_FILTER_STATE, 'retired-genre');
  const pruned = pruneStaleCatalogFilterState(state, ['takarazuka', 'kabuki', 'idol'], {});
  assert.equal(pruned.genre, null);
});

void test('pruneStaleCatalogFilterState keeps a still-known active genre untouched', () => {
  const state = withGenre(EMPTY_CATALOG_FILTER_STATE, 'takarazuka');
  const pruned = pruneStaleCatalogFilterState(state, ['takarazuka', 'kabuki', 'idol'], {});
  assert.equal(pruned.genre, 'takarazuka');
});

void test('pruneStaleCatalogFilterState drops selected values no longer in the known universe', () => {
  const state = withSecondarySelection(EMPTY_CATALOG_FILTER_STATE, 'takarazuka', [
    'hana',
    'retired-group',
  ]);
  const pruned = pruneStaleCatalogFilterState(state, ['takarazuka'], {
    takarazuka: ['hana', 'tsuki'],
  });
  assert.deepEqual(selectedSecondaryValues(pruned, 'takarazuka'), ['hana']);
});

void test('pruneStaleCatalogFilterState leaves a genre untouched when its option universe was not supplied (still loading)', () => {
  const state = withSecondarySelection(EMPTY_CATALOG_FILTER_STATE, 'idol', ['group-a']);
  const pruned = pruneStaleCatalogFilterState(state, ['takarazuka', 'kabuki', 'idol'], {});
  assert.deepEqual(selectedSecondaryValues(pruned, 'idol'), ['group-a']);
});

void test('serializeCatalogFilterState/parseCatalogFilterState round-trip', () => {
  let state = withGenre(EMPTY_CATALOG_FILTER_STATE, 'takarazuka');
  state = withSecondarySelection(state, 'takarazuka', ['hana', 'tsuki']);
  state = withSecondarySelection(state, 'kabuki', ['歌舞伎座']);

  const restored = parseCatalogFilterState(serializeCatalogFilterState(state));
  assert.deepEqual(restored, state satisfies CatalogFilterState);
});

void test('parseCatalogFilterState falls back to empty state on malformed JSON', () => {
  assert.deepEqual(parseCatalogFilterState('not json'), EMPTY_CATALOG_FILTER_STATE);
});

void test('parseCatalogFilterState falls back to empty state when version is missing or mismatched', () => {
  assert.deepEqual(parseCatalogFilterState('{}'), EMPTY_CATALOG_FILTER_STATE);
  assert.deepEqual(
    parseCatalogFilterState(JSON.stringify({ version: 999, genre: 'takarazuka' })),
    EMPTY_CATALOG_FILTER_STATE,
  );
});

void test('parseCatalogFilterState ignores a malformed secondarySelections field instead of throwing', () => {
  const restored = parseCatalogFilterState(
    JSON.stringify({ version: 1, genre: 'takarazuka', secondarySelections: 'not-a-record' }),
  );
  assert.deepEqual(restored, { genre: 'takarazuka', secondarySelections: {} });
});

void test('parseCatalogFilterState ignores a secondarySelections entry whose value is not a string array', () => {
  const restored = parseCatalogFilterState(
    JSON.stringify({
      version: 1,
      genre: null,
      secondarySelections: { takarazuka: [1, 2, 3] },
    }),
  );
  assert.deepEqual(restored, EMPTY_CATALOG_FILTER_STATE);
});
