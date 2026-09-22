import { getStepMetadata, RetryableError } from "workflow";
import { createFoundationCandidatePlanner } from "../adapter-registry";
import {
  executeOfficialImportCandidateApply,
  OfficialImportApplyAttemptRetryError,
} from "../apply-execution";
import { createOfficialImportApplyRepository } from "../privileged/apply-repository";
import { createOfficialImportCatalogGateway } from "../privileged/catalog-apply-gateway";
import { deriveOfficialImportApplyAttemptToken } from "../run-identity";

export async function applyApprovedOfficialImportCandidate(
  candidateId: string,
) {
  "use step";

  const { attempt, stepId } = getStepMetadata();
  const attemptToken = deriveOfficialImportApplyAttemptToken(stepId, attempt);
  try {
    return await executeOfficialImportCandidateApply(
      candidateId,
      attemptToken,
      createFoundationCandidatePlanner(),
      createOfficialImportApplyRepository(),
      createOfficialImportCatalogGateway(),
    );
  } catch (error) {
    if (!(error instanceof OfficialImportApplyAttemptRetryError)) throw error;
    const retryAfter =
      error.retryAfterMs ?? Math.min(1_000 * 2 ** (attempt - 1), 30_000);
    console.warn("Official import candidate apply will retry", {
      attempt,
      candidateId,
      reason: error.reason,
    });
    throw new RetryableError("Official import candidate apply will retry", {
      retryAfter,
    });
  }
}
