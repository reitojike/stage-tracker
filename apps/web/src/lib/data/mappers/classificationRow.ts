import {
  err,
  genreSchema,
  groupSchema,
  ok,
  type Genre,
  type Group,
  type Result,
} from "@stage-tracker/domain";

/** `genres` の生 row 形（oracle-database.md §1.12）。 */
export interface GenreRow {
  readonly id: string;
  readonly key: string;
  readonly display_name: string;
  readonly sort_order: number;
}

export function mapGenreRow(row: GenreRow): Result<Genre, string> {
  const parsed = genreSchema.safeParse({
    id: row.id,
    key: row.key,
    displayName: row.display_name,
    sortOrder: row.sort_order,
  });
  if (!parsed.success) {
    return err(`Invalid genres row (id=${row.id}): ${parsed.error.message}`);
  }
  return ok(parsed.data);
}

/** `groups` の生 row 形（oracle-database.md §1.13）。 */
export interface GroupRow {
  readonly id: string;
  readonly key: string;
  readonly display_name: string;
}

export function mapGroupRow(row: GroupRow): Result<Group, string> {
  const parsed = groupSchema.safeParse({
    id: row.id,
    key: row.key,
    displayName: row.display_name,
  });
  if (!parsed.success) {
    return err(`Invalid groups row (id=${row.id}): ${parsed.error.message}`);
  }
  return ok(parsed.data);
}
