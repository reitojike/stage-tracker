import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { userIdSchema } from "@stage-tracker/domain";
import { isDesignatedCatalogCreator } from "@/lib/data/creator-capability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { officialImportShadowWorkflow } from "@/workflows/official-import/shadow-workflow";
import { getOfficialSource } from "@/workflows/official-import/source-registry";

const requestSchema = z
  .object({ sourceId: z.string().min(1).max(128) })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const source = getOfficialSource(parsed.data.sourceId);
  if (
    source === null ||
    !source.enabled ||
    !source.shadow ||
    source.policyState !== "approved"
  ) {
    return NextResponse.json(
      { error: "source_not_available" },
      { status: 404 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = userIdSchema.safeParse(data.user.id);
  if (!userId.success) {
    return NextResponse.json(
      { error: "authentication_failure" },
      { status: 500 },
    );
  }
  if (!(await isDesignatedCatalogCreator(supabase, userId.data))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const run = await start(officialImportShadowWorkflow, [source.id]);
  return NextResponse.json(
    { workflowRunId: run.runId, sourceId: source.id, mode: "shadow" },
    { status: 202 },
  );
}
