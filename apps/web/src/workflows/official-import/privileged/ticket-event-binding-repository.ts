import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type { TicketEventBindingRepository } from "../ticket-opportunity-candidate-planner";
import { createPrivilegedIngestionClient } from "./supabase";

export function createTicketEventBindingRepository(
  client: SupabaseClient<Database> = createPrivilegedIngestionClient(),
): TicketEventBindingRepository {
  return {
    async find(sourceId, ticketSourceKey) {
      const { data, error } = await client
        .from("official_import_ticket_event_bindings")
        .select("event_id, event_source_key")
        .eq("source_id", sourceId)
        .eq("ticket_source_key", ticketSourceKey)
        .maybeSingle();
      if (error !== null)
        throw new Error("Failed to read reviewed ticket Event binding");
      return data === null
        ? null
        : { eventId: data.event_id, eventSourceKey: data.event_source_key };
    },
  };
}
