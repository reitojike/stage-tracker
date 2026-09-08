import {
  err,
  ok,
  personalScheduleEntrySchema,
  type PersonalScheduleEntry,
  type Result,
} from "@stage-tracker/domain";

/**
 * `personal_schedule_entries` の生 row 形（oracle-database.md §1.4）。
 * DB は「終日型」か「時刻指定型」かを `is_all_day` + 4つの nullable
 * sibling 列（`starts_on`/`ends_on`/`starts_at`/`ends_at`）で表すが、
 * domain の `PersonalScheduleEntry.temporal` は discriminated union
 * （`packages/domain/src/schedule/scheduleEntry.ts`）。この mapper が
 * その形状変換を担う。
 */
export interface PersonalScheduleEntryRow {
  readonly id: string;
  readonly owner_id: string;
  readonly memo: string | null;
  readonly is_all_day: boolean;
  readonly starts_on: string | null;
  readonly ends_on: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly title: string;
  readonly blocking: boolean;
}

export function mapPersonalScheduleEntryRow(
  row: PersonalScheduleEntryRow,
): Result<PersonalScheduleEntry, string> {
  let temporal:
    | { kind: "all-day"; startsOn: string; endsOn: string }
    | { kind: "time-bounded"; startsAt: string; endsAt: string | null };

  if (row.is_all_day) {
    if (row.starts_on === null || row.ends_on === null) {
      return err(
        `Invalid personal_schedule_entries row (id=${row.id}): is_all_day=true but starts_on/ends_on missing.`,
      );
    }
    temporal = {
      kind: "all-day",
      startsOn: row.starts_on,
      endsOn: row.ends_on,
    };
  } else {
    if (row.starts_at === null) {
      return err(
        `Invalid personal_schedule_entries row (id=${row.id}): is_all_day=false but starts_at missing.`,
      );
    }
    temporal = {
      kind: "time-bounded",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }

  const parsed = personalScheduleEntrySchema.safeParse({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    memo: row.memo,
    blocking: row.blocking,
    temporal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(
      `Invalid personal_schedule_entries row (id=${row.id}): ${parsed.error.message}`,
    );
  }
  return ok(parsed.data);
}
