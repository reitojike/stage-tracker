import {
  ProviderUnavailableFailure,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import { env } from "@/env";
import { createKabukiBitoAdapter } from "./adapters/kabuki-bito";
import { createSkiyakiCalendarAdapter } from "./adapters/skiyaki-calendar";
import { createTakarazukaRevueAdapter } from "./adapters/takarazuka-revue";
import { createShochikuTicketAdapter } from "./adapters/shochiku-ticket";
import { createTakarazukaFriendsAdapter } from "./adapters/takarazuka-friends";
import { createWordpressTribeEventsAdapter } from "./adapters/wordpress-tribe-events";
import { createFirecrawlPdfProvider } from "./adapters/firecrawl-pdf";
import { createEventCandidatePlanner } from "./event-candidate-planner";
import { createEventMatchRepository } from "./privileged/event-match-repository";
import { createTicketOpportunityMatchRepository } from "./privileged/ticket-opportunity-match-repository";
import { createTicketEventBindingRepository } from "./privileged/ticket-event-binding-repository";
import { createJevEventAligner } from "./privileged/jev-event-aligner";
import { createTicketOpportunityCandidatePlanner } from "./ticket-opportunity-candidate-planner";
import type { SourceExtractorFamily } from "./source-registry";

function unavailableAdapter(): OfficialSourceAdapter {
  return {
    acquire() {
      throw new ProviderUnavailableFailure();
    },
  };
}

const ADAPTERS: Readonly<Record<SourceExtractorFamily, OfficialSourceAdapter>> =
  {
    kabuki_bito: createKabukiBitoAdapter(),
    takarazuka_revue: createTakarazukaRevueAdapter(),
    skiyaki_calendar: createSkiyakiCalendarAdapter(),
    shochiku_ticket: createShochikuTicketAdapter(),
    takarazuka_friends_pdf: createTakarazukaFriendsAdapter(
      createFirecrawlPdfProvider(env.FIRECRAWL_API_KEY),
    ),
    wordpress_tribe_events: createWordpressTribeEventsAdapter(),
    ticket_foundation: unavailableAdapter(),
    future_event: unavailableAdapter(),
  };

export function getSourceFamilyAdapter(
  family: SourceExtractorFamily,
): OfficialSourceAdapter {
  return ADAPTERS[family];
}

export function createFoundationCandidatePlanner(): OfficialImportCandidatePlanner {
  const events = createEventMatchRepository();
  const aligner = createJevEventAligner(env.JEV_API_KEY);
  const eventPlanner = createEventCandidatePlanner(events, aligner);
  const ticketPlanner = createTicketOpportunityCandidatePlanner(
    events,
    createTicketOpportunityMatchRepository(),
    aligner,
    createTicketEventBindingRepository(),
  );
  return {
    planEvent: eventPlanner.planEvent,
    planTicketOpportunity: ticketPlanner.planTicketOpportunity,
  };
}
