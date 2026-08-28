'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { TriStateCheckbox } from '@/ui/TriStateCheckbox';
import type { CatalogFilterSelection, Genre, Group } from '@/domain/eventCatalog.ts';
import {
  activeSecondaryFacet,
  applyAggregateToggle,
  CATALOG_FILTER_STORAGE_KEY,
  EMPTY_CATALOG_FILTER_STATE,
  intersectWithKnownValues,
  parseCatalogFilterState,
  pruneStaleCatalogFilterState,
  secondaryAggregateState,
  selectedSecondaryValues,
  serializeCatalogFilterState,
  toCatalogFilterSelection,
  toggleSecondaryValue,
  withGenre,
  withSecondarySelection,
  type CatalogFilterActiveFacet,
  type CatalogFilterSecondaryOption,
  type CatalogFilterState,
} from '@/domain/catalogFilterSheet.ts';
import styles from './FilterSheet.module.css';

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Catalog-wide genre options (#167 `listCatalogGenres`), Gate A's fixed
   * 宝塚→歌舞伎→アイドル display order first - reused as-is, never
   * re-derived by this component. */
  genres: readonly Genre[];
  /** genre key -> that genre's own catalog-wide group options (#167
   * `listCatalogGroupOptions(client, genreId)`, re-keyed by genre key by
   * the caller). Only genres whose active facet is group (宝塚/アイドル in
   * Gate A) need an entry here; an omitted key is read as "not loaded
   * yet", not "loaded with zero groups" - see
   * domain/catalogFilterSheet.ts's pruneStaleCatalogFilterState. */
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>;
  /** genre key -> that genre's own catalog-wide venue text (#167
   * `listCatalogVenueOptions(client, genreId)`, re-keyed by genre key).
   * Only genres whose active facet is venue (歌舞伎 in Gate A) need an
   * entry here, with the same "omitted = not loaded yet" contract as
   * `groupOptionsByGenreKey` above. */
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>;
  /** Fires with the current applied selection whenever it changes,
   * including once on mount after browser-local persistence is restored
   * (Issue #147) - the caller (#145) never needs to read localStorage
   * itself. This component performs no Catalog result filtering on its
   * own. */
  onAppliedSelectionChange: (selection: CatalogFilterSelection) => void;
}

/** This genre's currently known secondary option rows, dispatched by its
 * own active facet kind - the single dispatch point knownSecondaryValuesByGenre
 * below also goes through, so the two can never disagree about which map
 * (group vs venue) backs a given genre. */
function secondaryOptionsForFacet(
  facet: CatalogFilterActiveFacet | null,
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): readonly CatalogFilterSecondaryOption[] {
  if (facet === null) {
    return [];
  }
  if (facet.kind === 'group') {
    return (groupOptionsByGenreKey[facet.genreKey] ?? []).map((group) => ({
      value: group.key,
      label: group.displayName,
    }));
  }
  return (venueOptionsByGenreKey[facet.genreKey] ?? []).map((venue) => ({
    value: venue,
    label: venue,
  }));
}

/**
 * Every genre's currently known secondary values, keyed by genre - only for
 * a genre whose *own* backing map (group or venue, chosen via the same
 * activeSecondaryFacet dispatch secondaryOptionsForFacet above uses) has an
 * entry for it. A genre key entirely absent from its backing map (not `[]`,
 * literally missing) stays absent from the result too - pruneStaleCatalog
 * FilterState reads that absence as "not loaded yet" and leaves the saved
 * selection untouched, so this must never default a missing key to `[]`
 * the way secondaryOptionsForFacet's own `?? []` does for *rendering*
 * (rendering an empty list and "this genre's data hasn't arrived" need to
 * stay distinguishable here, even though they render identically).
 */
function knownSecondaryValuesByGenre(
  genres: readonly Genre[],
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const known: Record<string, readonly string[]> = {};
  for (const genre of genres) {
    const facet = activeSecondaryFacet(genre.key);
    if (facet === null) {
      continue;
    }
    if (facet.kind === 'group' && facet.genreKey in groupOptionsByGenreKey) {
      known[facet.genreKey] = (groupOptionsByGenreKey[facet.genreKey] ?? []).map(
        (group) => group.key,
      );
    } else if (facet.kind === 'venue' && facet.genreKey in venueOptionsByGenreKey) {
      known[facet.genreKey] = venueOptionsByGenreKey[facet.genreKey] ?? [];
    }
  }
  return known;
}

