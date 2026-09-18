import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import type { Database } from "./database.types";
import { server } from "@/test/msw/server";
import { isDesignatedCatalogCreator } from "./creator-capability";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const userId = userIdSchema.parse("11111111-1111-4111-8111-111111111111");

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

describe("isDesignatedCatalogCreator", () => {
  it("returns true when membership exists", async () => {
    server.use(
      http.get(`${REST_URL}/catalog_creators`, () =>
        HttpResponse.json({ user_id: userId }, { status: 200 }),
      ),
    );

    await expect(
      isDesignatedCatalogCreator(createTestClient(), userId),
    ).resolves.toBe(true);
  });

  it("returns false when membership does not exist", async () => {
    server.use(
      http.get(`${REST_URL}/catalog_creators`, () =>
        HttpResponse.json(
          {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          { status: 406 },
        ),
      ),
    );

    await expect(
      isDesignatedCatalogCreator(createTestClient(), userId),
    ).resolves.toBe(false);
  });

  it("returns false when the membership query fails", async () => {
    server.use(
      http.get(`${REST_URL}/catalog_creators`, () =>
        HttpResponse.json(
          { code: "PGRST000", message: "database unavailable" },
          { status: 500 },
        ),
      ),
    );

    await expect(
      isDesignatedCatalogCreator(createTestClient(), userId),
    ).resolves.toBe(false);
  });
});
