import {
  err,
  genreSchema,
  groupSchema,
  ok,
  type Genre,
  type Group,
  type Result,
} from "@stage-tracker/domain";
import { invalidRowSchemaError } from "../row-mapping";

/** `genres` の生 row 形（current classification schema / mapper tests）。 */
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
    return err(invalidRowSchemaError("genres", row.id, parsed.error));
  }
  return ok(parsed.data);
}

/** `groups` の生 row 形（current classification schema / mapper tests）。 */
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
    return err(invalidRowSchemaError("groups", row.id, parsed.error));
  }
  return ok(parsed.data);
}
