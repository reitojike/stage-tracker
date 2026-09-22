import { getStepMetadata, RetryableError } from "workflow";
import {
  createFoundationCandidatePlanner,
  getSourceFamilyAdapter,
} from "../adapter-registry";
import { createOfficialImportStagingRepository } from "../privileged/staging-repository";
import {
  deriveOfficialImportAttemptToken,
  deriveOfficialImportRunId,
} from "../run-identity";
import {
  executeOfficialImportShadowRun,
  OfficialImportAttemptRetryError,
} from "../shadow-execution";
import { requireEnabledShadowSource } from "../source-registry";

export async function runOfficialImportShadowSource(sourceId: string) {
  "use step";

  const source = requireEnabledShadowSource(sourceId);
  const { attempt, stepId } = getStepMetadata();
  const runId = deriveOfficialImportRunId(stepId);
  const attemptToken = deriveOfficialImportAttemptToken(stepId, attempt);

  try {
    return await executeOfficialImportShadowRun(
      runId,
      attemptToken,
      source,
      getSourceFamilyAdapter(source.extractor),
      createFoundationCandidatePlanner(),
      createOfficialImportStagingRepository(),
    );
  } catch (error) {
    if (!(error instanceof OfficialImportAttemptRetryError)) throw error;

    const retryAfter =
      error.retryAfterMs ?? Math.min(1_000 * 2 ** (attempt - 1), 30_000);
    console.warn("Official import shadow attempt will retry", {
      attempt,
      reason: error.reason,
      runId,
      sourceId: source.id,
    });
    throw new RetryableError("Official import shadow attempt will retry", {
      retryAfter,
    });
  }
}
