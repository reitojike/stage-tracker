import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ticketOpportunityIdSchema } from "@stage-tracker/domain";
import { updateTicketOpportunityStateAction } from "@/lib/actions/ticketOpportunityState.actions";
import { TicketOpportunityStateControls } from "./TicketOpportunityStateControls";

vi.mock("@/lib/actions/ticketOpportunityState.actions", () => ({
  updateTicketOpportunityStateAction: vi.fn(),
}));

const opportunityId = ticketOpportunityIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);

const mockedAction = vi.mocked(updateTicketOpportunityStateAction);

describe("TicketOpportunityStateControls", () => {
  it("shows only 申し込む予定にする when not yet registered", () => {
    render(
      <TicketOpportunityStateControls
        opportunityId={opportunityId}
        initialState={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "申し込む予定にする" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録を解除" }),
    ).not.toBeInTheDocument();
  });

  it("calls the action with intent 'planned' and shows 申し込み済みにする / 登録を解除 after success", async () => {
    mockedAction.mockResolvedValueOnce({ data: { status: "planned" } });
    const user = userEvent.setup();

    render(
      <TicketOpportunityStateControls
        opportunityId={opportunityId}
        initialState={null}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "申し込む予定にする" }),
    );

    expect(mockedAction).toHaveBeenCalledWith({
      opportunityId,
      intent: "planned",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "申し込み済みにする" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "登録を解除" }),
    ).toBeInTheDocument();
  });

  it("shows 申し込む予定に戻す when already applied, and calls intent 'remove' on 登録を解除", async () => {
    mockedAction.mockResolvedValueOnce({ data: { status: null } });
    const user = userEvent.setup();

    render(
      <TicketOpportunityStateControls
        opportunityId={opportunityId}
        initialState="applied"
      />,
    );

    expect(
      screen.getByRole("button", { name: "申し込む予定に戻す" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "登録を解除" }));

    expect(mockedAction).toHaveBeenCalledWith({
      opportunityId,
      intent: "remove",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "申し込む予定にする" }),
      ).toBeInTheDocument(),
    );
  });

  it("shows the server error message inline when the action reports a failure", async () => {
    mockedAction.mockResolvedValueOnce({
      serverError: {
        kind: "failure",
        message: "申し込み状況を更新できませんでした。",
      },
    });
    const user = userEvent.setup();

    render(
      <TicketOpportunityStateControls
        opportunityId={opportunityId}
        initialState={null}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "申し込む予定にする" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "申し込み状況を更新できませんでした。",
    );
    // A failed attempt must not silently flip the displayed state.
    expect(
      screen.getByRole("button", { name: "申し込む予定にする" }),
    ).toBeInTheDocument();
  });
});
