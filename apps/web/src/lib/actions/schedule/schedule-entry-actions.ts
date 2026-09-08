"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  personalScheduleEntryIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
import {
  normalizeMemo,
  parseScheduleEntryTemporal,
  scheduleEntryFormSchema,
  scheduleEntryFormWithIdSchema,
} from "./schedule-entry-form";
import {
  deletePersonalScheduleEntry,
  insertPersonalScheduleEntry,
  updatePersonalScheduleEntry,
} from "./schedule-entry-write";
import { ActionError } from "@/lib/action-error";

/**
 * `docs/v2/oracle-routes-ui.md` §1 の補足: 「schedule 系は成功時に必ず
 * `/calendar` へ redirect する（詳細作成/編集/共有解除いずれも「戻って
 * カレンダーを見る」導線に収束）」。create/update/delete の3 action は
 * すべてこの1点に redirect する。
 */
const CALENDAR_PATH = "/calendar";

function resolveTemporalOrThrow(
  input: z.infer<typeof scheduleEntryFormSchema>,
) {
  const result = parseScheduleEntryTemporal(input);
  if (!result.ok) {
    // `scheduleEntryFormSchema` の `superRefine` が既に同じ関数で検証済み
    // のため、通常はここに到達しない。到達した場合は入力とスキーマの
    // 検証ロジックが乖離したバグであり、`validation` として拒否する
    // （黙って進めない）。
    throw new ActionError("validation", result.error.message);
  }
  return result.value;
}

export const createScheduleEntryAction = authActionClient
  .inputSchema(scheduleEntryFormSchema)
  .action(async ({ parsedInput, ctx }) => {
    const temporal = resolveTemporalOrThrow(parsedInput);
    await insertPersonalScheduleEntry(
      ctx.supabase,
      userIdSchema.parse(ctx.userId),
      {
        title: parsedInput.title,
        memo: normalizeMemo(parsedInput.memo),
        blocking: parsedInput.blocking,
        temporal,
      },
    );
    revalidatePath(CALENDAR_PATH);
    redirect(CALENDAR_PATH);
  });

export const updateScheduleEntryAction = authActionClient
  .inputSchema(scheduleEntryFormWithIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const temporal = resolveTemporalOrThrow(parsedInput);
    await updatePersonalScheduleEntry(ctx.supabase, parsedInput.entryId, {
      title: parsedInput.title,
      memo: normalizeMemo(parsedInput.memo),
      blocking: parsedInput.blocking,
      temporal,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath(`/schedule/${parsedInput.entryId}`);
    redirect(CALENDAR_PATH);
  });

const deleteScheduleEntryInputSchema = z.object({
  entryId: personalScheduleEntryIdSchema,
});

export const deleteScheduleEntryAction = authActionClient
  .inputSchema(deleteScheduleEntryInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await deletePersonalScheduleEntry(ctx.supabase, parsedInput.entryId);
    revalidatePath(CALENDAR_PATH);
    redirect(CALENDAR_PATH);
  });
