import {
  SourceParseFailure,
  type HeldSourcePage,
  type TicketOpportunityAcquisitionDraft,
} from "../acquisition";
import { requireEnabledShadowSource } from "../source-registry";
import {
  attribute,
  descendants,
  elementName,
  hasClass,
  normalizedText,
  parseHtml,
} from "./html";
import { type OfficialHtmlFetcher, fetchOfficialHtml } from "./http";
import { parseKabukiIndex } from "./kabuki-bito";
import {
  parseShochikuSaleMilestone,
  type TicketMilestone,
} from "./ticket-sale-date";

const KABUKI_SOURCE = requireEnabledShadowSource("event.kabuki-bito.schedule");

export interface KabukiTicketIdentity {
  readonly officialExternalId: string;
  readonly eventSourceKey: string;
  readonly eventReference: NonNullable<
    TicketOpportunityAcquisitionDraft["eventReference"]
  >;
}

function saleDate(milestone: TicketMilestone): string {
  return milestone.precision === "date"
    ? milestone.date
    : milestone.precision === "datetime"
      ? milestone.at.slice(0, 10)
      : milestone.startsAt.slice(0, 10);
}

/** Only observed headline and ticket-section forms establish a general sale. */
export function parseKabukiGeneralSale(
  html: string,
  startsOn: string,
  endsOn: string,
): TicketMilestone | null {
  const document = parseHtml(html);
  const headlines = descendants(
    document,
    (node) =>
      elementName(node) === "p" &&
      hasClass(node, "type-term") &&
      hasClass(node, "blue") &&
      /チケット発売予定/u.test(normalizedText(node)),
  );
  if (headlines.length > 1) throw new SourceParseFailure();
  if (
    headlines.length === 0 &&
    /チケット発売予定/u.test(normalizedText(document))
  )
    throw new SourceParseFailure();
  const headline = headlines[0];
  const expected =
    headline === undefined
      ? null
      : parseShochikuSaleMilestone(normalizedText(headline), startsOn, endsOn);
  if (
    headline !== undefined &&
    (expected === null || expected.precision !== "date")
  )
    throw new SourceParseFailure();

  const ticketSections = descendants(
    document,
    (node) =>
      elementName(node) === "section" && attribute(node, "id") === "ticket",
  );
  if (ticketSections.length > 1) throw new SourceParseFailure();
  const ticketSection = ticketSections[0];
  if (ticketSection === undefined) {
    if (/Web・電話受付開始/u.test(normalizedText(document)))
      throw new SourceParseFailure();
    return expected;
  }
  const openingTexts = descendants(
    ticketSection,
    (node) =>
      node.nodeName === "#text" &&
      "value" in node &&
      /Web・電話受付開始/u.test(node.value),
  );
  if (openingTexts.length > 1) throw new SourceParseFailure();
  const opening = openingTexts[0];
  if (opening === undefined) {
    if (/Web・電話受付開始/u.test(normalizedText(document)))
      throw new SourceParseFailure();
    return expected;
  }
  const text = normalizedText(opening);
  if (
    !/^\d{1,2}月\d{1,2}日[（(][^）)]+[）)]\s*\d{1,2}[：:]\d{2}よりWeb・電話受付開始！$/u.test(
      text,
    )
  )
    throw new SourceParseFailure();
  const actual = parseShochikuSaleMilestone(text, startsOn, endsOn);
  if (actual === null || actual.precision !== "datetime")
    throw new SourceParseFailure();
  if (expected !== null && saleDate(expected) !== saleDate(actual))
    throw new SourceParseFailure();
  return actual;
}

export async function acquireKabukiGeneralSales(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
  reportHeldPage?: (page: HeldSourcePage) => void,
  pauseBetweenBatches: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 1_000)),
): Promise<{
  readonly drafts: readonly TicketOpportunityAcquisitionDraft[];
  readonly identities: readonly KabukiTicketIdentity[];
}> {
  const index = await fetcher(KABUKI_SOURCE, KABUKI_SOURCE.canonicalUrl);
  const facts = parseKabukiIndex(KABUKI_SOURCE, index.body);
  const drafts: TicketOpportunityAcquisitionDraft[] = [];
  const identities: KabukiTicketIdentity[] = [];
  for (let offset = 0; offset < facts.length; offset += 2) {
    const settled = await Promise.allSettled(
      facts.slice(offset, offset + 2).map(async (fact) => {
        const detail = await fetcher(KABUKI_SOURCE, fact.canonicalUrl);
        if (detail.url !== fact.canonicalUrl) throw new SourceParseFailure();
        let identity: KabukiTicketIdentity | null = null;
        try {
          const venues = descendants(
            parseHtml(detail.body),
            (node) =>
              elementName(node) === "p" && hasClass(node, "type-theater"),
          );
          if (venues.length !== 1 || venues[0] === undefined)
            throw new SourceParseFailure();
          const venue = normalizedText(venues[0]);
          const eventSourceKey = `kabuki-bito:${fact.theater}:play:${fact.officialId}`;
          identity = {
            officialExternalId: `${eventSourceKey}:general`,
            eventSourceKey,
            eventReference: {
              title: fact.title,
              venue,
              startsOn: fact.startsOn,
              endsOn: fact.endsOn,
            },
          };
          const milestone = parseKabukiGeneralSale(
            detail.body,
            fact.startsOn,
            fact.endsOn,
          );
          if (milestone === null) return { identity, draft: null };
          const draft = {
            candidateKind: "ticket_opportunity" as const,
            canonicalUrl: detail.url,
            officialExternalId: identity.officialExternalId,
            observedAt: detail.observedAt,
            contentHash: detail.contentHash,
            etag: detail.etag,
            lastModified: detail.lastModified,
            evidenceLocator: {
              sectionLabel: "チケット発売情報",
              fragmentId: "ticket",
              rowLabel: "一般販売",
            },
            eventReference: identity.eventReference,
            proposal: {
              eventSourceKey,
              sourceKey: `shochiku:${identity.officialExternalId}`,
              displayName: "一般販売",
              sourceUrl: detail.url,
              ...(milestone.precision === "date"
                ? { memo: "公式ページでは発売予定。承認前に最新情報を確認" }
                : {}),
              targetScope: "event_wide" as const,
              milestones: [milestone],
            },
          } satisfies TicketOpportunityAcquisitionDraft;
          return { identity, draft };
        } catch (error) {
          if (
            !(error instanceof SourceParseFailure) ||
            reportHeldPage === undefined
          )
            throw error;
          reportHeldPage({
            canonicalUrl: fact.canonicalUrl,
            officialExternalId: fact.officialId,
            title: fact.title,
            startsOn: fact.startsOn,
            endsOn: fact.endsOn,
            reasonCode: "source_parse",
          });
          return { identity, draft: null };
        }
      }),
    );
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      if (result.value.identity !== null)
        identities.push(result.value.identity);
      if (result.value.draft !== null) drafts.push(result.value.draft);
    }
    if (offset + 2 < facts.length) await pauseBetweenBatches();
  }
  return { drafts, identities };
}
