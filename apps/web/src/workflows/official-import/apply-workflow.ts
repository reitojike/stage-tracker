import { applyApprovedOfficialImportCandidate } from "./steps/apply-approved-candidate";

export async function officialImportApplyWorkflow(candidateId: string) {
  "use workflow";

  return applyApprovedOfficialImportCandidate(candidateId);
}
