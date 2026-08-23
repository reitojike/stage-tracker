import type { PlanningResult } from './planningError.ts';

// Pure classification of a typed personal schedule read (PlanningResult)
// into the UI state the schedule feature (Issue #37) must render distinctly
// (docs/ux-ui.md "Common states"): a read failure (RLS/auth/network) must
// never be presented the same way as a successful read that simply found
// nothing. Mirrors domain/catalogReadState.ts's resolveCatalogReadState,
// but over PlanningResult's {kind,message,code} error shape rather than
// EventCatalogReadResult's.

export type PersonalScheduleReadStateKind = 'error' | 'empty' | 'populated';

export function resolvePersonalScheduleReadState<T>(
  result: PlanningResult<T>,
  isEmpty: (data: T) => boolean,
): PersonalScheduleReadStateKind {
  if (!result.ok) {
    return 'error';
  }
  return isEmpty(result.data) ? 'empty' : 'populated';
}
