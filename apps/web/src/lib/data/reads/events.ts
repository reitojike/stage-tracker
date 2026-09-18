import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareInstants,
  ok,
  type Event,
  type EventId,
  type Occurrence,
  type Result,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventRow,
  type OccurrenceRow,
} from "../mappers/eventRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

export interface EventWithOccurrences {
  readonly event: Event;
  readonly occurrences: readonly Occurrence[];
}

interface EventWithOccurrencesRow extends EventRow {
  readonly event_occurrences: readonly OccurrenceRow[];
}

function mapEventWithOccurrencesRow(
  row: EventWithOccurrencesRow,
): Result<EventWithOccurrences, string> {
  const eventResult = mapEventRow(row);
  if (!eventResult.ok) {
    return eventResult;
  }

  const occurrences: Occurrence[] = [];
  for (const occurrenceRow of row.event_occurrences) {
    const occurrenceResult = mapOccurrenceRow(occurrenceRow);
    if (!occurrenceResult.ok) {
      return occurrenceResult;
    }
    occurrences.push(occurrenceResult.value);
  }

  occurrences.sort((left, right) =>
    compareInstants(left.startsAt, right.startsAt),
  );

  return ok({ event: eventResult.value, occurrences });
}

/**
 * Read one catalog event and its occurrences for detail and edit screens.
 * The generated Database query result remains authoritative; the hand-written
 * row shape is only the lower-bound shape consumed by the existing mappers.
 * Chronological occurrence ordering is part of this shared read contract.
 */
export async function getEventWithOccurrences(
  client: SupabaseClient<Database>,
  eventId: EventId,
): Promise<ReadResult<readonly EventWithOccurrences[]>> {
  const rowsResult = await runSupabaseSelect(
    client.from("events").select("*, event_occurrences(*)").eq("id", eventId),
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapEventWithOccurrencesRow);
}
