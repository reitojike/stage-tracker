import { runOfficialImportShadowSource } from "./steps/run-shadow-source";

export async function officialImportShadowWorkflow(
  sourceId: string,
  tokyoScheduleDate?: string,
) {
  "use workflow";

  return runOfficialImportShadowSource(sourceId, tokyoScheduleDate);
}
