import { getStepMetadata } from "workflow";
import {
  foundationCandidatePlanner,
  getSourceFamilyAdapter,
} from "../adapter-registry";
import { createOfficialImportStagingRepository } from "../privileged/staging-repository";
import { deriveOfficialImportRunId } from "../run-identity";
import { executeOfficialImportShadowRun } from "../shadow-execution";
import { requireEnabledShadowSource } from "../source-registry";

export async function runOfficialImportShadowSource(sourceId: string) {
  "use step";

  const source = requireEnabledShadowSource(sourceId);
  const { stepId } = getStepMetadata();
  const runId = deriveOfficialImportRunId(stepId);
  return executeOfficialImportShadowRun(
    runId,
    source,
    getSourceFamilyAdapter(source.adapter),
    foundationCandidatePlanner,
    createOfficialImportStagingRepository(),
  );
}
