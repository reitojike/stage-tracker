import {
  err,
  ok,
  participationSchema,
  type Participation,
  type Result,
} from "@stage-tracker/domain";

/** `occurrence_participations` の生 row 形（oracle-database.md §1.6）。 */
export interface ParticipationRow {
  readonly id: string;
  readonly occurrence_id: string;
  readonly user_id: string;
  readonly status: string;
  readonly visibility: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export function mapParticipationRow(
  row: ParticipationRow,
): Result<Participation, string> {
  const parsed = participationSchema.safeParse({
    id: row.id,
    occurrenceId: row.occurrence_id,
    userId: row.user_id,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(
      `Invalid occurrence_participations row (id=${row.id}): ${parsed.error.message}`,
    );
  }
  return ok(parsed.data);
}