/** Restricts `state`'s active-genre secondary selection to values present
 * in `knownValues` before it is ever handed to the caller as a live filter
 * (Issue #147 review finding: pruneStaleCatalogFilterState deliberately
 * leaves a "not loaded yet" genre's saved selection untouched so it can
 * still be restored later - but that same untouched value must never be
 * applied as an invisible filter the sheet cannot show a selected row for
 * right now). Only the *returned* state is narrowed; the caller's own
 * `applied`/`draft`/persisted state keeps the raw value. */
function sanitizeForApply(
  state: CatalogFilterState,
  facet: CatalogFilterActiveFacet | null,
  knownValues: readonly string[],
): CatalogFilterState {
  if (facet === null) {
    return state;
  }
  const selected = selectedSecondaryValues(state, facet.genreKey);
  return withSecondarySelection(
    state,
    facet.genreKey,
    intersectWithKnownValues(selected, knownValues),
  );
}

/**
 * Bottom-sheet genre/facet filter (Issue #147, design_handoff_stage_tracker/
 * 11-filter-sheet.md's visual authority, superseded product semantics from
 * #158). Owns its own applied/draft split, browser-local persistence, and
 * stale-value pruning - a caller only supplies catalog-wide option data and
 * an open/close toggle, and receives the resulting #167
 * `CatalogFilterSelection` via `onAppliedSelectionChange`. Applying that
 * selection to Catalog results, and the filter icon/active-indicator that
 * opens this sheet, are #145's responsibility, not this component's.
 *
 * Uses the native `<dialog>` element rather than a hand-rolled overlay: it
 * gets a real modal focus trap, Escape-to-dismiss, and a `::backdrop` for
 * free, all of which "backdrop/close/dismissalで確定せず閉じた場合、
 * current applied selectionは変更しない" needs anyway - the dialog's
 * native `close` event is the single place this component reacts to any
 * kind of dismissal (Escape, backdrop click, or the confirm button), and
 * none of them touch `applied` except the confirm button's own handler,
 * which runs before it calls `.close()`.
 */
