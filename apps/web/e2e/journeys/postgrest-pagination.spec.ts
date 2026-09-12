import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { listCatalogVenues } from "../../src/lib/data/reads/catalog";
import type { Database } from "../../src/lib/data/database.types";
import { createE2eAdminClient, deleteActor } from "../support/adminClient";
import { readLocalSupabaseStatus } from "../support/localSupabase";

const FIXTURE_COUNT = 1_001;
const PASSWORD = "Str0ng-Pagination-Passw0rd!";

/**
 * A8 closure: the old application had a real-PostgREST pagination proof,
 * while the current `runPagedSupabaseSelect` coverage only mocked the
 * `content-range` response. This test crosses local Supabase's real
 * `api.max_rows = 1000` boundary and calls the production catalog read
 * itself, so removing pagination from `listCatalogVenues` drops the final
 * fixture and fails this test.
 */
test("the current catalog venue read returns every row beyond PostgREST api.max_rows", async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The database integration proof only needs one browser project.",
  );

  const admin = createE2eAdminClient();
  const status = readLocalSupabaseStatus();
  const email = `pagination-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;
  const fixturePrefix = `a8-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  let userId: string | undefined;

  try {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createError).toBeNull();
    expect(created.user).not.toBeNull();
    userId = created.user?.id;
    if (userId === undefined) {
      throw new Error("Supabase returned no user for the pagination actor");
    }
    const actorUserId = userId;

    const { data: genre, error: genreError } = await admin
      .from("genres")
      .select("id")
      .eq("key", "takarazuka")
      .single();
    expect(genreError).toBeNull();
    if (genre === null) {
      throw new Error("Supabase returned no takarazuka genre");
    }

    const { error: insertError } = await admin.from("events").insert(
      Array.from({ length: FIXTURE_COUNT }, (_, index) => ({
        owner_id: actorUserId,
        title: `${fixturePrefix}-event-${String(index).padStart(4, "0")}`,
        venue: `${fixturePrefix}-venue-${String(index).padStart(4, "0")}`,
        starts_on: "2026-09-12",
        ends_on: "2026-09-12",
        genre_id: genre.id,
      })),
    );
    expect(insertError).toBeNull();

    const client = createClient<Database>(status.apiUrl, status.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    const result = await listCatalogVenues(client, genre.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`catalog venue read failed: ${result.error.kind}`);
    }

    const returned = new Set(result.value);
    for (let index = 0; index < FIXTURE_COUNT; index += 1) {
      expect(
        returned.has(
          `${fixturePrefix}-venue-${String(index).padStart(4, "0")}`,
        ),
      ).toBe(true);
    }
  } finally {
    if (userId !== undefined) {
      const { error } = await admin
        .from("events")
        .delete()
        .eq("owner_id", userId);
      if (error) {
        console.warn(
          `[e2e cleanup] failed to delete pagination events for ${userId}: ${error.message}`,
        );
      }
      await deleteActor(admin, userId);
    }
  }
});
