import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type {
  CatalogEventMatch,
  EventMatchRepository,
} from "../event-candidate-planner";
import {
  EVENT_MATCH_LIMIT,
  requireCompleteEventMatchWindow,
} from "../event-match-window";
import { createPrivilegedIngestionClient } from "./supabase";

type EventRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  | "id"
  | "source_key"
  | "title"
  | "venue"
  | "source_url"
  | "memo"
  | "genre_id"
  | "starts_on"
  | "ends_on"
> & { readonly current_genre: { readonly key: string } | null };

const MATCH_FACT_PAGE_SIZE = 500;
const MAX_MATCH_FACT_ROWS = 5_000;

async function readOccurrences(
  client: SupabaseClient<Database>,
  eventId: string,
): Promise<CatalogEventMatch["occurrences"]> {
  const rows: CatalogEventMatch["occurrences"][number][] = [];
  for (
    let start = 0;
    start <= MAX_MATCH_FACT_ROWS;
    start += MATCH_FACT_PAGE_SIZE
  ) {
    const { data, error } = await client
      .from("event_occurrences")
      .select("starts_at, doors_at, ends_at")
      .eq("event_id", eventId)
      .order("starts_at")
      .range(start, start + MATCH_FACT_PAGE_SIZE - 1);
    if (error !== null || data === null)
      throw new Error("Failed to read bounded Event occurrence match facts");
    if (rows.length + data.length > MAX_MATCH_FACT_ROWS)
      throw new Error("Event occurrence match facts exceed the bounded limit");
    rows.push(
      ...data.map((row) => ({
        startsAt: row.starts_at,
        doorsAt: row.doors_at,
        endsAt: row.ends_at,
      })),
    );
    if (data.length < MATCH_FACT_PAGE_SIZE) return rows;
  }
  throw new Error("Event occurrence match facts exceed the bounded limit");
}

async function readGroups(
  client: SupabaseClient<Database>,
  eventId: string,
): Promise<CatalogEventMatch["groups"]> {
  const rows: CatalogEventMatch["groups"][number][] = [];
  let seen = 0;
  for (
    let start = 0;
    start <= MAX_MATCH_FACT_ROWS;
    start += MATCH_FACT_PAGE_SIZE
  ) {
    const { data, error } = await client
      .from("event_groups")
      .select("groups(key, display_name)")
      .eq("event_id", eventId)
      .order("group_id")
      .range(start, start + MATCH_FACT_PAGE_SIZE - 1);
    if (error !== null || data === null)
      throw new Error("Failed to read bounded Event group match facts");
    if (seen + data.length > MAX_MATCH_FACT_ROWS)
      throw new Error("Event group match facts exceed the bounded limit");
    seen += data.length;
    rows.push(
      ...data.flatMap((row) =>
        row.groups === null
          ? []
          : [{ key: row.groups.key, displayName: row.groups.display_name }],
      ),
    );
    if (data.length < MATCH_FACT_PAGE_SIZE) return rows;
  }
  throw new Error("Event group match facts exceed the bounded limit");
}

async function hydrate(
  client: SupabaseClient<Database>,
  event: EventRow,
): Promise<CatalogEventMatch> {
  const [occurrences, groups] = await Promise.all([
    // The shared import core preserves cancellation state and treats a row at
    // the same instant as existing. Include canceled rows here so the review
    // fingerprint and the apply-time catalog plan use the same semantics.
    readOccurrences(client, event.id),
    readGroups(client, event.id),
  ]);
  return {
    id: event.id,
    sourceKey: event.source_key,
    title: event.title,
    venue: event.venue,
    sourceUrl: event.source_url,
    memo: event.memo,
    genreId: event.genre_id,
    genreKey: event.current_genre?.key ?? null,
    startsOn: event.starts_on,
    endsOn: event.ends_on,
    occurrences,
    groups,
  };
}

export function createEventMatchRepository(
  client: SupabaseClient<Database> = createPrivilegedIngestionClient(),
): EventMatchRepository {
  return {
    async findExactBySourceKey(sourceKey) {
      const { data, error } = await client
        .from("events")
        .select(
          "id, source_key, title, venue, source_url, memo, genre_id, starts_on, ends_on, current_genre:genres!events_genre_id_fkey(key)",
        )
        .eq("source_key", sourceKey)
        .is("canceled_at", null)
        .maybeSingle();
      if (error !== null)
        throw new Error("Failed to resolve exact Event identity");
      return data === null ? null : hydrate(client, data);
    },
    async findPotentialMatches(startsOn, endsOn) {
      const { data, error } = await client
        .from("events")
        .select(
          "id, source_key, title, venue, source_url, memo, genre_id, starts_on, ends_on, current_genre:genres!events_genre_id_fkey(key)",
        )
        .is("canceled_at", null)
        .lte("starts_on", endsOn)
        .gte("ends_on", startsOn)
        .order("starts_on")
        .order("id")
        .limit(EVENT_MATCH_LIMIT + 1);
      if (error !== null)
        throw new Error("Failed to retrieve bounded Event matches");
      return Promise.all(
        requireCompleteEventMatchWindow(data).map((event) =>
          hydrate(client, event),
        ),
      );
    },
  };
}
