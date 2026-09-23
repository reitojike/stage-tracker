import { createHash } from "node:crypto";

function uuidFromDigest(digest: string): string {
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

/** Stable UUID used to make a durable Workflow step's staging run retry-safe. */
export function deriveOfficialImportRunId(stepId: string): string {
  if (stepId.length === 0) throw new Error("Workflow step ID is required");
  const digest = createHash("sha256")
    .update(`official-import-shadow:${stepId}`)
    .digest("hex");
  return uuidFromDigest(digest);
}

/** Same official source and Tokyo schedule date share one durable run ID. */
export function deriveOfficialImportScheduledRunId(
  sourceId: string,
  tokyoDate: string,
): string {
  if (sourceId.length === 0 || sourceId.length > 128)
    throw new Error("Scheduled source ID is invalid");
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(tokyoDate) ||
    Number.isNaN(Date.parse(`${tokyoDate}T00:00:00Z`)) ||
    new Date(`${tokyoDate}T00:00:00Z`).toISOString().slice(0, 10) !== tokyoDate
  )
    throw new Error("Tokyo schedule date is invalid");
  const digest = createHash("sha256")
    .update(`official-import-scheduled:${sourceId}:${tokyoDate}`)
    .digest("hex");
  return uuidFromDigest(digest);
}

/** Retry-specific token; unlike the run ID, this changes for every attempt. */
export function deriveOfficialImportAttemptToken(
  stepId: string,
  attempt: number,
): string {
  if (stepId.length === 0) throw new Error("Workflow step ID is required");
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error("Workflow attempt must be a positive integer");
  return createHash("sha256")
    .update(`official-import-shadow-attempt:${stepId}:${attempt}`)
    .digest("hex");
}

/** Retry-specific ownership token for an approved candidate apply step. */
export function deriveOfficialImportApplyAttemptToken(
  stepId: string,
  attempt: number,
): string {
  if (stepId.length === 0) throw new Error("Workflow step ID is required");
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error("Workflow attempt must be a positive integer");
  return createHash("sha256")
    .update(`official-import-apply-attempt:${stepId}:${attempt}`)
    .digest("hex");
}
