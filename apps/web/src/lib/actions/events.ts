"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eventIdSchema } from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";
import {
  throwEventCancellationError,
  throwEventCancellationPermissionDenied,
  throwEventDeleteError,
  throwEventWriteError,
  throwEventWritePermissionDenied,
} from "./event-write-feedback";
import {
  addOccurrenceInputSchema,
  createEventInputSchema,
  deleteOccurrenceInputSchema,
  eventIdInputSchema,
  occurrenceIdInputSchema,
  updateEventDetailsInputSchema,
  updateEventRangeInputSchema,
  updateOccurrenceInputSchema,
} from "./eventSchemas";

/**
 * `docs/v2/oracle-routes-ui.md` §1 の Event/Occurrence 書き込み層
 * （`/catalog/events/new`, `/catalog/events/[eventId]/edit` の Server
 * Action 群）。
 *
 * すべての action は `authActionClient` を通す（`@/lib/safe-action.ts`）
 * だけで、権限そのものは判定しない。真の権限境界は常に RPC/RLS 側にあり
 * （AGENTS.md 制約）、ここでの分類は DB が返したエラーを共通の
 * `ActionErrorShape` 語彙へ変換するだけ。plain table UPDATE は RLS の
 * `using` 句が対象行を除外すると *エラーにならず* 0件成功を返す
 * （`event_occurrences_update_own`/`events_update_own` の性質）ため、
 * `.select().maybeSingle()` を必ず付け、`data === null` を
 * `permission-denied` として扱う。この判定基準は
 * `apps/legacy-web/src/infrastructure/supabase/eventCatalogWrite.ts` の
 * `deniedUpdate` と同じ（legacy は oracle として読み、ゼロから書き直した）。
 * エラーの文言粒度は `apps/legacy-web/src/domain/eventWriteFeedback.ts` を
 * 移植した `./event-write-feedback.ts` の operation 別 thrower へ委譲する
 * （M8 journey 比較で確定した分類2の不具合修正 -
 * `docs/v2/m8-journey-comparison.md` 参照）。
 */

const createEventRpcRowSchema = z.object({ id: eventIdSchema });

export const createEventAction = authActionClient
  .inputSchema(createEventInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { details, range, occurrence } = parsedInput;

    const { data, error } = await ctx.supabase.rpc("create_event", {
      p_title: details.title,
      p_starts_on: range.startsOn,
      p_ends_on: range.endsOn,
      p_venue: details.venue,
      p_source_url: details.sourceUrl,
      p_memo: details.memo,
      p_starts_at: occurrence?.startsAt ?? null,
      p_ends_at: occurrence?.endsAt ?? null,
      p_doors_at: occurrence?.doorsAt ?? null,
    });
    if (error) {
      throwEventWriteError("create-event", error);
    }

    const parsed = createEventRpcRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new ActionError(
        "failure",
        "作成したイベントの応答を解釈できませんでした。",
      );
    }

    redirect(`/catalog/events/${parsed.data.id}`);
  });

export const updateEventDetailsAction = authActionClient
  .inputSchema(updateEventDetailsInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { eventId, details } = parsedInput;

    const { data, error } = await ctx.supabase
      .from("events")
      .update({
        title: details.title,
        venue: details.venue,
        source_url: details.sourceUrl,
        memo: details.memo,
      })
      .eq("id", eventId)
      .select("id")
      .maybeSingle();
    if (error) {
      throwEventWriteError("update-event", error);
    }
    if (data === null) {
      throwEventWritePermissionDenied("update-event");
    }

    revalidatePath(`/catalog/events/${eventId}/edit`);
    revalidatePath(`/catalog/events/${eventId}`);
    revalidatePath("/catalog");
    return { ok: true as const };
  });

