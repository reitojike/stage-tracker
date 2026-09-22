import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduleAndEventSection } from "./ScheduleAndEventSection";

describe("ScheduleAndEventSection", () => {
  it("shows both catalog-creator tools only to a designated creator", () => {
    const { rerender } = render(
      <ScheduleAndEventSection canCreateEvent pendingInvitationCount={0} />,
    );

    expect(
      screen.getByRole("link", { name: "イベントを追加" }),
    ).toHaveAttribute("href", "/catalog/events/new");
    expect(
      screen.getByRole("link", { name: "公式情報の確認" }),
    ).toHaveAttribute("href", "/catalog/imports");

    rerender(
      <ScheduleAndEventSection
        canCreateEvent={false}
        pendingInvitationCount={0}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "イベントを追加" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "公式情報の確認" }),
    ).not.toBeInTheDocument();
  });
});
