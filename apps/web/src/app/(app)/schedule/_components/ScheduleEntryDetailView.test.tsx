import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  personalScheduleEntrySchema,
  tokyoCalendarDateSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { ScheduleEntryDetailView } from "./ScheduleEntryDetailView";

function entry(blocking: boolean): PersonalScheduleEntry {
  return personalScheduleEntrySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: userIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    title: "旅行",
    memo: null,
    blocking,
    temporal: {
      kind: "all-day",
      startsOn: tokyoCalendarDateSchema.parse("2026-03-05"),
      endsOn: tokyoCalendarDateSchema.parse("2026-03-05"),
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * `blocking` に per-recipient override が無いこと（.ai-dev-foundation/product-rules.md「各 entry は
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
    const ownerBlockingBadge = screen.getByText("予定を確保する", {
      selector: '[data-slot="badge"]',
    });
    const ownerViewVariant = ownerBlockingBadge.getAttribute("data-variant");
    unmount();

    render(<ScheduleEntryDetailView entry={entry(true)} isOwner={false} />);
    const recipientBlockingBadge = screen.getByText("予定を確保する", {
      selector: '[data-slot="badge"]',
    });

    expect(recipientBlockingBadge.getAttribute("data-variant")).toBe(
      ownerViewVariant,
    );
  });

  it("renders the non-blocking indicator identically across renders when blocking=false", () => {
    render(<ScheduleEntryDetailView entry={entry(false)} isOwner={false} />);
    expect(
      screen.getByText("予定を確保しない", {
        selector: '[data-slot="badge"]',
      }),
    ).toBeInTheDocument();
  });
});
