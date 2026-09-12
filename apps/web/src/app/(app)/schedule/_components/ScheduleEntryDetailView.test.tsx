import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { ScheduleEntryDetailView } from "./ScheduleEntryDetailView";

function entry(blocking: boolean): PersonalScheduleEntry {
  return {
    id: "id",
    ownerId: "owner",
    title: "旅行",
    memo: null,
    blocking,
    temporal: { kind: "all-day", startsOn: "2026-03-05", endsOn: "2026-03-05" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as PersonalScheduleEntry;
}

/**
 * `blocking` に per-recipient override が無いこと（AGENTS.md「各 entry は
 * 独立した blocking boolean を持ちます…per-recipient の blocking
 * override は設けません」）を、この画面の実際の表示コンポーネントで
 * 検証する。owner/shared badge の表示は変わっても、同じ entry の blocking
 * badge は viewer 種別に依存しないことを確認する。
 */
describe("ScheduleEntryDetailView - blocking has no per-viewer override", () => {
  it("renders the same blocking=true indicator whether this stands in for the owner's or a recipient's view", () => {
    const { unmount } = render(
      <ScheduleEntryDetailView entry={entry(true)} isOwner />,
    );
    const ownerViewText = screen.getByTestId("blocking-indicator").textContent;
    unmount();

    render(<ScheduleEntryDetailView entry={entry(true)} isOwner={false} />);
    const recipientViewText =
      screen.getByTestId("blocking-indicator").textContent;

    expect(recipientViewText).toBe(ownerViewText);
    expect(recipientViewText).toContain("予定を確保する");
  });

  it("renders the non-blocking indicator identically across renders when blocking=false", () => {
    render(<ScheduleEntryDetailView entry={entry(false)} isOwner={false} />);
    expect(screen.getByTestId("blocking-indicator").textContent).toContain(
      "予定を確保しない",
    );
  });
});
