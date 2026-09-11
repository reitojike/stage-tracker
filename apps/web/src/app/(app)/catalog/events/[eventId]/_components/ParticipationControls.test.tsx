import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, occurrenceIdSchema } from "@stage-tracker/domain";
import { setParticipationChoiceAction } from "@/lib/actions/participation.actions";
import { ParticipationControls } from "./ParticipationControls";

vi.mock("@/lib/actions/participation.actions", () => ({
  setParticipationChoiceAction: vi.fn(),
}));

const eventId = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const occurrenceId = occurrenceIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const mockedAction = vi.mocked(setParticipationChoiceAction);

describe("ParticipationControls", () => {
  beforeEach(() => mockedAction.mockReset());

  it("shows a read-failure notice without an interactive trigger", () => {
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus={null}
        participationUnavailable
        isEffectivelyCanceled={false}
      />,
    );
    expect(
      screen.getByText("参加状況を読み込めませんでした。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "変更" }),
    ).not.toBeInTheDocument();
  });

  it("shows only the change button when participation is absent", () => {
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus={null}
        participationUnavailable={false}
        isEffectivelyCanceled={false}
      />,
    );
    expect(
      screen.queryByTestId("participation-status"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更" })).toBeInTheDocument();
  });

  it("opens the Sheet and closes it after a successful choice", async () => {
    mockedAction.mockResolvedValueOnce({ data: { choice: "attending" } });
    const user = userEvent.setup();
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus={null}
        participationUnavailable={false}
        isEffectivelyCanceled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "変更" }));
    expect(
      screen.getByRole("heading", { name: "参加の状態" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "参加する" }));
    expect(mockedAction).toHaveBeenCalledWith({
      eventId,
      occurrenceId,
      choice: "attending",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "参加の状態" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("participation-status")).toHaveTextContent(
      "参加する",
    );
  });

  it("keeps the Sheet open and shows a server error when saving fails", async () => {
    mockedAction.mockResolvedValueOnce({
      serverError: {
        kind: "occurrence-canceled",
        message: "この公演回は中止されているため、この操作はできません。",
      },
    } as unknown as Awaited<ReturnType<typeof setParticipationChoiceAction>>);
    const user = userEvent.setup();
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus="considering"
        participationUnavailable={false}
        isEffectivelyCanceled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "変更" }));
    await user.click(screen.getByRole("button", { name: "参加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "この公演回は中止されているため、この操作はできません。",
    );
    expect(
      screen.getByRole("heading", { name: "参加の状態" }),
    ).toBeInTheDocument();
  });

  it("keeps new active choices disabled on a canceled occurrence", async () => {
    const user = userEvent.setup();
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus={null}
        participationUnavailable={false}
        isEffectivelyCanceled
      />,
    );
    await user.click(screen.getByRole("button", { name: "変更" }));
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "気になる" })).toBeDisabled();
  });

  it("keeps attending -> considering and withdraw available when canceled", async () => {
    const user = userEvent.setup();
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus="attending"
        participationUnavailable={false}
        isEffectivelyCanceled
      />,
    );
    await user.click(screen.getByRole("button", { name: "変更" }));
    expect(screen.getByRole("button", { name: "気になる" })).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "参加をやめる" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^参加する/ }),
    ).not.toBeDisabled();
  });
});
