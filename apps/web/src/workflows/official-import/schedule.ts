import type { OfficialSourceDefinition } from "./source-registry";

export interface ScheduledSourceSlot {
  readonly source: OfficialSourceDefinition;
  readonly tokyoDate: string;
}

/** Vercel Cron invokes one daily slot; weekly sources use its Monday slot. */
export function dueScheduledSourceSlots(
  sources: readonly OfficialSourceDefinition[],
  now: Date,
): readonly ScheduledSourceSlot[] {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid Cron clock");
  const tokyo = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  const tokyoDate = tokyo.toISOString().slice(0, 10);
  const mondayInTokyo = tokyo.getUTCDay() === 1;
  return sources
    .filter(
      (source) =>
        source.fetchCadenceHint === "daily" ||
        (source.fetchCadenceHint === "weekly" && mondayInTokyo),
    )
    .map((source) => ({ source, tokyoDate }));
}
