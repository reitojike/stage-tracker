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

async function hydrate(
  client: SupabaseClient<Database>,
  event: EventRow,
): Promise<CatalogEventMatch> {
  const [occurrenceResult, groupResult] = await Promise.all([
    // The shared import core preserves cancellation state and treats a row at
    // the same instant as existing. Include canceled rows here so the review
    // fingerprint and the apply-time catalog plan use the same semantics.
    client
      .from("event_occurrences")
      .select("starts_at, doors_at, ends_at")
      .eq("event_id", event.id)
      .order("starts_at"),
    client
      .from("event_groups")
      .select("groups(key, display_name)")
      .eq("event_id", event.id)
      .order("group_id"),
  ]);
  if (occurrenceResult.error !== null || groupResult.error !== null) {
    throw new Error("Failed to read bounded Event match facts");
  }
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
    occurrences: occurrenceResult.data.map((row) => ({
      startsAt: row.starts_at,
      doorsAt: row.doors_at,
      endsAt: row.ends_at,
    })),
    groups: groupResult.data.flatMap((row) =>
      row.groups === null
        ? []
        : [{ key: row.groups.key, displayName: row.groups.display_name }],
    ),
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
