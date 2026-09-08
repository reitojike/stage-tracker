import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/data/database.types";

/**
 * Direct-DB catalog seeding for journeys whose subject is *not* Event
 * creation itself (participation/invitation - `event-management.spec.ts`
 * covers real Event creation through the app UI). Uses the service-role
 * client so it needs no designated-catalog-creator grant of its own; this
 * is deliberately a privileged shortcut around `create_event`/RLS for test
 * *setup* only; the behavior under test (participation/invitation writes)
 * always goes through the real app UI and its RLS/RPC boundary.
 */
export interface SeededEventOccurrence {
  readonly eventId: string;
  readonly occurrenceId: string;
}

export interface SeedEventWithOccurrenceParams {
  readonly ownerId: string;
  readonly title: string;
  /** Asia/Tokyo calendar date (`YYYY-MM-DD`). Event range start/end. */
  readonly tokyoDate: string;
  /** Occurrence `starts_at`, an ISO instant that falls on `tokyoDate`
   * Asia/Tokyo (e.g. `${tokyoDate}T19:00:00+09:00`). */
  readonly occurrenceStartsAt: string;
}

export async function seedEventWithOccurrence(
  admin: SupabaseClient<Database>,
  params: SeedEventWithOccurrenceParams,
): Promise<SeededEventOccurrence> {
  const { data: event, error: eventError } = await admin
    .from("events")
    .insert({
      owner_id: params.ownerId,
      title: params.title,
      starts_on: params.tokyoDate,
      ends_on: params.tokyoDate,
    })
    .select("id")
    .single();
  if (eventError || event === null) {
    throw new Error(
      `failed to seed e2e event: ${eventError?.message ?? "unknown error"}`,
    );
  }

  const { data: occurrence, error: occurrenceError } = await admin
    .from("event_occurrences")
    .insert({ event_id: event.id, starts_at: params.occurrenceStartsAt })
    .select("id")
    .single();
  if (occurrenceError || occurrence === null) {
    throw new Error(
      `failed to seed e2e occurrence: ${occurrenceError?.message ?? "unknown error"}`,
    );
  }

  return { eventId: event.id, occurrenceId: occurrence.id };
}

/**
 * Best-effort teardown, ordered to satisfy FKs that (by product design,
 * product-rules.md "Deletion") carry no cascade: participations/
 * invitations first, then the occurrence, then the event. Logs rather than
 * throws so one leftover fixture never masks the journey's own pass/fail
 * result.
 */
export async function cleanupSeededEvent(
  admin: SupabaseClient<Database>,
  eventId: string,
): Promise<void> {
  const { data: occurrences, error: occurrencesReadError } = await admin
    .from("event_occurrences")
    .select("id")
    .eq("event_id", eventId);
  if (occurrencesReadError) {
    console.warn(
      `[e2e cleanup] failed to read occurrences for event ${eventId}: ${occurrencesReadError.message}`,
    );
    return;
  }

  const occurrenceIds = (occurrences ?? []).map((row) => row.id);
  if (occurrenceIds.length > 0) {
    const { error: participationsError } = await admin
      .from("occurrence_participations")
      .delete()
      .in("occurrence_id", occurrenceIds);
    if (participationsError) {
      console.warn(
        `[e2e cleanup] failed to delete participations for event ${eventId}: ${participationsError.message}`,
      );
    }

    const { error: invitationsError } = await admin
      .from("occurrence_invitations")
      .delete()
      .in("occurrence_id", occurrenceIds);
    if (invitationsError) {
      console.warn(
        `[e2e cleanup] failed to delete invitations for event ${eventId}: ${invitationsError.message}`,
      );
    }

    const { error: deleteOccurrencesError } = await admin
      .from("event_occurrences")
      .delete()
      .eq("event_id", eventId);
    if (deleteOccurrencesError) {
      console.warn(
        `[e2e cleanup] failed to delete occurrences for event ${eventId}: ${deleteOccurrencesError.message}`,
      );
    }
  }

  const { error: deleteEventError } = await admin
    .from("events")
    .delete()
    .eq("id", eventId);
  if (deleteEventError) {
    console.warn(
      `[e2e cleanup] failed to delete event ${eventId}: ${deleteEventError.message}`,
    );
  }
}

/** Asia/Tokyo "today" as `YYYY-MM-DD`, matching how the server resolves
 * `resolveScreenNow()` (`src/app/_lib/now.ts`) - both read the same wall
 * clock, just through different formatting paths. */
export function tokyoTodayDateString(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}
