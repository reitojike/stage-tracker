import {
  compareInstants,
  compareTokyoCalendarDates,
  isOccurrenceStartWithinEventRange,
  isRenderableHttpUrl,
  tokyoCalendarDateSchema,
  type Instant,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import { formatTokyoCalendarDateRangeJa } from "@/app/_lib/format";
import { parseTokyoDateTimeLocal } from "./tokyo-form";

/**
 * Event/Occurrence 書き込みフォームの純粋な validation ロジック
 * （zod に依存しない）。`docs/v2/decisions.md` A12「Zod schema を入力契約に
 * すれば層ごと不要」の方針どおり、実際の schema wiring（`./eventSchemas.ts`）
 * は本モジュールが返す field-keyed error を `ctx.addIssue` へ渡すだけの
 * 薄い adapter にする。フォーマット/相互整合性チェックはここに集約する。
 *
 * Event range containment（occurrence の startsAt が Event range に収まって
 * いるか）は `occurrenceWithinRangeError` が pure logic として提供する。
 * Event 作成時（`./eventSchemas.ts` の `createEventInputSchema`）は range と
 * 初回 occurrence が同一送信に含まれるため、この場で cross-field check として
 * 配線している。既存 event への occurrence 追加/更新（`addOccurrenceInputSchema`
 * / `updateOccurrenceInputSchema`）は、その送信が event の range 自体を
 * 含まないため（呼び出し元は eventId/occurrenceId しか渡さない）、この
 * pure logic からは配線していない。**この invariant の真の source of
 * truth は常に DB 側の `event_occurrences_within_event_range` trigger
 * （SQLSTATE `23514`）であり、ここでの client 側チェックはあくまで
 * 早期に分かりやすい field error を返すための UX 上の先出し検証に過ぎない**
 * （二重化したつもりの安全境界ではない）。
 *
 * M8 oracle の
 * `parseEventDetails`/`parseEventRange`/`parseOccurrence`/
 * `validateOccurrenceWithinRange` と同じ判断を再実装したもの（legacy は
 * import 禁止のため、oracle として読み、ゼロから書き直した）。
 */

export function optionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export interface EventDetailsFieldsRaw {
  readonly title: string;
  readonly venue: string;
  readonly sourceUrl: string;
  readonly memo: string;
}

export interface EventDetailsDraft {
  readonly title: string;
  readonly venue: string | null;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
}

export type EventDetailsFieldError = "title" | "sourceUrl";

export type ParseEventDetailsResult =
  | { readonly kind: "ok"; readonly value: EventDetailsDraft }
  | {
      readonly kind: "errors";
      readonly errors: Partial<Record<EventDetailsFieldError, string>>;
    };

export function parseEventDetailsFields(
  raw: EventDetailsFieldsRaw,
): ParseEventDetailsResult {
  const errors: Partial<Record<EventDetailsFieldError, string>> = {};

  const title = raw.title.trim();
  if (title.length === 0) {
    errors.title = "タイトルを入力してください。";
  }

  const sourceUrl = optionalText(raw.sourceUrl);
  if (sourceUrl !== null && !isRenderableHttpUrl(sourceUrl)) {
    errors.sourceUrl =
      "http:// または https:// で始まるURLを入力してください。";
  }

  if (Object.keys(errors).length > 0) {
    return { kind: "errors", errors };
  }

  return {
    kind: "ok",
    value: {
      title,
      venue: optionalText(raw.venue),
      sourceUrl,
      memo: optionalText(raw.memo),
    },
  };
}

export interface EventRangeDraft {
  readonly startsOn: TokyoCalendarDate;
  readonly endsOn: TokyoCalendarDate;
}

export type EventRangeFieldError = "startsOn" | "endsOn";

export type ParseEventRangeResult =
  | { readonly kind: "ok"; readonly value: EventRangeDraft }
  | {
      readonly kind: "errors";
      readonly errors: Partial<Record<EventRangeFieldError, string>>;
    };

export function parseEventRangeFields(
  startsOnRaw: string,
  endsOnRaw: string,
): ParseEventRangeResult {
  const errors: Partial<Record<EventRangeFieldError, string>> = {};

  const startsOnTrimmed = startsOnRaw.trim();
  if (startsOnTrimmed.length === 0) {
    errors.startsOn = "開催期間の開始日を入力してください。";
  } else if (!tokyoCalendarDateSchema.safeParse(startsOnTrimmed).success) {
    errors.startsOn = "開始日の形式が正しくありません。";
  }

  const endsOnTrimmed = endsOnRaw.trim();
  if (endsOnTrimmed.length === 0) {
    errors.endsOn = "開催期間の終了日を入力してください。";
  } else if (!tokyoCalendarDateSchema.safeParse(endsOnTrimmed).success) {
    errors.endsOn = "終了日の形式が正しくありません。";
  }

  if (Object.keys(errors).length > 0) {
    return { kind: "errors", errors };
  }

  const startsOnParsed = tokyoCalendarDateSchema.safeParse(startsOnTrimmed);
  const endsOnParsed = tokyoCalendarDateSchema.safeParse(endsOnTrimmed);
  /* c8 ignore start -- unreachable: both already validated above */
  if (!startsOnParsed.success || !endsOnParsed.success) {
    return {
      kind: "errors",
      errors: { startsOn: "開始日の形式が正しくありません。" },
    };
  }
  /* c8 ignore stop */

  if (compareTokyoCalendarDates(startsOnParsed.data, endsOnParsed.data) > 0) {
    return {
      kind: "errors",
      errors: { endsOn: "終了日は開始日より前にできません。" },
    };
  }

  return {
    kind: "ok",
    value: { startsOn: startsOnParsed.data, endsOn: endsOnParsed.data },
  };
}

export interface OccurrenceFieldsRaw {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly doorsAt: string;
}

export interface OccurrenceDraft {
  readonly startsAt: Instant;
  readonly endsAt: Instant | null;
  readonly doorsAt: Instant | null;
}

export type OccurrenceFieldError = "startsAt" | "endsAt" | "doorsAt";

export type ParseOccurrenceFieldsResult =
  | { readonly kind: "blank" }
  | { readonly kind: "ok"; readonly value: OccurrenceDraft }
  | {
      readonly kind: "errors";
      readonly errors: Partial<Record<OccurrenceFieldError, string>>;
    };

/**
 * `allowBlank`: Event 作成時の初回 occurrence は3フィールドとも空なら
 * 「occurrence なし」として受理する（Issue #87/#88、`kind: "blank"`）。
 * 既存 occurrence の追加/更新では意味を持たない（startsAt は常に必須）
 * ので `false` を渡す — その場合 `"blank"` は返らない。
 */
export function parseOccurrenceFields(
  raw: OccurrenceFieldsRaw,
  options: { readonly allowBlank: boolean },
): ParseOccurrenceFieldsResult {
  const startsAtRaw = raw.startsAt.trim();
  const endsAtRaw = raw.endsAt.trim();
  const doorsAtRaw = raw.doorsAt.trim();

  if (
    options.allowBlank &&
    startsAtRaw.length === 0 &&
    endsAtRaw.length === 0 &&
    doorsAtRaw.length === 0
  ) {
    return { kind: "blank" };
  }

  const errors: Partial<Record<OccurrenceFieldError, string>> = {};

  let startsAt: Instant | null = null;
  if (startsAtRaw.length === 0) {
    errors.startsAt = "開演日時を入力してください。";
  } else {
    startsAt = parseTokyoDateTimeLocal(startsAtRaw);
    if (startsAt === null) {
      errors.startsAt = "開演日時の形式が正しくありません。";
    }
  }

  let endsAt: Instant | null = null;
  if (endsAtRaw.length > 0) {
    endsAt = parseTokyoDateTimeLocal(endsAtRaw);
    if (endsAt === null) {
      errors.endsAt = "終演日時の形式が正しくありません。";
    }
  }

  let doorsAt: Instant | null = null;
  if (doorsAtRaw.length > 0) {
    doorsAt = parseTokyoDateTimeLocal(doorsAtRaw);
    if (doorsAt === null) {
      errors.doorsAt = "開場日時の形式が正しくありません。";
    }
  }

  if (Object.keys(errors).length > 0 || startsAt === null) {
    return { kind: "errors", errors };
  }

  if (doorsAt !== null && compareInstants(doorsAt, startsAt) > 0) {
    return {
      kind: "errors",
      errors: { doorsAt: "開場日時は開演日時より後にできません。" },
    };
  }
  if (endsAt !== null && compareInstants(startsAt, endsAt) > 0) {
    return {
      kind: "errors",
      errors: { endsAt: "終演日時は開演日時より前にできません。" },
    };
  }

  return { kind: "ok", value: { startsAt, endsAt, doorsAt } };
}

/**
 * occurrence の startsAt が Event range に収まっているかの cross-entity
 * check。`@stage-tracker/domain` の `isOccurrenceStartWithinEventRange`
 * （`packages/domain/src/event/eventOccurrenceInvariants.ts`）をそのまま
 * 使う — 同じ判定を書き直さない。
 */
export function occurrenceWithinRangeError(
  startsAt: Instant,
  range: EventRangeDraft,
): string | null {
  if (isOccurrenceStartWithinEventRange(startsAt, range)) {
    return null;
  }
  return `開演日時は開催期間（${formatTokyoCalendarDateRangeJa(range.startsOn, range.endsOn)}）の範囲内で入力してください。`;
}
