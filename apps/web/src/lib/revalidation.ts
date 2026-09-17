import { revalidatePath } from "next/cache";

/**
 * Read surfaces that can be affected by a supported write.
 *
 * The descriptors deliberately describe product surfaces rather than exposing
 * route strings to each action. Notifications and the authenticated AppShell
 * are represented here as bounded read-surface descriptors; their mutation
 * contract uses the same `revalidateReadSurfaces` boundary.
 */
export type ReadSurface =
  | "home"
  | "calendar"
  | "catalog"
  | "invitations"
  | "myPage"
  | "tickets"
  | "eventDetail"
  | "eventEdit"
  | "scheduleDetail"
  | "notifications"
  | "appShell";

export type ReadSurfaceDescriptor =
  | {
      readonly surface: Exclude<
        ReadSurface,
        "eventDetail" | "eventEdit" | "scheduleDetail" | "appShell"
      >;
    }
  | { readonly surface: "eventDetail" | "eventEdit"; readonly eventId: string }
  | { readonly surface: "scheduleDetail"; readonly entryId: string }
  | { readonly surface: "appShell" };

type StaticSurface = Exclude<
  ReadSurface,
  "eventDetail" | "eventEdit" | "scheduleDetail" | "appShell"
>;

const STATIC_SURFACE_PATHS: Readonly<Record<StaticSurface, string>> = {
  home: "/",
  calendar: "/calendar",
  catalog: "/catalog",
  invitations: "/catalog/invitations",
  myPage: "/mypage",
  tickets: "/tickets",
  notifications: "/notifications",
};

function pathForSurface(descriptor: ReadSurfaceDescriptor): string {
  switch (descriptor.surface) {
    case "eventDetail":
      return `/catalog/events/${descriptor.eventId}`;
    case "eventEdit":
      return `/catalog/events/${descriptor.eventId}/edit`;
    case "scheduleDetail":
      return `/schedule/${descriptor.entryId}`;
    case "appShell":
      throw new Error("AppShell must be revalidated as a layout descriptor");
    default:
      return STATIC_SURFACE_PATHS[descriptor.surface];
  }
}

/**
 * The only runtime owner of `next/cache` path invalidation in the app.
 * Callers provide a bounded, operation-specific descriptor list; this helper
 * does not infer or broaden the dependency graph.
 */
export function revalidateReadSurfaces(
  surfaces: readonly ReadSurfaceDescriptor[],
): void {
  for (const surface of surfaces) {
    if (surface.surface === "appShell") {
      // The authenticated routes use the `(app)` route-group layout for the
      // AppShell. Revalidate that layout only; the root layout also contains
      // unauthenticated routes and does not own the unread source.
      revalidatePath("/(app)", "layout");
      continue;
    }
    revalidatePath(pathForSurface(surface));
  }
}

const staticSurface = <T extends StaticSurface>(surface: T) => ({ surface });
const eventSurface = (
  surface: "eventDetail" | "eventEdit",
  eventId: string,
) => ({ surface, eventId });
const scheduleSurface = (entryId: string) => ({
  surface: "scheduleDetail" as const,
  entryId,
});

const EVENT_SHARED_SURFACES = [
  staticSurface("catalog"),
  staticSurface("tickets"),
  staticSurface("calendar"),
  staticSurface("home"),
  staticSurface("invitations"),
] as const satisfies readonly ReadSurfaceDescriptor[];

const EVENT_DETAIL_SURFACES = (eventId: string) =>
  [
    eventSurface("eventEdit", eventId),
    eventSurface("eventDetail", eventId),
  ] as const satisfies readonly ReadSurfaceDescriptor[];

const PARTICIPATION_SHARED_SURFACES = [
  staticSurface("calendar"),
  staticSurface("home"),
  staticSurface("invitations"),
  staticSurface("myPage"),
] as const satisfies readonly ReadSurfaceDescriptor[];

const EVENT_CONTENT_SURFACES = (eventId: string) =>
  [
    ...EVENT_DETAIL_SURFACES(eventId),
    ...EVENT_SHARED_SURFACES,
  ] as const satisfies readonly ReadSurfaceDescriptor[];

/**
 * Canonical affected-surface contracts for current supported mutations.
 * Keep these entries operation-specific: an event range does not change the
 * calendar's occurrence display, while occurrence timing does.
 */
export const affectedReadSurfaces = {
  eventCreate: () => [staticSurface("catalog")] as const,

  eventDetailsWrite: (eventId: string) => EVENT_CONTENT_SURFACES(eventId),

  eventRangeWrite: (eventId: string) =>
    [
      ...EVENT_DETAIL_SURFACES(eventId),
      staticSurface("catalog"),
    ] as const satisfies readonly ReadSurfaceDescriptor[],

  eventOccurrenceWrite: (eventId: string) => EVENT_CONTENT_SURFACES(eventId),

  eventCancellationWrite: (eventId: string) => EVENT_CONTENT_SURFACES(eventId),

  eventDelete: (eventId: string) =>
    [
      ...EVENT_DETAIL_SURFACES(eventId),
      staticSurface("catalog"),
      staticSurface("tickets"),
      staticSurface("home"),
    ] as const satisfies readonly ReadSurfaceDescriptor[],

  participationWrite: (
    eventId: string,
    choice: "attending" | "considering" | "withdraw",
  ) =>
    choice === "attending"
      ? [eventSurface("eventDetail", eventId), ...PARTICIPATION_SHARED_SURFACES]
      : [
          eventSurface("eventDetail", eventId),
          staticSurface("calendar"),
          staticSurface("home"),
        ],

  participationConvergence: () => PARTICIPATION_SHARED_SURFACES,

  invitationCreate: () =>
    [staticSurface("invitations"), staticSurface("myPage")] as const,

  invitationDecline: () =>
    [staticSurface("invitations"), staticSurface("myPage")] as const,

  scheduleEntryCreate: () =>
    [staticSurface("calendar"), staticSurface("home")] as const,

  scheduleEntryWrite: (entryId: string) =>
    [
      staticSurface("calendar"),
      staticSurface("home"),
      scheduleSurface(entryId),
    ] as const,

  scheduleEntryDelete: (entryId: string) =>
    [
      staticSurface("calendar"),
      staticSurface("home"),
      scheduleSurface(entryId),
    ] as const,

  scheduleShareWrite: (entryId: string) =>
    [
      staticSurface("calendar"),
      staticSurface("home"),
      scheduleSurface(entryId),
    ] as const,

  ticketOpportunityStateWrite: () =>
    [staticSurface("tickets"), staticSurface("home")] as const,

  passkeyDelete: () => [staticSurface("myPage")] as const,

  notificationRead: () =>
    [staticSurface("notifications"), { surface: "appShell" }] as const,
};
