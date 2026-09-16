import { beforeEach, describe, expect, it, vi } from "vitest";

const EVENT_ID = "event-1";
const ENTRY_ID = "entry-1";
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { affectedReadSurfaces, revalidateReadSurfaces } =
  await import("./revalidation.js");

function revalidatedPaths(
  surfaces: Parameters<typeof revalidateReadSurfaces>[0],
) {
  revalidateReadSurfaces(surfaces);
  return revalidatePathMock.mock.calls.map(([path]) => path);
}

describe("affected read-surface contracts", () => {
  beforeEach(() => {
    revalidatePathMock.mockClear();
  });

  it("covers every event detail dependency for event detail writes", () => {
    expect(
      revalidatedPaths(affectedReadSurfaces.eventDetailsWrite(EVENT_ID)),
    ).toEqual([
      `/catalog/events/${EVENT_ID}/edit`,
      `/catalog/events/${EVENT_ID}`,
      "/catalog",
      "/tickets",
      "/calendar",
      "/",
      "/catalog/invitations",
    ]);
  });

  it("keeps event range writes off unrelated personal surfaces", () => {
    expect(
      revalidatedPaths(affectedReadSurfaces.eventRangeWrite(EVENT_ID)),
    ).toEqual([
      `/catalog/events/${EVENT_ID}/edit`,
      `/catalog/events/${EVENT_ID}`,
      "/catalog",
    ]);
  });

  it("makes generic attending and invitation accept share convergence surfaces", () => {
    const genericAttending = affectedReadSurfaces.participationWrite(
      EVENT_ID,
      "attending",
    );
    expect(genericAttending.slice(1)).toEqual(
      affectedReadSurfaces.participationConvergence(),
    );
    expect(revalidatedPaths(genericAttending)).toEqual([
      `/catalog/events/${EVENT_ID}`,
      "/calendar",
      "/",
      "/catalog/invitations",
      "/mypage",
    ]);
  });

  it("does not add invitation or mypage invalidation to non-attending choices", () => {
    expect(
      revalidatedPaths(
        affectedReadSurfaces.participationWrite(EVENT_ID, "considering"),
      ),
    ).toEqual([`/catalog/events/${EVENT_ID}`, "/calendar", "/"]);
  });

  it("uses the same pending-invitation contract for create and decline", () => {
    expect(affectedReadSurfaces.invitationCreate()).toEqual(
      affectedReadSurfaces.invitationDecline(),
    );
    expect(revalidatedPaths(affectedReadSurfaces.invitationCreate())).toEqual([
      "/catalog/invitations",
      "/mypage",
    ]);
  });

  it("materializes dynamic schedule paths without broad route patterns", () => {
    expect(
      revalidatedPaths(affectedReadSurfaces.scheduleEntryWrite(ENTRY_ID)),
    ).toEqual(["/calendar", "/", `/schedule/${ENTRY_ID}`]);
    expect(revalidatePathMock.mock.calls).not.toContainEqual([
      "/schedule/[entryId]",
      "page",
    ]);
  });
});
