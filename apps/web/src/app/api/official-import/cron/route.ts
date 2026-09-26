import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { env } from "@/env";
import { dueScheduledSourceSlots } from "@/workflows/official-import/schedule";
import { officialImportScheduledShadowWorkflow } from "@/workflows/official-import/scheduled-shadow-workflow";
import { listScheduledShadowSources } from "@/workflows/official-import/source-registry";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

function authorized(request: Request, secret: string): boolean {
  const actual = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(actual, expected);
}

/** Production-only and authenticated; starts only code-owned due shadow sources. */
export async function GET(request: Request): Promise<NextResponse> {
  if (process.env.VERCEL_ENV !== "production")
    return NextResponse.json(
      { error: "not_available" },
      { status: 404, headers: NO_STORE },
    );

  const secret = env.CRON_SECRET;
  if (secret === undefined)
    return NextResponse.json(
      { error: "not_configured" },
      { status: 503, headers: NO_STORE },
    );
  if (!authorized(request, secret))
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );

  const slots = dueScheduledSourceSlots(
    listScheduledShadowSources(),
    new Date(),
  );
  if (slots.length === 0)
    return new NextResponse(null, { status: 204, headers: NO_STORE });

  try {
    await start(officialImportScheduledShadowWorkflow, [
      slots.map(({ source, tokyoDate }) => ({
        sourceId: source.id,
        tokyoDate,
      })),
    ]);
  } catch {
    console.error("Official import Cron could not start scheduled sources", {
      scheduled: slots.length,
    });
    return NextResponse.json(
      { error: "start_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { started: slots.length },
    { status: 202, headers: NO_STORE },
  );
}