export function FilterSheet({
  open,
  onOpenChange,
  genres,
  groupOptionsByGenreKey,
  venueOptionsByGenreKey,
  onAppliedSelectionChange,
}: FilterSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [applied, setApplied] = useState<CatalogFilterState>(EMPTY_CATALOG_FILTER_STATE);
  const [draft, setDraft] = useState<CatalogFilterState>(EMPTY_CATALOG_FILTER_STATE);
  // Tracks the *previous* render's `open`, purely to detect a genuine
  // false->true transition below - not a state value, so updating it never
  // triggers a re-render by itself.
  const wasOpenRef = useRef(open);

  // Restores browser-local persistence once on mount (Issue #147 "reload /
  // revisitでも復元する"), pruning any saved genre/value no longer part of
  // the current known option universe before it ever reaches `applied` or
  // `draft`. Reads `genres`/`groupOptionsByGenreKey`/`venueOptionsByGenreKey`
  // from the initial render only - this repo's toolchain has no
  // react-hooks/exhaustive-deps rule, and #145 supplies these as
  // already-resolved data rather than something this component should
  // re-hydrate against on every prop change.
  //
  // Sets `draft` here too (not only `applied`) so the sheet renders the
  // restored selection correctly even if it happens to mount already
  // `open` - see the open-transition effect below for why relying on that
  // effect alone to copy `applied` into `draft` on this same first commit
  // would use a stale, pre-restore `applied` closure instead.
  useEffect(() => {
    let restored = EMPTY_CATALOG_FILTER_STATE;
    try {
      const raw = window.localStorage.getItem(CATALOG_FILTER_STORAGE_KEY);
      if (raw !== null) {
        restored = parseCatalogFilterState(raw);
      }
    } catch {
      restored = EMPTY_CATALOG_FILTER_STATE;
    }
    const knownMap = knownSecondaryValuesByGenre(
      genres,
      groupOptionsByGenreKey,
      venueOptionsByGenreKey,
    );
    const pruned = pruneStaleCatalogFilterState(
      restored,
      genres.map((genre) => genre.key),
      knownMap,
    );
    setApplied(pruned);
    setDraft(pruned);

    const facet = activeSecondaryFacet(pruned.genre);
    const knownValues = facet !== null ? (knownMap[facet.genreKey] ?? []) : [];
    onAppliedSelectionChange(
      toCatalogFilterSelection(sanitizeForApply(pruned, facet, knownValues)),
    );
    // Mount only (see the comment above this effect) - this repo's
    // toolchain has no react-hooks/exhaustive-deps rule to satisfy.
  }, []);

  // Sheet open time copies applied -> draft (Issue #147 "Filter Sheet
  // open時はcurrent applied selectionをdraftとして編集する"), but only on a
  // genuine false->true transition (`wasOpenRef` tracks the prior render's
  // `open`) - never on the initial mount, even if the caller happens to
  // render this component already `open`. Without that guard, a component
  // that mounts already open would run this effect in the same batch as
  // the mount-restore effect above, before that effect's `setApplied`
  // result has actually re-rendered - reading a stale, pre-restore
  // `applied` from this render's closure and overwriting the mount effect's
  // own `setDraft(pruned)` with it.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      setDraft(applied);
    }
  }, [open, applied]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const activeFacet = activeSecondaryFacet(draft.genre);
  const secondaryOptions = secondaryOptionsForFacet(
    activeFacet,
    groupOptionsByGenreKey,
    venueOptionsByGenreKey,
  );
  const knownValues = secondaryOptions.map((option) => option.value);
  const selectedValues =
    activeFacet !== null ? selectedSecondaryValues(draft, activeFacet.genreKey) : [];
  const aggregateState = secondaryAggregateState(selectedValues, knownValues);

  function confirm() {
    try {
      window.localStorage.setItem(CATALOG_FILTER_STORAGE_KEY, serializeCatalogFilterState(draft));
    } catch {
      // Storage unavailable (e.g. private browsing quota) - the applied
      // selection still takes effect for this session, it just won't
      // survive reload. Never blocks confirming the filter itself.
    }
    // `draft` (not the sanitized value below) becomes the new `applied` -
    // a secondary value the UI could not currently show as selected (not
    // in `knownValues`, e.g. still loading) is still worth remembering for
    // a future restore once it does load; only the value actually handed
    // to the caller as a live filter is narrowed to what's known right now.
    setApplied(draft);
    onAppliedSelectionChange(
      toCatalogFilterSelection(sanitizeForApply(draft, activeFacet, knownValues)),
    );
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={() => {
        onOpenChange(false);
      }}
      onClick={(event) => {
        // A click landing on the <dialog> element itself (never a child -
        // children stop propagation from ever reaching this handler's
        // target check) is a backdrop click: dismiss without committing
        // draft, same as Escape (Issue #147 "backdrop / close / dismissal
        // で確定せず閉じた場合、current applied selectionは変更しない").
        if (event.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className={styles.sheet}>
        <p id={titleId} className={styles.title}>
          絞り込み
        </p>

        <div className={styles.body}>
          <div className={styles.section} role="radiogroup" aria-label="ジャンル">
            <label className={styles.row}>
              <input
                type="radio"
                name="catalog-filter-genre"
                className={styles.radio}
                checked={draft.genre === null}
                onChange={() => {
                  setDraft(withGenre(draft, null));
                }}
              />
              <span className={styles.rowLabel}>すべて</span>
            </label>
            {genres.map((genre) => (
              <label key={genre.id} className={styles.row}>
                <input
                  type="radio"
                  name="catalog-filter-genre"
                  className={styles.radio}
                  checked={draft.genre === genre.key}
                  onChange={() => {
                    setDraft(withGenre(draft, genre.key));
                  }}
                />
                <span className={styles.rowLabel}>{genre.displayName}</span>
              </label>
            ))}
          </div>

          {activeFacet !== null ? (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>{activeFacet.label}</p>
              {secondaryOptions.length > 0 ? (
                <TriStateCheckbox
                  state={aggregateState}
                  label={`${activeFacet.label}すべて`}
                  onChange={(next) => {
                    setDraft(
                      withSecondarySelection(
                        draft,
                        activeFacet.genreKey,
                        applyAggregateToggle(knownValues, next),
                      ),
                    );
                  }}
                />
              ) : null}
              {secondaryOptions.map((option) => (
                <TriStateCheckbox
                  key={option.value}
                  state={selectedValues.includes(option.value) ? 'checked' : 'unchecked'}
                  label={option.label}
                  onChange={() => {
                    setDraft(
                      withSecondarySelection(
                        draft,
                        activeFacet.genreKey,
                        toggleSecondaryValue(selectedValues, option.value),
                      ),
                    );
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.footer}>
          <Button variant="primary" className={styles.confirmButton} onClick={confirm}>
            この条件で絞り込む
          </Button>
        </div>
      </div>
    </dialog>
  );
}
