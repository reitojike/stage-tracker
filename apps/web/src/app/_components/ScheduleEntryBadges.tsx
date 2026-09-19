import { Badge } from "@stage-tracker/ui";

export interface ScheduleEntryBadgesProps {
  readonly isOwner: boolean;
  readonly blocking: boolean;
}

/**
 * Product-specific presentation for a personal schedule entry. Callers keep
 * ownership and blocking decisions; this component owns their repeated labels
 * and Badge mapping across Home, Calendar, and Detail.
 */
export function ScheduleEntryBadges({
  isOwner,
  blocking,
}: ScheduleEntryBadgesProps) {
  return (
    <>
      <Badge variant="subtle">
        {isOwner ? "自分の予定" : "共有されている予定"}
      </Badge>
      <Badge
        data-testid="blocking-indicator"
        variant={blocking ? "subtle" : "outline"}
      >
        {blocking ? "予定を確保する" : "予定を確保しない"}
      </Badge>
    </>
  );
}
