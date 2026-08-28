'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { TriStateCheckbox } from '@/ui/TriStateCheckbox';
import type { CatalogFilterSelection, Genre, Group } from '@/domain/eventCatalog.ts';
import {
  applyAggregateToggle,
  CATALOG_FILTER_STORAGE_KEY,
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
   * Gate A) need an entry here. */
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>;
  /** genre key -> that genre's own catalog-wide venue text (#167
   * `listCatalogVenueOptions(client, genreId)`, re-keyed by genre key).
   * Only genres whose active facet is venue (歌舞伎 in Gate A) need an
   * entry here. */
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>;
  /** Fires with the current applied selection whenever it changes,
   * including once on mount after browser-local persistence is restored
   * (Issue #147) - the caller (#145) never needs to read localStorage
   * itself. This component performs no Catalog result filtering on its
   * own. */
  onAppliedSelectionChange: (selection: CatalogFilterSelection) => void;
}

function secondaryOptionsForGenre(
  genreKey: string | null,
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): readonly CatalogFilterSecondaryOption[] {
  if (genreKey === null) {
    return [];
  }
  const kind = secondaryFacetKindForGenreKey(genreKey);
  if (kind === 'group') {
    return (groupOptionsByGenreKey[genreKey] ?? []).map((group) => ({
      value: group.key,
      label: group.displayName,
    }));
  }
  if (kind === 'venue') {
    return (venueOptionsByGenreKey[genreKey] ?? []).map((venue) => ({
      value: venue,
      label: venue,
    }));
  }
  return [];
}

function knownSecondaryValuesByGenre(
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const known: Record<string, readonly string[]> = {};
  for (const [genreKey, groups] of Object.entries(groupOptionsByGenreKey)) {
    known[genreKey] = groups.map((group) => group.key);
  }
  for (const [genreKey, venues] of Object.entries(venueOptionsByGenreKey)) {
    known[genreKey] = venues;
  }
  return known;
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

  // Restores browser-local persistence once on mount (Issue #147 "reload /
  // revisitでも復元する"), pruning any saved genre/value no longer part of
  // the current known option universe before it ever reaches `applied` or
  // the caller. Reads `genres`/`groupOptionsByGenreKey`/`venueOptionsByGenreKey`
  // from the initial render only - this repo's toolchain has no
  // react-hooks/exhaustive-deps rule, and #145 supplies these as
  // already-resolved data rather than something this component should
  // re-hydrate against on every prop change.
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
    const pruned = pruneStaleCatalogFilterState(
      restored,
      genres.map((genre) => genre.key),
      knownSecondaryValuesByGenre(groupOptionsByGenreKey, venueOptionsByGenreKey),
    );
    setApplied(pruned);
    onAppliedSelectionChange(toCatalogFilterSelection(pruned));
    // Mount only (see the comment above this effect) - this repo's
    // toolchain has no react-hooks/exhaustive-deps rule to satisfy.
  }, []);

  // Sheet open time copies applied -> draft (Issue #147 "Filter Sheet
  // open時はcurrent applied selectionをdraftとして編集する"); every
  // in-sheet interaction below only ever calls setDraft, never setApplied.
  useEffect(() => {
    if (open) {
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

  const facetKind = secondaryFacetKindForGenreKey(draft.genre);
  const facetLabel = secondaryFacetLabelForGenreKey(draft.genre);
  const secondaryOptions = secondaryOptionsForGenre(
    draft.genre,
    groupOptionsByGenreKey,
    venueOptionsByGenreKey,
  );
  const knownValues = secondaryOptions.map((option) => option.value);
  const selectedValues = draft.genre !== null ? selectedSecondaryValues(draft, draft.genre) : [];
  const aggregateState = secondaryAggregateState(selectedValues, knownValues);

  function confirm() {
    try {
      window.localStorage.setItem(CATALOG_FILTER_STORAGE_KEY, serializeCatalogFilterState(draft));
    } catch {
      // Storage unavailable (e.g. private browsing quota) - the applied
      // selection still takes effect for this session, it just won't
      // survive reload. Never blocks confirming the filter itself.
    }
    setApplied(draft);
    onAppliedSelectionChange(toCatalogFilterSelection(draft));
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

          {facetKind !== null ? (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>{facetLabel}</p>
              {secondaryOptions.length > 0 ? (
                <TriStateCheckbox
                  state={aggregateState}
                  label={`${facetLabel ?? ''}すべて`}
                  onChange={(next) => {
                    if (draft.genre === null) {
                      return;
                    }
                    setDraft(
                      withSecondarySelection(
                        draft,
                        draft.genre,
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
                    if (draft.genre === null) {
                      return;
                    }
                    setDraft(
                      withSecondarySelection(
                        draft,
                        draft.genre,
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
