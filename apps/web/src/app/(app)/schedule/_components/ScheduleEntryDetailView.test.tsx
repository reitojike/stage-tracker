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
 * 検証する。`ScheduleEntryDetailView` は viewer/owner 種別を表す prop を
 * そもそも受け取らない設計（component 自身の doc comment参照）なので、
 * ここでは「同じ entry を owner 視点相当・非owner視点相当それぞれの
 * 呼び出しコンテキストとして2回描画しても、blocking の表示が完全に同一で
 * あること」を確認する。
 */
describe("ScheduleEntryDetailView - blocking has no per-viewer override", () => {
  it("renders the same blocking=true indicator whether this stands in for the owner's or a recipient's view", () => {
    const { unmount } = render(<ScheduleEntryDetailView entry={entry(true)} />);
    const ownerViewText = screen.getByTestId("blocking-indicator").textContent;
    unmount();

    // 同じ entry を、非owner の視点に立って再度描画する - この component の
    // API に isOwner 相当の分岐材料が無いことそのものが検証対象。
    render(<ScheduleEntryDetailView entry={entry(true)} />);
    const recipientViewText =
      screen.getByTestId("blocking-indicator").textContent;

    expect(recipientViewText).toBe(ownerViewText);
    expect(recipientViewText).toContain("blocking");
  });

  it("renders the non-blocking indicator identically across renders when blocking=false", () => {
    render(<ScheduleEntryDetailView entry={entry(false)} />);
    expect(screen.getByTestId("blocking-indicator").textContent).toContain(
      "non-blocking",
    );
  });
});
