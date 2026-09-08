import { z } from "zod";
import { eventIdSchema, occurrenceIdSchema } from "@stage-tracker/domain";
import type {
  EventDetailsDraft,
  EventRangeDraft,
  OccurrenceDraft,
} from "./eventFormLogic";
import {
  occurrenceWithinRangeError,
  parseEventDetailsFields,
  parseEventRangeFields,
  parseOccurrenceFields,
} from "./eventFormLogic";

/**
 * `./eventFormLogic.ts` の純粋な validation を next-safe-action の
 * `inputSchema` へ配線する薄い adapter。`ctx.addIssue({ path })` へ渡す
 * ことで、next-safe-action の `validationErrors` がそのまま
 * フィールド名をキーにした形で client（`useAction` hook）へ返る
 * （A12: 手書き `FieldErrors` reader を作らない）。
 */

function addFieldIssues(
  ctx: {
    addIssue: (issue: {
      code: "custom";
      path: string[];
      message: string;
    }) => void;
  },
  errors: Partial<Record<string, string>>,
  prefix = "",
): void {
  for (const [field, message] of Object.entries(errors)) {
    if (message === undefined) {
      continue;
    }
    ctx.addIssue({ code: "custom", path: [`${prefix}${field}`], message });
  }
}

function capitalize(value: string): string {
  const [first, ...rest] = value;
  return first === undefined ? value : first.toUpperCase() + rest.join("");
}

export interface CreateEventFormValue {
  readonly details: EventDetailsDraft;
  readonly range: EventRangeDraft;
  readonly occurrence: OccurrenceDraft | null;
}

const createEventRawSchema = z.object({
  title: z.string(),
  venue: z.string(),
  sourceUrl: z.string(),
  memo: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  occurrenceStartsAt: z.string(),
  occurrenceEndsAt: z.string(),
  occurrenceDoorsAt: z.string(),
});

export const createEventInputSchema = createEventRawSchema.transform(
  (raw, ctx): CreateEventFormValue => {
    let hasError = false;

    const details = parseEventDetailsFields(raw);
    if (details.kind === "errors") {
      hasError = true;
      addFieldIssues(ctx, details.errors);
    }

    const range = parseEventRangeFields(raw.startsOn, raw.endsOn);
    if (range.kind === "errors") {
      hasError = true;
      addFieldIssues(ctx, range.errors);
    }

    const occurrence = parseOccurrenceFields(
      {
        startsAt: raw.occurrenceStartsAt,
        endsAt: raw.occurrenceEndsAt,
        doorsAt: raw.occurrenceDoorsAt,
      },
      { allowBlank: true },
    );
    if (occurrence.kind === "errors") {
      hasError = true;
      const remapped: Partial<Record<string, string>> = {};
      for (const [field, message] of Object.entries(occurrence.errors)) {
        if (message !== undefined) {
          remapped[`occurrence${capitalize(field)}`] = message;
        }
      }
      addFieldIssues(ctx, remapped);
    }

    if (
      hasError ||
      details.kind !== "ok" ||
      range.kind !== "ok" ||
      occurrence.kind === "errors"
    ) {
      return z.NEVER;
    }

    // Event range containment（`./eventFormLogic.ts` 冒頭のコメント参照）。
    // Event 作成では range と初回 occurrence が同一送信に含まれるため、
    // ここで cross-field check として配線する。DB 側の
    // `event_occurrences_within_event_range` trigger（23514）を UX 面で
    // 先回りするだけで、これに代わるものではない。
    if (occurrence.kind === "ok") {
      const rangeError = occurrenceWithinRangeError(
        occurrence.value.startsAt,
        range.value,
      );
      if (rangeError !== null) {
        addFieldIssues(ctx, { occurrenceStartsAt: rangeError });
        return z.NEVER;
      }
    }

    return {
      details: details.value,
      range: range.value,
      occurrence: occurrence.kind === "ok" ? occurrence.value : null,
    };
  },
);

export const updateEventDetailsInputSchema = z
  .object({
    eventId: eventIdSchema,
    title: z.string(),
    venue: z.string(),
    sourceUrl: z.string(),
    memo: z.string(),
  })
  .transform((raw, ctx) => {
    const details = parseEventDetailsFields(raw);
    if (details.kind === "errors") {
      addFieldIssues(ctx, details.errors);
      return z.NEVER;
    }
    return { eventId: raw.eventId, details: details.value };
  });

export const updateEventRangeInputSchema = z
  .object({
    eventId: eventIdSchema,
    startsOn: z.string(),
    endsOn: z.string(),
  })
  .transform((raw, ctx) => {
    const range = parseEventRangeFields(raw.startsOn, raw.endsOn);
    if (range.kind === "errors") {
      addFieldIssues(ctx, range.errors);
      return z.NEVER;
    }
    return { eventId: raw.eventId, range: range.value };
  });

export const addOccurrenceInputSchema = z
  .object({
    eventId: eventIdSchema,
    startsAt: z.string(),
    endsAt: z.string(),
    doorsAt: z.string(),
  })
  .transform((raw, ctx) => {
    const occurrence = parseOccurrenceFields(raw, { allowBlank: false });
    if (occurrence.kind !== "ok") {
      addFieldIssues(
        ctx,
        occurrence.kind === "errors" ? occurrence.errors : {},
      );
      return z.NEVER;
    }
    return { eventId: raw.eventId, occurrence: occurrence.value };
  });

export const updateOccurrenceInputSchema = z
  .object({
    occurrenceId: occurrenceIdSchema,
    startsAt: z.string(),
    endsAt: z.string(),
    doorsAt: z.string(),
  })
  .transform((raw, ctx) => {
    const occurrence = parseOccurrenceFields(raw, { allowBlank: false });
    if (occurrence.kind !== "ok") {
      addFieldIssues(
        ctx,
        occurrence.kind === "errors" ? occurrence.errors : {},
      );
      return z.NEVER;
    }
    return { occurrenceId: raw.occurrenceId, occurrence: occurrence.value };
  });

export const eventIdInputSchema = z.object({ eventId: eventIdSchema });
export const occurrenceIdInputSchema = z.object({
  occurrenceId: occurrenceIdSchema,
});

/**
 * `delete_event_occurrence` RPC は occurrence 単体で権限判定するため
 * `eventId` を必要としないが、この action の revalidate 対象
 * （`/catalog/events/[eventId]/edit` 等）を決めるために呼び出し元
 * （edit 画面）が既に持っている eventId を併せて受け取る。RPC 呼び出し
 * 自体には使わないため、権限境界には影響しない。
 */
export const deleteOccurrenceInputSchema = z.object({
  eventId: eventIdSchema,
  occurrenceId: occurrenceIdSchema,
});
