import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  it("shows a read-failure notice (not empty/no-op buttons) when participationUnavailable is true", () => {
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
      screen.queryByRole("button", { name: "参加する" }),
    ).not.toBeInTheDocument();
  });

  it("calls the action with 'attending' and updates the pressed state on success", async () => {
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

    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(mockedAction).toHaveBeenCalledWith({
      eventId,
      occurrenceId,
      choice: "attending",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "参加する" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    // Now that a participation exists, withdraw becomes available.
    expect(
      screen.getByRole("button", { name: "参加をやめる" }),
    ).toBeInTheDocument();
  });

  it("shows the server error message inline when the action reports a failure", async () => {
    // `serverError.kind`'s static type (from next-safe-action's inferred
    // `ServerError`) only carries the base kind vocabulary
    // (`@/lib/action-error.ts`'s `BaseActionErrorKind`), not this action's
    // feature-specific extra kind (`"occurrence-canceled"`) - `ActionError`
    // still carries the real value at runtime (see `./participation.ts`'s
    // `SetParticipationChoiceErrorKind`). The component only ever reads
    // `.message`, so this cast reflects a real, harmless runtime value the
    // static type is simply too narrow to express.
    mockedAction.mockResolvedValueOnce({
      serverError: {
        kind: "occurrence-canceled",
        message: "この公演は中止されているため、この操作はできません。",
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

    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "この公演は中止されているため、この操作はできません。",
    );
  });

  it("disables creating a new 'considering'/'attending' choice on an effectively-canceled occurrence with no existing row", () => {
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus={null}
        participationUnavailable={false}
        isEffectivelyCanceled
      />,
    );

    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "気になる" })).toBeDisabled();
  });

  it("still allows downgrading attending -> considering and withdraw on a canceled occurrence", () => {
    render(
      <ParticipationControls
        eventId={eventId}
        occurrenceId={occurrenceId}
        initialStatus="attending"
        participationUnavailable={false}
        isEffectivelyCanceled
      />,
    );

    // Downgrade (attending -> considering) and withdraw are always allowed,
    // even while canceled (AGENTS.md "Cancellation").
    expect(screen.getByRole("button", { name: "気になる" })).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "参加をやめる" }),
    ).not.toBeDisabled();
    // But re-affirming/staying at "attending" is not a *new* active
    // transition, so it must not be blocked either.
    expect(screen.getByRole("button", { name: "参加する" })).not.toBeDisabled();
  });
});
