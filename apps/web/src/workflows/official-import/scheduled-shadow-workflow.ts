import { runOfficialImportShadowSource } from "./steps/run-shadow-source";

export interface ScheduledShadowSource {
  readonly sourceId: string;
  readonly tokyoDate: string;
}

/** Complete Event acquisition before starting Ticket acquisition. */
export async function officialImportScheduledShadowWorkflow(
  sources: readonly ScheduledShadowSource[],
) {
  "use workflow";

  let failed = false;
  for (const source of sources) {
    try {
      const result = await runOfficialImportShadowSource(
        source.sourceId,
        source.tokyoDate,
      );
      if (result.status === "failed") failed = true;
    } catch {
      failed = true;
      console.error("Scheduled official import source failed", {
        sourceId: source.sourceId,
      });
    }
  }
  if (failed) throw new Error("One or more scheduled official imports failed");
}
