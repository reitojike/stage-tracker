import "server-only";

import { err, ok } from "@stage-tracker/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/data/database.types";
import { readError } from "@/lib/data/read-error";
import type { ReadResult } from "@/lib/data/read-result";
import { runSupabaseSelect } from "@/lib/data/supabase-select";

const KABUKI_SOURCE_ID = "event.kabuki-bito.schedule";
const TICKET_SOURCE_ID = "ticket.shochiku.schedule";
const runSchema = z.object({
  id: z.uuid(),
  started_at: z.iso.datetime({ offset: true }),
});
const latestTicketRunSchema = z.object({
  started_at: z.iso.datetime({ offset: true }),
  status: z.enum(["running", "completed", "failed"]),
});
const heldPageSchema = z.object({
  canonical_url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "www.kabuki-bito.jp" &&
        /^\/theaters\/[^/]+\/play\/\d+\/?$/u.test(url.pathname)
      );
    } catch {
      return false;
    }
  }),
  official_external_id: z.string().min(1).max(512),
  title: z.string().min(1).max(512),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  reason_code: z.enum(["source_parse", "published_end_missing"]),
});

export interface KabukiHeldPageReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly pages: readonly {
    readonly canonicalUrl: string;
    readonly officialExternalId: string;
    readonly title: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly reasonCode: "source_parse" | "published_end_missing";
  }[];
}

export interface LatestTicketRun {
  readonly startedAt: string;
  readonly status: "running" | "completed" | "failed";
}

export async function loadLatestShochikuTicketRun(
  client: SupabaseClient<Database>,
): Promise<ReadResult<LatestTicketRun | null>> {
  const runs = await runSupabaseSelect(
    client
      .from("official_import_runs")
      .select("started_at, status")
      .eq("source_id", TICKET_SOURCE_ID)
      .order("started_at", { ascending: false })
      .limit(1),
  );
  if (!runs.ok) return runs;
  if (runs.value.length === 0) return ok(null);
  const run = latestTicketRunSchema.safeParse(runs.value[0]);
  if (!run.success) return err(readError("failure"));
  return ok({ startedAt: run.data.started_at, status: run.data.status });
}

async function loadLatestHeldPageReport(
  client: SupabaseClient<Database>,
  sourceId: string,
): Promise<ReadResult<KabukiHeldPageReport | null>> {
  const runs = await runSupabaseSelect(
    client
      .from("official_import_runs")
      .select("id, started_at")
      .eq("source_id", sourceId)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(1),
  );
  if (!runs.ok) return runs;
  if (runs.value.length === 0) return ok(null);
  const run = runSchema.safeParse(runs.value[0]);
  if (!run.success) return err(readError("failure"));

  const held = await runSupabaseSelect(
    client
      .from("official_import_held_pages")
      .select(
        "canonical_url, official_external_id, title, starts_on, ends_on, reason_code",
      )
      .eq("run_id", run.data.id)
      .eq("source_id", sourceId)
      .order("canonical_url", { ascending: true })
      .limit(31),
  );
  if (!held.ok) return held;
  if (held.value.length > 30) return err(readError("failure"));
  const parsed = z.array(heldPageSchema).safeParse(held.value);
  if (!parsed.success) return err(readError("failure"));
  return ok({
    runId: run.data.id,
    startedAt: run.data.started_at,
    pages: parsed.data.map((page) => ({
      canonicalUrl: page.canonical_url,
      officialExternalId: page.official_external_id,
      title: page.title,
      startsOn: page.starts_on,
      endsOn: page.ends_on,
      reasonCode: page.reason_code,
    })),
  });
}

export function loadLatestKabukiHeldPageReport(
  client: SupabaseClient<Database>,
): Promise<ReadResult<KabukiHeldPageReport | null>> {
  return loadLatestHeldPageReport(client, KABUKI_SOURCE_ID);
}

export function loadLatestShochikuTicketHeldPageReport(
  client: SupabaseClient<Database>,
): Promise<ReadResult<KabukiHeldPageReport | null>> {
  return loadLatestHeldPageReport(client, TICKET_SOURCE_ID);
}
