import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SourceParseFailure,
  type EventAcquisitionDraft,
  type OfficialSourceAdapter,
} from "../acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "../source-registry";
import { normalizedText, parseHtml } from "./html";
import { fetchOfficialJson, type OfficialJsonFetcher } from "./http";
import { calendarDate } from "./japanese-date";

const API_PATH = "/wp-json/tribe/events/v1/events/";
const MAX_PAGES = 20;
const MAX_EVENTS = 500;

const eventSchema = z
  .object({
    id: z.number().int().positive(),
    status: z.literal("publish"),
    url: z.url(),
    title: z.string().min(1),
    all_day: z.boolean(),
    start_date: z.string(),
    end_date: z.string(),
    timezone: z.literal("Asia/Tokyo"),
    hide_from_listings: z.boolean(),
    venue: z.union([
      z.object({ venue: z.string().min(1) }).passthrough(),
      z.array(z.unknown()).length(0),
      z.null(),
    ]),
  })
  .passthrough();

const pageSchema = z
  .object({
    events: z.array(eventSchema),
    total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
    next_rest_url: z.url().nullish(),
  })
  .passthrough();

type TribeEvent = z.infer<typeof eventSchema>;

function localDateTime(value: string): { date: string; at: string } {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u,
  );
  if (match === null) throw new SourceParseFailure();
  const date = calendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) throw new SourceParseFailure();
  return { date, at: `${date}T${match[4]}:${match[5]}:${match[6]}+09:00` };
}

function text(value: string): string {
  return normalizedText(parseHtml(value));
}

function groupFor(source: OfficialSourceDefinition) {
  if (source.id === "event.kyurushite.schedule") {
    return { key: "kyurushite", displayName: "きゅるりんってしてみて" };
  }
  if (source.id === "event.chumtoto.schedule") {
    return { key: "chumtoto", displayName: "ChumToto" };
  }
  throw new SourceParseFailure();
}

function draftFor(
  source: OfficialSourceDefinition,
  event: TribeEvent,
  observedAt: string,
): EventAcquisitionDraft | null {
  if (event.hide_from_listings) return null;
  const canonicalUrl = assertAllowedSourceUrl(source, event.url);
  if (!/^\/event\/[^/]+\/?$/u.test(new URL(canonicalUrl).pathname))
    throw new SourceParseFailure();
  const start = localDateTime(event.start_date);
  const end = localDateTime(event.end_date);
  if (Date.parse(end.at) < Date.parse(start.at)) throw new SourceParseFailure();
  const title = text(event.title);
  if (title === "") throw new SourceParseFailure();
  const venue = Array.isArray(event.venue)
    ? null
    : event.venue === null
      ? null
      : text(event.venue.venue);
  if (venue === "") throw new SourceParseFailure();
  const occurrences = event.all_day
    ? []
    : [{ doorsAt: null, startsAt: start.at, endsAt: end.at }];
  const proposal = {
    sourceKey: `tribe:${new URL(source.canonicalUrl).hostname}:${event.id}`,
    title,
    venue,
    sourceUrl: canonicalUrl,
    startsOn: start.date,
    endsOn: end.date,
    occurrences,
    groups: [groupFor(source)],
  };
  return {
    candidateKind: "event",
    canonicalUrl,
    officialExternalId: String(event.id),
    observedAt,
    contentHash: createHash("sha256")
      .update(JSON.stringify(proposal))
      .digest("hex"),
    etag: null,
    lastModified: null,
    evidenceLocator: { fragmentId: String(event.id), rowLabel: start.date },
    proposal,
  };
}

export function createWordpressTribeEventsAdapter(
  fetcher: OfficialJsonFetcher = fetchOfficialJson,
): OfficialSourceAdapter {
  return {
    async acquire(source): Promise<readonly EventAcquisitionDraft[]> {
      if (source.extractor !== "wordpress_tribe_events")
        throw new SourceParseFailure();
      groupFor(source);
      const initial = new URL(API_PATH, source.canonicalUrl);
      initial.searchParams.set("per_page", "50");
      let next: string | null = initial.toString();
      let total: number | null = null;
      let totalPages: number | null = null;
      const seenUrls = new Set<string>();
      const seenIds = new Set<number>();
      const drafts: EventAcquisitionDraft[] = [];

      for (
        let pageIndex = 0;
        pageIndex < MAX_PAGES && next !== null;
        pageIndex += 1
      ) {
        const requestUrl = assertAllowedSourceUrl(source, next);
        if (
          new URL(requestUrl).pathname !== API_PATH ||
          seenUrls.has(requestUrl)
        )
          throw new SourceParseFailure();
        seenUrls.add(requestUrl);
        const document = await fetcher(source, requestUrl);
        let raw: unknown;
        try {
          raw = JSON.parse(document.body);
        } catch {
          throw new SourceParseFailure();
        }
        const parsed = pageSchema.safeParse(raw);
        if (!parsed.success) {
          console.error(
            "Official WordPress event page schema mismatch",
            parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
            })),
          );
          throw new SourceParseFailure();
        }
        const page = parsed.data;
        total ??= page.total;
        totalPages ??= page.total_pages;
        if (
          page.total !== total ||
          page.total_pages !== totalPages ||
          page.total > MAX_EVENTS ||
          page.total_pages > MAX_PAGES ||
          (page.total === 0) !== (page.total_pages === 0) ||
          (page.total > 0 && page.events.length === 0)
        )
          throw new SourceParseFailure();
        for (const event of page.events) {
          if (seenIds.has(event.id)) throw new SourceParseFailure();
          seenIds.add(event.id);
          const draft = draftFor(source, event, document.observedAt);
          if (draft !== null) drafts.push(draft);
        }
        next = page.next_rest_url ?? null;
        if (
          (next === null) !==
          (totalPages === 0 || pageIndex + 1 === totalPages)
        )
          throw new SourceParseFailure();
      }
      if (next !== null || total === null || seenIds.size !== total)
        throw new SourceParseFailure();
      return drafts;
    },
  };
}
