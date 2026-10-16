import { Activity } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { useSharedScheduleRead } from "./useSharedScheduleRead";

const action = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/schedule/shared-schedule-read-actions", () => ({
  readSharedScheduleAction: action,
}));
const actor = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
function Harness() {
  const { host, state, retry } = useSharedScheduleRead({ kind: "list" }, actor);
  return (
    <div ref={host}>
      <input aria-label="own input" defaultValue="own schedule" />
      <span>{state.status}</span>
      {state.status === "ready" && state.data.kind === "list" && (
        <span>private shared title</span>
      )}
      <button onClick={retry}>retry</button>
    </div>
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const reply = (actorId = actor) => ({
  data: { kind: "list", actorId, entries: [] },
});
let frames: FrameRequestCallback[];
beforeEach(() => {
  action.mockReset();
  frames = [];
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    0: new DOMRect(),
    length: 1,
    item: () => new DOMRect(),
    [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
  });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    frames.push(cb),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function frame() {
  await act(async () => {
    const callbacks = frames;
    frames = [];
    callbacks.forEach((cb) => cb(0));
  });
}
async function ready() {
  await act(async () => {});
  expect(screen.getByText("private shared title")).toBeVisible();
}

describe("shared read lifecycle", () => {
  it.each(["focus", "popstate", "pageshow"])(
    "hides cached data before a new %s read, keeps own input and rejects stale replies",
    async (event) => {
      const initial = deferred(),
        slow = deferred(),
        latest = deferred();
      action
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(slow.promise)
        .mockReturnValueOnce(latest.promise);
      render(<Harness />);
      expect(
        screen.queryByText("private shared title"),
      ).not.toBeInTheDocument();
      await act(async () => initial.resolve(reply()));
      await ready();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "unsaved input" },
      });
      const resume = () =>
        event === "pageshow"
          ? new PageTransitionEvent("pageshow", { persisted: true })
          : new Event(event);
      act(() => window.dispatchEvent(resume()));
      expect(
        screen.queryByText("private shared title"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue("unsaved input");
      await frame();
      act(() => window.dispatchEvent(resume()));
      await frame();
      await act(async () => slow.resolve(reply()));
      expect(
        screen.queryByText("private shared title"),
      ).not.toBeInTheDocument();
      await act(async () => latest.resolve(reply()));
      await ready();
      expect(screen.getByRole("textbox")).toHaveValue("unsaved input");
    },
  );
  it("keeps shared data hidden across tab hide, network rejection and retry until a new authorized reply", async () => {
    action.mockResolvedValueOnce(reply());
    render(<Harness />);
    await ready();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.queryByText("private shared title")).not.toBeInTheDocument();
    action.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await frame();
    expect(screen.getByText("error")).toBeVisible();
    expect(screen.queryByText("private shared title")).not.toBeInTheDocument();
    action.mockResolvedValueOnce({
      serverError: { kind: "permission-denied" },
    });
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {});
    expect(screen.getByText("unavailable")).toBeVisible();
    expect(screen.queryByText("private shared title")).not.toBeInTheDocument();
  });
  it("does not revive retained Activity data before the fresh read, preserving input", async () => {
    action.mockResolvedValueOnce(reply());
    const next = deferred();
    const { rerender } = render(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );
    await ready();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "retained input" },
    });
    rerender(
      <Activity mode="hidden">
        <Harness />
      </Activity>,
    );
    action.mockReturnValueOnce(next.promise);
    rerender(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );
    expect(screen.queryByText("private shared title")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("retained input");
    await act(async () => next.resolve(reply()));
    await ready();
  });
  it("rejects an authorized reply belonging to a different signed-in actor", async () => {
    action.mockResolvedValueOnce(
      reply(userIdSchema.parse("22222222-2222-4222-8222-222222222222")),
    );
    render(<Harness />);
    await act(async () => {});
    expect(screen.getByText("identity-changed")).toBeVisible();
    expect(screen.queryByText("private shared title")).not.toBeInTheDocument();
  });
});
