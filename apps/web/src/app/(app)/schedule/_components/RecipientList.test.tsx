import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  personalScheduleEntryIdSchema,
  scheduleShareIdSchema,
} from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipientList } from "./RecipientList";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  results: [] as Array<{ serverError?: { message: string } }>,
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => {
    const [result] = useState(() => {
      const nextResult: { serverError?: { message: string } } = {};
      mocks.results.push(nextResult);
      return nextResult;
    });
    return { execute: mocks.execute, isExecuting: false, result };
  },
}));

vi.mock("@/lib/actions/schedule/schedule-share-actions", () => ({
  removeScheduleShareAsOwnerAction: {},
}));

const recipients = [
  {
    shareId: scheduleShareIdSchema.parse(
      "22222222-2222-4222-8222-222222222222",
    ),
    recipientEmail: "first@example.com",
    sharedAt: "2026-01-01T00:00:00Z",
  },
  {
    shareId: scheduleShareIdSchema.parse(
      "33333333-3333-4333-8333-333333333333",
    ),
    recipientEmail: "second@example.com",
    sharedAt: "2026-01-02T00:00:00Z",
  },
];

describe("RecipientList", () => {
  const entryId = personalScheduleEntryIdSchema.parse(
    "11111111-1111-4111-8111-111111111111",
  );

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.results.length = 0;
  });

  it("gives each recipient removal button a unique accessible name", () => {
    render(<RecipientList entryId={entryId} recipients={recipients} />);

    expect(
      screen.getByRole("button", { name: "first@example.comの共有を解除" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "second@example.comの共有を解除" }),
    ).toBeInTheDocument();
  });

  it("shows removal failure feedback on the affected recipient row", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RecipientList entryId={entryId} recipients={recipients} />,
    );

    await user.click(
      screen.getByRole("button", { name: "second@example.comの共有を解除" }),
    );
    expect(mocks.execute).toHaveBeenCalledWith({
      entryId,
      shareId: recipients[1]?.shareId,
    });

    const secondRowResult = mocks.results[1];
    if (secondRowResult === undefined) {
      throw new Error("second recipient action result was not initialized");
    }
    secondRowResult.serverError = { message: "共有を解除できません。" };
    rerender(<RecipientList entryId={entryId} recipients={recipients} />);

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("共有を解除できません。");
    expect(alerts[0]?.parentElement).toHaveTextContent("second@example.com");
    expect(alerts[0]?.parentElement).not.toHaveTextContent("first@example.com");
  });
});
