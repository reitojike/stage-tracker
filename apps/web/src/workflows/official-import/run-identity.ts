import { createHash } from "node:crypto";

/** Stable UUID used to make a durable Workflow step's staging run retry-safe. */
export function deriveOfficialImportRunId(stepId: string): string {
  if (stepId.length === 0) throw new Error("Workflow step ID is required");
  const digest = createHash("sha256")
    .update(`official-import-shadow:${stepId}`)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
