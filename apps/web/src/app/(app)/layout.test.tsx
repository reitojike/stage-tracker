import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AppShellLayout from "./layout";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  hasUnreadNotifications: vi.fn(),
  resolveMyPageAppBarIdentity: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock("@/lib/data/reads/notifications", () => ({
  hasUnreadNotifications: mocks.hasUnreadNotifications,
}));

vi.mock("./_lib/app-bar-identity", () => ({
  resolveMyPageAppBarIdentity: mocks.resolveMyPageAppBarIdentity,
}));

vi.mock("@stage-tracker/ui", () => ({
  AppShell: (props: {
    children: React.ReactNode;
    hasUnreadNotifications?: boolean;
    notificationsHref?: string;
  }) =>
    React.createElement(
      "div",
      {
        "data-has-unread": String(props.hasUnreadNotifications),
        "data-notifications-href": props.notificationsHref,
        "data-testid": "app-shell",
      },
      props.children,
    ),
}));

describe("authenticated AppShell layout", () => {
  const supabase = { marker: "authenticated-client" };

  beforeEach(() => {
    mocks.createSupabaseServerClient.mockReset();
    mocks.hasUnreadNotifications.mockReset();
    mocks.resolveMyPageAppBarIdentity.mockReset();
    mocks.createSupabaseServerClient.mockResolvedValue(supabase);
    mocks.resolveMyPageAppBarIdentity.mockResolvedValue({
      myPageHref: "/mypage",
      myPageInitial: "A",
    });
  });

  it("reads the canonical unread boolean with the authenticated client and passes true to AppShell", async () => {
    mocks.hasUnreadNotifications.mockResolvedValue({ ok: true, value: true });

    const ui = await AppShellLayout({ children: <p>content</p> });
    render(ui);

    expect(mocks.hasUnreadNotifications).toHaveBeenCalledWith(supabase);
    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-has-unread",
      "true",
    );
    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-notifications-href",
      "/notifications",
    );
  });

  it("passes false without disabling the Notifications entry point when the unread read fails", async () => {
    mocks.hasUnreadNotifications.mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "private failure" },
    });

    const ui = await AppShellLayout({ children: <p>content</p> });
    render(ui);

    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-has-unread",
      "false",
    );
    expect(screen.getByTestId("app-shell")).toHaveAttribute(
      "data-notifications-href",
      "/notifications",
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
