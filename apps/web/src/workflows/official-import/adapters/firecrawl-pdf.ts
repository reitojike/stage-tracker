import { z } from "zod";
import { ProviderUnavailableFailure, SourceParseFailure } from "../acquisition";

const FIRECRAWL_PARSE_ENDPOINT = "https://api.firecrawl.dev/v2/parse";
const FIRECRAWL_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 2_000_000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

const opportunitySchema = z
  .object({
    phase: z.enum([
      "lottery",
      "lottery1",
      "lottery2",
      "lottery3",
      "general_sale",
    ]),
    displayName: z.string().trim().min(1).max(128),
    applicationStartDate: isoDate.nullable(),
    applicationStartTime: clockTime.nullable(),
    applicationEndDate: isoDate.nullable(),
    applicationEndTime: clockTime.nullable(),
    resultAnnouncementDate: isoDate.nullable(),
    resultAnnouncementTime: clockTime.nullable(),
    saleStartDate: isoDate.nullable(),
    saleStartTime: clockTime.nullable(),
    evidencePageNumber: z.number().int().positive().max(50),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [dateField, timeField] of [
      ["applicationStartDate", "applicationStartTime"],
      ["applicationEndDate", "applicationEndTime"],
      ["resultAnnouncementDate", "resultAnnouncementTime"],
      ["saleStartDate", "saleStartTime"],
    ] as const) {
      if (value[dateField] === null && value[timeField] !== null) {
        context.addIssue({
          code: "custom",
          path: [timeField],
          message: "A printed time requires its printed date",
        });
      }
    }
  });

const productionSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    venue: z.string().trim().min(1).max(256),
    startsOn: isoDate,
    endsOn: isoDate,
    opportunities: z.array(opportunitySchema).min(1).max(8),
  })
  .strict()
  .refine((value) => value.startsOn <= value.endsOn, {
    path: ["endsOn"],
    message: "Production end date must not precede start date",
  });

const extractionSchema = z
  .object({ productions: z.array(productionSchema).max(200) })
  .strict();

export type TakarazukaFriendsExtraction = z.infer<typeof extractionSchema>;

export interface StructuredPdfProvider {
  extractTakarazukaFriends(
    pdf: Uint8Array,
  ): Promise<TakarazukaFriendsExtraction>;
}

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["productions"],
  properties: {
    productions: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "venue", "startsOn", "endsOn", "opportunities"],
        properties: {
          title: { type: "string" },
          venue: { type: "string" },
          startsOn: { type: "string", format: "date" },
          endsOn: { type: "string", format: "date" },
          opportunities: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "phase",
                "displayName",
                "applicationStartDate",
                "applicationStartTime",
                "applicationEndDate",
                "applicationEndTime",
                "resultAnnouncementDate",
                "resultAnnouncementTime",
                "saleStartDate",
                "saleStartTime",
                "evidencePageNumber",
              ],
              properties: {
                phase: {
                  type: "string",
                  enum: [
                    "lottery",
                    "lottery1",
                    "lottery2",
                    "lottery3",
                    "general_sale",
                  ],
                },
                displayName: { type: "string" },
                applicationStartDate: {
                  anyOf: [{ type: "string", format: "date" }, { type: "null" }],
                },
                applicationStartTime: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
                    },
                    { type: "null" },
                  ],
                },
                applicationEndDate: {
                  anyOf: [{ type: "string", format: "date" }, { type: "null" }],
                },
                applicationEndTime: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
                    },
                    { type: "null" },
                  ],
                },
                resultAnnouncementDate: {
                  anyOf: [{ type: "string", format: "date" }, { type: "null" }],
                },
                resultAnnouncementTime: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
                    },
                    { type: "null" },
                  ],
                },
                saleStartDate: {
                  anyOf: [{ type: "string", format: "date" }, { type: "null" }],
                },
                saleStartTime: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
                    },
                    { type: "null" },
                  ],
                },
                evidencePageNumber: {
                  type: "integer",
                  minimum: 1,
                  maximum: 50,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const extractionPrompt = [
  "Extract only facts explicitly printed in this Takarazuka Friends schedule PDF.",
  "Create one production per title and venue, and separate 抽選方式, 第1抽選, 第2抽選, 第3抽選, and 一般前売 opportunities.",
  "Use the exact Japanese phase label as displayName.",
  "Convert printed calendar dates to YYYY-MM-DD using only the year explicitly associated with the schedule.",
  "For an application date range, set applicationStartDate and applicationEndDate.",
  "When a source date includes an explicit clock time, copy it as HH:mm in the corresponding Time field; otherwise use null. Never invent a time.",
  "Set resultAnnouncementDate only when the source prints one single result date; leave it null for a date range.",
  "Set saleStartDate only for an explicitly printed general sale start.",
  "Use null for absent, conditional, なし, or unreadable values. Never infer a date, time, venue, phase, or production.",
].join(" ");

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFirecrawlTakarazukaResponse(
  payload: unknown,
): TakarazukaFriendsExtraction {
  if (!record(payload) || payload.success !== true || !record(payload.data)) {
    throw new SourceParseFailure();
  }
  const parsed = extractionSchema.safeParse(payload.data.json);
  if (!parsed.success) throw new SourceParseFailure();
  return parsed.data;
}

export function createFirecrawlPdfProvider(
  apiKey: string | undefined,
  transport: typeof fetch = fetch,
): StructuredPdfProvider {
  return {
    async extractTakarazukaFriends(pdf) {
      if (apiKey === undefined) throw new ProviderUnavailableFailure();
      const form = new FormData();
      const fileBytes = new ArrayBuffer(pdf.byteLength);
      new Uint8Array(fileBytes).set(pdf);
      form.append(
        "file",
        new Blob([fileBytes], { type: "application/pdf" }),
        "schedule.pdf",
      );
      form.append(
        "options",
        JSON.stringify({
          formats: [
            {
              type: "json",
              schema: outputJsonSchema,
              prompt: extractionPrompt,
            },
          ],
          parsers: [
            {
              type: "pdf",
              mode: "auto",
              maxPages: 50,
              pages: true,
              blocks: true,
            },
          ],
          timeout: FIRECRAWL_TIMEOUT_MS,
        }),
      );
      let response: Response;
      try {
        response = await transport(FIRECRAWL_PARSE_ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch {
        throw new ProviderUnavailableFailure();
      }
      if (!response.ok) throw new ProviderUnavailableFailure();
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_RESPONSE_BYTES
      ) {
        throw new SourceParseFailure();
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new ProviderUnavailableFailure();
      }
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new SourceParseFailure();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new SourceParseFailure();
      }
      return parseFirecrawlTakarazukaResponse(payload);
    },
  };
}
