export type OfficialImportDomainKind = "event" | "ticket_opportunity";
export type SourceFamilyAdapter =
  "http_html" | "pdf" | "calendar_feed" | "future_fallback";
export type SourcePolicyState = "approved" | "planned" | "hold";
export type FetchCadenceHint = "daily" | "weekly";

export interface OfficialSourceDefinition {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly allowedOrigin: string;
  readonly allowedPathPrefixes: readonly string[];
  readonly adapter: SourceFamilyAdapter;
  readonly domainKind: OfficialImportDomainKind;
  readonly enabled: boolean;
  readonly shadow: true;
  readonly policyState: SourcePolicyState;
  readonly fetchCadenceHint: FetchCadenceHint;
}

const SOURCES: readonly OfficialSourceDefinition[] = [
  {
    id: "event.kabuki-bito.schedule",
    canonicalUrl: "https://www.kabuki-bito.jp/schedule/",
    allowedOrigin: "https://www.kabuki-bito.jp",
    allowedPathPrefixes: ["/schedule/"],
    adapter: "http_html",
    domainKind: "event",
    enabled: true,
    shadow: true,
    policyState: "approved",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.takarazuka.revue",
    canonicalUrl: "https://kageki.hankyu.co.jp/sp/revue/index.html",
    allowedOrigin: "https://kageki.hankyu.co.jp",
    allowedPathPrefixes: ["/sp/revue/"],
    adapter: "http_html",
    domainKind: "event",
    enabled: true,
    shadow: true,
    policyState: "approved",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.cynhn.calendar",
    canonicalUrl: "https://cynhn.com/vertical_calendar",
    allowedOrigin: "https://cynhn.com",
    allowedPathPrefixes: ["/vertical_calendar"],
    adapter: "http_html",
    domainKind: "event",
    enabled: true,
    shadow: true,
    policyState: "approved",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.meme-tokyo.calendar",
    canonicalUrl: "https://www.memetokyo.com/vertical_calendar",
    allowedOrigin: "https://www.memetokyo.com",
    allowedPathPrefixes: ["/vertical_calendar"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.kyurushite.schedule",
    canonicalUrl: "https://www.kyurushite.com/schedule/",
    allowedOrigin: "https://www.kyurushite.com",
    allowedPathPrefixes: ["/schedule/"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.chumtoto.schedule",
    canonicalUrl: "https://chumtoto.jp/schedule/",
    allowedOrigin: "https://chumtoto.jp",
    allowedPathPrefixes: ["/schedule/"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.sayostay.schedule",
    canonicalUrl: "https://sayostay.dspm.jp/schedules/menu/18610",
    allowedOrigin: "https://sayostay.dspm.jp",
    allowedPathPrefixes: ["/schedules/menu/18610"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.arcana-project.calendar",
    canonicalUrl: "https://arcana-project.com/calendar",
    allowedOrigin: "https://arcana-project.com",
    allowedPathPrefixes: ["/calendar"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "event.pupa.schedule",
    canonicalUrl: "https://pupa11.com/schedule/",
    allowedOrigin: "https://pupa11.com",
    allowedPathPrefixes: ["/schedule/"],
    adapter: "http_html",
    domainKind: "event",
    enabled: false,
    shadow: true,
    policyState: "planned",
    fetchCadenceHint: "daily",
  },
  {
    id: "ticket.shochiku.schedule",
    canonicalUrl: "https://www1.ticket-web-shochiku.com/t/info/schedule.html",
    allowedOrigin: "https://www1.ticket-web-shochiku.com",
    allowedPathPrefixes: ["/t/info/schedule.html"],
    adapter: "http_html",
    domainKind: "ticket_opportunity",
    enabled: true,
    shadow: true,
    policyState: "approved",
    fetchCadenceHint: "daily",
  },
  {
    id: "ticket.takarazuka-friends.schedule-pdf",
    canonicalUrl: "https://kageki.hankyu.co.jp/friends/pdf/schedule.pdf",
    allowedOrigin: "https://kageki.hankyu.co.jp",
    allowedPathPrefixes: ["/friends/pdf/schedule.pdf"],
    adapter: "pdf",
    domainKind: "ticket_opportunity",
    enabled: true,
    shadow: true,
    policyState: "approved",
    fetchCadenceHint: "daily",
  },
  {
    id: "ticket.vpass.takarazuka-east",
    canonicalUrl: "https://www.vpassticket.jp/category/takarazuka-east/",
    allowedOrigin: "https://www.vpassticket.jp",
    allowedPathPrefixes: ["/category/takarazuka-east/"],
    adapter: "http_html",
    domainKind: "ticket_opportunity",
    enabled: false,
    shadow: true,
    policyState: "hold",
    fetchCadenceHint: "weekly",
  },
  {
    id: "ticket.vpass.takarazuka-west",
    canonicalUrl: "https://www.vpassticket.jp/category/takarazuka-west/",
    allowedOrigin: "https://www.vpassticket.jp",
    allowedPathPrefixes: ["/category/takarazuka-west/"],
    adapter: "http_html",
    domainKind: "ticket_opportunity",
    enabled: false,
    shadow: true,
    policyState: "hold",
    fetchCadenceHint: "weekly",
  },
];

const SOURCE_BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export class OfficialSourceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialSourceRegistryError";
  }
}

export function listOfficialSources(): readonly OfficialSourceDefinition[] {
  return SOURCES;
}

export function getOfficialSource(
  sourceId: string,
): OfficialSourceDefinition | null {
  return SOURCE_BY_ID.get(sourceId) ?? null;
}

export function requireEnabledShadowSource(
  sourceId: string,
): OfficialSourceDefinition {
  const source = getOfficialSource(sourceId);
  if (source === null) {
    throw new OfficialSourceRegistryError(
      `Unknown official source id: ${sourceId}`,
    );
  }
  if (!source.enabled || !source.shadow || source.policyState !== "approved") {
    throw new OfficialSourceRegistryError(
      `Official source is not enabled for shadow runs: ${sourceId}`,
    );
  }
  return source;
}

export function assertAllowedSourceUrl(
  source: OfficialSourceDefinition,
  candidateUrl: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    throw new OfficialSourceRegistryError(
      `Source URL is not absolute for ${source.id}`,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== source.allowedOrigin ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new OfficialSourceRegistryError(
      `Source URL is outside the allowlisted origin for ${source.id}`,
    );
  }
  const pathAllowed = source.allowedPathPrefixes.some((prefix) =>
    prefix.endsWith("/")
      ? parsed.pathname.startsWith(prefix)
      : parsed.pathname === prefix,
  );
  if (!pathAllowed) {
    throw new OfficialSourceRegistryError(
      `Source URL is outside the allowlisted path for ${source.id}`,
    );
  }
  parsed.hash = "";
  return parsed.toString();
}
