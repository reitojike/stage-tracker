import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScheduleEntryBadges } from "./ScheduleEntryBadges";

describe("ScheduleEntryBadges", () => {
  it.each([
    [true, true, "自分の予定", "予定を確保する", "subtle"],
    [true, false, "自分の予定", "予定を確保しない", "outline"],
    [false, true, "共有されている予定", "予定を確保する", "subtle"],
    [false, false, "共有されている予定", "予定を確保しない", "outline"],
  ])(
    "maps owner=%s blocking=%s to the canonical labels and variants",
    (isOwner, blocking, ownerLabel, blockingLabel, blockingVariant) => {
      const { container } = render(
        <ScheduleEntryBadges isOwner={isOwner} blocking={blocking} />,
      );

      expect(screen.getByText(ownerLabel)).toHaveAttribute(
        "data-variant",
        "subtle",
      );
      expect(screen.getByText(blockingLabel)).toHaveAttribute(
        "data-variant",
        blockingVariant,
      );
      expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(2);
    },
  );
});
