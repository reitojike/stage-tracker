import {
  err,
  eventSchema,
  occurrenceSchema,
  ok,
  type Event,
  type Occurrence,
  type Result,
} from "@stage-tracker/domain";

/**
 * `events` テーブルの生 row 形（`docs/v2/oracle-database.md` §1.1）。
 * snake_case はそのまま Supabase/PostgREST の wire 形式。
 */
export interface EventRow {
  readonly id: string;
  readonly owner_id: string;
  readonly title: string;
  readonly venue: string | null;
  readonly source_url: string | null;
  readonly memo: string | null;
  readonly starts_on: string;
  readonly ends_on: string;
  readonly canceled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** A10 決定（`../row-mapping.ts`）: throw せず `Result` を返す。 */
export function mapEventRow(row: EventRow): Result<Event, string> {
  const parsed = eventSchema.safeParse({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    venue: row.venue,
    sourceUrl: row.source_url,
    memo: row.memo,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(`Invalid events row (id=${row.id}): ${parsed.error.message}`);
  }
  return ok(parsed.data);
}

/** `event_occurrences` テーブルの生 row 形（oracle-database.md §1.2）。 */
export interface OccurrenceRow {
  readonly id: string;
  readonly event_id: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly doors_at: string | null;
  readonly canceled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function mapOccurrenceRow(
  row: OccurrenceRow,
): Result<Occurrence, string> {
  const parsed = occurrenceSchema.safeParse({
    id: row.id,
    eventId: row.event_id,
    doorsAt: row.doors_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(
      `Invalid event_occurrences row (id=${row.id}): ${parsed.error.message}`,
    );
  }
  return ok(parsed.data);
}