export const updateEventRangeAction = authActionClient
  .inputSchema(updateEventRangeInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { eventId, range } = parsedInput;

    // `reschedule_event`（`supabase/migrations/
    // 20260825000400_create_reschedule_event_rpc.sql`）は Event range と
    // occurrence 群の atomic 更新を1つの RPC にまとめているが、この画面の
    // 「期間だけ編集」フローは occurrence 自体を動かさない
    // （`docs/v2/oracle-routes-ui.md` §2「期間編集はSheet内フォームで…」）
    // ため、`p_occurrences` は空配列のまま渡す。既存 occurrence が新しい
    // range に収まらない場合は、DB 側の deferred constraint
    // (`events_range_contains_occurrences`) がコミット時に `23514` で
    // 拒否する。
    const { error } = await ctx.supabase.rpc("reschedule_event", {
      p_event_id: eventId,
      p_starts_on: range.startsOn,
      p_ends_on: range.endsOn,
      p_occurrences: [],
    });
    if (error) {
      throwEventWriteError("update-event", error);
    }

    revalidatePath(`/catalog/events/${eventId}/edit`);
    revalidatePath(`/catalog/events/${eventId}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const addOccurrenceAction = authActionClient
  .inputSchema(addOccurrenceInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { eventId, occurrence } = parsedInput;

    // event_occurrences_insert_own の WITH CHECK が owner でない場合に
    // 42501 を返す（挿入拒否は plain UPDATE と異なり必ずエラーになる -
    // `eventFormLogic.ts` 冒頭のコメント、legacy の
    // `addEventOccurrence` と同じ前提）。Event range containment
    // （`event_occurrences_within_event_range`）も DB 側で最終確認される。
    const { error } = await ctx.supabase.from("event_occurrences").insert({
      event_id: eventId,
      starts_at: occurrence.startsAt,
      ends_at: occurrence.endsAt,
      doors_at: occurrence.doorsAt,
    });
    if (error) {
      throwEventWriteError("add-occurrence", error);
    }

    revalidatePath(`/catalog/events/${eventId}/edit`);
    revalidatePath(`/catalog/events/${eventId}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const updateOccurrenceAction = authActionClient
  .inputSchema(updateOccurrenceInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { occurrenceId, occurrence } = parsedInput;

    const { data, error } = await ctx.supabase
      .from("event_occurrences")
      .update({
        starts_at: occurrence.startsAt,
        ends_at: occurrence.endsAt,
        doors_at: occurrence.doorsAt,
      })
      .eq("id", occurrenceId)
      .select("id, event_id")
      .maybeSingle();
    if (error) {
      throwEventWriteError("update-occurrence", error);
    }
    if (data === null) {
      throwEventWritePermissionDenied("update-occurrence");
    }

    revalidatePath(`/catalog/events/${data.event_id}/edit`);
    revalidatePath(`/catalog/events/${data.event_id}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const deleteEventOccurrenceAction = authActionClient
  .inputSchema(deleteOccurrenceInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { error } = await ctx.supabase.rpc("delete_event_occurrence", {
      p_occurrence_id: parsedInput.occurrenceId,
    });
    if (error) {
      throwEventDeleteError("delete-occurrence", error);
    }
    revalidatePath(`/catalog/events/${parsedInput.eventId}/edit`);
    revalidatePath(`/catalog/events/${parsedInput.eventId}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const deleteEventAction = authActionClient
  .inputSchema(eventIdInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { error } = await ctx.supabase.rpc("delete_event", {
      p_event_id: parsedInput.eventId,
    });
    if (error) {
      throwEventDeleteError("delete-event", error);
    }
    redirect("/catalog");
  });

export const cancelEventAction = authActionClient
  .inputSchema(eventIdInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase
      .from("events")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", parsedInput.eventId)
      .select("id")
      .maybeSingle();
    if (error) {
      throwEventCancellationError("cancel-event", error);
    }
    if (data === null) {
      throwEventCancellationPermissionDenied("cancel-event");
    }
    revalidatePath(`/catalog/events/${parsedInput.eventId}/edit`);
    revalidatePath(`/catalog/events/${parsedInput.eventId}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const uncancelEventAction = authActionClient
  .inputSchema(eventIdInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase
      .from("events")
      .update({ canceled_at: null })
      .eq("id", parsedInput.eventId)
      .select("id")
      .maybeSingle();
    if (error) {
      throwEventCancellationError("uncancel-event", error);
    }
    if (data === null) {
      throwEventCancellationPermissionDenied("uncancel-event");
    }
    revalidatePath(`/catalog/events/${parsedInput.eventId}/edit`);
    revalidatePath(`/catalog/events/${parsedInput.eventId}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const cancelEventOccurrenceAction = authActionClient
  .inputSchema(occurrenceIdInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase
      .from("event_occurrences")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", parsedInput.occurrenceId)
      .select("id, event_id")
      .maybeSingle();
    if (error) {
      throwEventCancellationError("cancel-occurrence", error);
    }
    if (data === null) {
      throwEventCancellationPermissionDenied("cancel-occurrence");
    }
    revalidatePath(`/catalog/events/${data.event_id}/edit`);
    revalidatePath(`/catalog/events/${data.event_id}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

export const uncancelEventOccurrenceAction = authActionClient
  .inputSchema(occurrenceIdInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase
      .from("event_occurrences")
      .update({ canceled_at: null })
      .eq("id", parsedInput.occurrenceId)
      .select("id, event_id")
      .maybeSingle();
    if (error) {
      throwEventCancellationError("uncancel-occurrence", error);
    }
    if (data === null) {
      throwEventCancellationPermissionDenied("uncancel-occurrence");
    }
    revalidatePath(`/catalog/events/${data.event_id}/edit`);
    revalidatePath(`/catalog/events/${data.event_id}`);
    revalidatePath("/catalog");
    revalidatePath("/calendar");
    return { ok: true as const };
  });
