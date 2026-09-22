import {
  ProviderUnavailableFailure,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import type { SourceFamilyAdapter } from "./source-registry";

function unavailableAdapter(): OfficialSourceAdapter {
  return {
    acquire() {
      throw new ProviderUnavailableFailure();
    },
  };
}

const ADAPTERS: Readonly<Record<SourceFamilyAdapter, OfficialSourceAdapter>> = {
  http_html: unavailableAdapter(),
  pdf: unavailableAdapter(),
  calendar_feed: unavailableAdapter(),
  future_fallback: unavailableAdapter(),
};

export function getSourceFamilyAdapter(
  family: SourceFamilyAdapter,
): OfficialSourceAdapter {
  return ADAPTERS[family];
}

export const foundationCandidatePlanner: OfficialImportCandidatePlanner = {
  planEvent() {
    throw new ProviderUnavailableFailure();
  },
  planTicketOpportunity() {
    throw new ProviderUnavailableFailure();
  },
};
