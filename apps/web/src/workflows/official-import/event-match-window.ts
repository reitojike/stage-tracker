export const EVENT_MATCH_LIMIT = 20;

export class EventMatchWindowExceededFailure extends Error {
  constructor() {
    super("Bounded Event match window exceeded");
    this.name = "EventMatchWindowExceededFailure";
  }
}

export function requireCompleteEventMatchWindow<T>(
  rows: readonly T[],
): readonly T[] {
  if (rows.length > EVENT_MATCH_LIMIT) {
    throw new EventMatchWindowExceededFailure();
  }
  return rows;
}
