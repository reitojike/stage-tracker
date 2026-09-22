import {
  ProviderUnavailableFailure,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import { env } from "@/env";
import { createKabukiBitoAdapter } from "./adapters/kabuki-bito";
import { createSkiyakiCalendarAdapter } from "./adapters/skiyaki-calendar";
import { createTakarazukaRevueAdapter } from "./adapters/takarazuka-revue";
import { createEventCandidatePlanner } from "./event-candidate-planner";
import { createEventMatchRepository } from "./privileged/event-match-repository";
import { createJevEventAligner } from "./privileged/jev-event-aligner";
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
    ticket_foundation: unavailableAdapter(),
    future_event: unavailableAdapter(),
  };

export function getSourceFamilyAdapter(
  family: SourceExtractorFamily,
): OfficialSourceAdapter {
  return ADAPTERS[family];
}

export function createFoundationCandidatePlanner(): OfficialImportCandidatePlanner {
  const eventPlanner = createEventCandidatePlanner(
    createEventMatchRepository(),
    createJevEventAligner(env.JEV_API_KEY),
  );
  return {
    planEvent: eventPlanner.planEvent,
    planTicketOpportunity() {
      throw new ProviderUnavailableFailure();
    },
  };
}
