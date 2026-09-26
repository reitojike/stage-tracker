import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn<
    (...args: unknown[]) => Promise<{ status: "completed" | "failed" }>
  >(),
}));

vi.mock("./steps/run-shadow-source", () => ({
  runOfficialImportShadowSource: (...args: unknown[]) => mocks.run(...args),
}));

const { officialImportScheduledShadowWorkflow } =
  await import("./scheduled-shadow-workflow");

const sources = [
  { sourceId: "event.kabuki-bito.schedule", tokyoDate: "2026-09-27" },
  { sourceId: "ticket.shochiku.schedule", tokyoDate: "2026-09-27" },
] as const;

describe("scheduled official import Workflow", () => {
  beforeEach(() => {
    mocks.run.mockReset();
    mocks.run.mockResolvedValue({ status: "completed" });
  });

  it("waits for Event acquisition before starting Ticket acquisition", async () => {
    let finishEvent: ((result: { status: "completed" }) => void) | undefined;
    mocks.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEvent = resolve;
        }),
    );

    const execution = officialImportScheduledShadowWorkflow(sources);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenNthCalledWith(
      1,
      "event.kabuki-bito.schedule",
      "2026-09-27",
    );
    finishEvent?.({ status: "completed" });
    await execution;
    expect(mocks.run).toHaveBeenNthCalledWith(
      2,
      "ticket.shochiku.schedule",
      "2026-09-27",
    );
  });

  it("still attempts Ticket acquisition after an Event failure", async () => {
    mocks.run.mockResolvedValueOnce({ status: "failed" });
    await expect(
      officialImportScheduledShadowWorkflow(sources),
    ).rejects.toThrow("One or more scheduled official imports failed");
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});
