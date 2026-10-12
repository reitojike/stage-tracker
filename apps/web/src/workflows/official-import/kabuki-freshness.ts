export const KABUKI_FRESHNESS_REFUSAL_CODE = "40001";
export const KABUKI_FRESHNESS_REFUSAL_DETAILS =
  "stage_tracker.kabuki_freshness_refused.v1";

/**
 * Recognizes only the reserved Kabuki freshness refusal emitted by the claim
 * RPC. The source is unknown before a claim succeeds, so the marker itself is
 * a Kabuki-only producer contract. Ordinary 40001 conflicts, other details
 * and transport errors keep the existing exception/retry handling.
 */
export function isKabukiFreshnessRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error) || !("details" in error)) return false;
  return (
    error.code === KABUKI_FRESHNESS_REFUSAL_CODE &&
    error.details === KABUKI_FRESHNESS_REFUSAL_DETAILS
  );
}
