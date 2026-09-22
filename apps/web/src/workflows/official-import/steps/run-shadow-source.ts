import {
  foundationCandidatePlanner,
  getSourceFamilyAdapter,
} from "../adapter-registry";
import { createOfficialImportStagingRepository } from "../privileged/staging-repository";
import { executeOfficialImportShadowRun } from "../shadow-execution";
import { requireEnabledShadowSource } from "../source-registry";

export async function runOfficialImportShadowSource(sourceId: string) {
  "use step";

  const source = requireEnabledShadowSource(sourceId);
  return executeOfficialImportShadowRun(
    source,
    getSourceFamilyAdapter(source.adapter),
    foundationCandidatePlanner,
    createOfficialImportStagingRepository(),
  );
}
