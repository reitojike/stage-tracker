import type { EventClassification, GroupId } from "@stage-tracker/domain";
import { Badge } from "@stage-tracker/ui";

export interface ClassificationBadgesProps {
  readonly classification: EventClassification | null;
  /** Resolved group `displayName`s, keyed by id
   * (`../_lib/catalog-filters.ts`'s `groupDisplayNameById`) -
   * `EventClassification.groupIds` only carries ids (see that type's own
   * doc comment), never resolved `Group` rows. */
  readonly groupNameById: ReadonlyMap<GroupId, string>;
  readonly canceled: boolean;
}

/**
 * Genre + group + cancellation badges for one Event, shared by
 * `CatalogView.tsx`'s `EventCatalogRow` and `SelectedDayList.tsx` so the 2
 * card-shaped surfaces this Task adds/touches never drift on which
 * classification facets they show (this Task's confirmed-gap fix: an
 * event's `classification.groupIds` - e.g. 宝塚's 星組, an idol group name -
 * was loaded but never rendered on the card, even though the equivalent
 * catalog-wide group *filter* already worked. AGENTS.md "Catalog
 * classification / venue boundary" does not explicitly require a per-card
 * group badge, but showing already-loaded, event-level classification data
 * on the card it belongs to is a low-risk parity fix consistent with how
 * legacy's own `classificationBadgeLabel`/`EventLevelFallbackList`/
 * `SelectedDayList.tsx` treat classification as ordinary event-level
 * metadata to display, not filter-only data).
 *
 * Unlike legacy's `classificationBadgeLabel` (which folds genre + the
 * *first* group into a single combined string, e.g. "宝塚 / 花組"), this
 * keeps v2's existing separate-Badge style (`EventCatalogRow` already
 * rendered genre as its own `Badge`) and shows every associated group
 * (0..N per AGENTS.md "Group": "Event と group の関連は 0..N"), joined into
 * one Badge rather than one Badge per group, to bound the badge count for a
 * multi-group Event.
 */
export function ClassificationBadges({
  classification,
  groupNameById,
  canceled,
}: ClassificationBadgesProps) {
  const genre = classification?.genre ?? null;
  const groupNames = (classification?.groupIds ?? [])
    .map((id) => groupNameById.get(id))
    .filter((name): name is string => name !== undefined);

  if (genre === null && groupNames.length === 0 && !canceled) {
    return null;
  }

  return (
    <span className="flex flex-wrap items-center gap-xs">
      {genre !== null ? (
        <Badge variant="outline">{genre.displayName}</Badge>
      ) : null}
      {groupNames.length > 0 ? (
        <Badge variant="outline">{groupNames.join("・")}</Badge>
      ) : null}
      {canceled ? <Badge variant="terminal">中止</Badge> : null}
    </span>
  );
}
