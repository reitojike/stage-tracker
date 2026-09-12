import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  eventIdSchema,
  instantSchema,
  occurrenceIdSchema,
  tokyoCalendarDateSchema,
  userIdSchema,
  type Event,
  type Occurrence,
} from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddOccurrenceForm } from "./AddOccurrenceForm";
import { EditEventForm } from "./EditEventForm";
import { OccurrenceItem } from "./OccurrenceItem";

interface ActionSlot {
  readonly result: {
    validationErrors: undefined;
    serverError: { message: string } | undefined;
  };
  onSuccess: (() => void) | undefined;
  readonly reset: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  slots: [] as ActionSlot[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("next-safe-action/hooks", async () => {
  const React = await import("react");
  return {
    useAction: (_action: unknown, options?: { onSuccess?: () => void }) => {
      const slotRef = React.useRef<ActionSlot | null>(null);
      if (slotRef.current === null) {
        const slot: ActionSlot = {
          result: { validationErrors: undefined, serverError: undefined },
          onSuccess: options?.onSuccess,
          reset: vi.fn(() => {
            slot.result.serverError = undefined;
          }),
        };
        slotRef.current = slot;
        mocks.slots.push(slot);
      } else {
        slotRef.current.onSuccess = options?.onSuccess;
      }

      return {
        execute: mocks.execute,
        isExecuting: false,
        result: slotRef.current.result,
        reset: slotRef.current.reset,
        hasSucceeded: false,
      };
    },
  };
});

vi.mock("@/lib/actions/events", () => ({
  addOccurrenceAction: {},
  cancelEventAction: {},
  cancelEventOccurrenceAction: {},
  deleteEventAction: {},
  deleteEventOccurrenceAction: {},
  uncancelEventAction: {},
  uncancelEventOccurrenceAction: {},
  updateEventDetailsAction: {},
  updateEventRangeAction: {},
  updateOccurrenceAction: {},
}));

const EVENT_ID = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const OCCURRENCE_ID = occurrenceIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const OWNER_ID = userIdSchema.parse("22222222-2222-4222-8222-222222222222");

const event: Event = {
  id: EVENT_ID,
  ownerId: OWNER_ID,
  title: "My Event",
  venue: null,
  sourceUrl: null,
  memo: null,
  startsOn: tokyoCalendarDateSchema.parse("2026-05-01"),
  endsOn: tokyoCalendarDateSchema.parse("2026-05-31"),
  canceledAt: null,
  createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
  updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
};

const occurrence: Occurrence = {
  id: OCCURRENCE_ID,
  eventId: EVENT_ID,
  doorsAt: instantSchema.parse("2026-05-10T09:00:00Z"),
  startsAt: instantSchema.parse("2026-05-10T09:30:00Z"),
  endsAt: instantSchema.parse("2026-05-10T12:00:00Z"),
  canceledAt: null,
  createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
  updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.refresh.mockReset();
  mocks.slots.length = 0;
});

describe("Event edit Sheets", () => {
  it("opens range editing, closes on success, and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<EditEventForm event={event} occurrences={[]} />);

    await user.click(screen.getByRole("button", { name: "開催期間を変更" }));
    const dialog = screen.getByRole("dialog");
    const startsOn = within(dialog).getByLabelText(/開始日/);
    await user.clear(startsOn);
    await user.type(startsOn, "2026-05-02");
    await user.click(
      within(dialog).getByRole("button", { name: "開催期間を保存" }),
    );

    expect(mocks.execute).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsOn: "2026-05-02",
      endsOn: "2026-05-31",
    });

    const rangeAction = mocks.slots[1];
    if (rangeAction === undefined) {
      throw new Error("range action was not initialized");
    }
    await act(async () => rangeAction.onSuccess?.());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps range editing open and shows action failure feedback", async () => {
    const user = userEvent.setup();
    const view = render(<EditEventForm event={event} occurrences={[]} />);

    await user.click(screen.getByRole("button", { name: "開催期間を変更" }));
    const rangeAction = mocks.slots[1];
    if (rangeAction === undefined) {
      throw new Error("range action was not initialized");
    }
    rangeAction.result.serverError = { message: "期間を保存できません。" };
    view.rerender(<EditEventForm event={event} occurrences={[]} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "期間を保存できません。",
    );
  });

  it("resets occurrence-add fields after success and keeps the Sheet open", async () => {
    const user = userEvent.setup();
    render(<AddOccurrenceForm eventId={EVENT_ID} />);

    await user.click(screen.getByRole("button", { name: "＋ 公演回を追加" }));
    const dialog = screen.getByRole("dialog");
    const startsAt = within(dialog).getByLabelText(/開演日時/);
    await user.type(startsAt, "2026-05-10T18:30");
    await user.click(
      within(dialog).getByRole("button", { name: "公演回を追加" }),
    );

    expect(mocks.execute).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsAt: "2026-05-10T18:30",
      endsAt: "",
      doorsAt: "",
    });

    const addAction = mocks.slots[0];
    if (addAction === undefined) {
      throw new Error("add action was not initialized");
    }
    await act(async () => addAction.onSuccess?.());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(startsAt).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      "次の公演回を入力できます。",
    );

    fireEvent.change(startsAt, { target: { value: "2026-05-11T18:30" } });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "公演回を追加",
      }),
    );
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("keeps occurrence add open and shows action failure feedback", async () => {
    const user = userEvent.setup();
    const view = render(<AddOccurrenceForm eventId={EVENT_ID} />);
    await user.click(screen.getByRole("button", { name: "＋ 公演回を追加" }));

    const addAction = mocks.slots[0];
    if (addAction === undefined) {
      throw new Error("add action was not initialized");
    }
    addAction.result.serverError = { message: "公演回を追加できません。" };
    view.rerender(<AddOccurrenceForm eventId={EVENT_ID} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "公演回を追加できません。",
    );
  });

  it("opens occurrence editing and closes after a successful update", async () => {
    const user = userEvent.setup();
    render(<OccurrenceItem eventId={EVENT_ID} occurrence={occurrence} />);

    await user.click(screen.getByRole("button", { name: "変更" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(mocks.execute).toHaveBeenCalledWith({
      occurrenceId: OCCURRENCE_ID,
      startsAt: "2026-05-10T18:30",
      endsAt: "2026-05-10T21:00",
      doorsAt: "2026-05-10T18:00",
    });

    const updateAction = mocks.slots[0];
    if (updateAction === undefined) {
      throw new Error("update action was not initialized");
    }
    await act(async () => updateAction.onSuccess?.());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps occurrence editing open and shows update failure feedback", async () => {
    const user = userEvent.setup();
    const view = render(
      <OccurrenceItem eventId={EVENT_ID} occurrence={occurrence} />,
    );
    await user.click(screen.getByRole("button", { name: "変更" }));

    const updateAction = mocks.slots[0];
    if (updateAction === undefined) {
      throw new Error("update action was not initialized");
    }
    updateAction.result.serverError = { message: "公演回を保存できません。" };
    view.rerender(
      <OccurrenceItem eventId={EVENT_ID} occurrence={occurrence} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "公演回を保存できません。",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(updateAction.reset).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "変更" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires explicit occurrence-delete confirmation and keeps refusal visible", async () => {
    const user = userEvent.setup();
    const view = render(
      <OccurrenceItem eventId={EVENT_ID} occurrence={occurrence} />,
    );

    await user.click(
      screen.getByRole("button", { name: "この公演回を削除する" }),
    );
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "参加・招待データが無い場合のみ削除できます。",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.execute).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "この公演回を削除する" }),
    );
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(mocks.execute).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      occurrenceId: OCCURRENCE_ID,
    });

    const deleteAction = mocks.slots[3];
    if (deleteAction === undefined) {
      throw new Error("delete action was not initialized");
    }
    deleteAction.result.serverError = { message: "公演回を削除できません。" };
    view.rerender(
      <OccurrenceItem eventId={EVENT_ID} occurrence={occurrence} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "公演回を削除できません。",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(deleteAction.reset).toHaveBeenCalledTimes(2);

    await user.click(
      screen.getByRole("button", { name: "この公演回を削除する" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires event-delete confirmation and keeps refusal visible", async () => {
    const user = userEvent.setup();
    const view = render(<EditEventForm event={event} occurrences={[]} />);

    await user.click(
      screen.getByRole("button", { name: "このイベントを削除する" }),
    );
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("削除可能な公演回をまとめて削除します。");
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.execute).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "このイベントを削除する" }),
    );
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(mocks.execute).toHaveBeenCalledWith({ eventId: EVENT_ID });

    const deleteAction = mocks.slots[4];
    if (deleteAction === undefined) {
      throw new Error("delete action was not initialized");
    }
    deleteAction.result.serverError = { message: "イベントを削除できません。" };
    view.rerender(<EditEventForm event={event} occurrences={[]} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "イベントを削除できません。",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(deleteAction.reset).toHaveBeenCalledTimes(2);

    await user.click(
      screen.getByRole("button", { name: "このイベントを削除する" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cancel and uncancel as direct actions without confirmation Sheets", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EditEventForm event={event} occurrences={[]} />,
    );
    await user.click(
      screen.getByRole("button", { name: "このイベントを中止にする" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const canceledEvent = { ...event, canceledAt: event.updatedAt };
    rerender(<EditEventForm event={canceledEvent} occurrences={[]} />);
    await user.click(screen.getByRole("button", { name: "中止を解除する" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
