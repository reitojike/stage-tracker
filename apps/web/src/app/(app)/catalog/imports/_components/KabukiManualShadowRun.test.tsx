import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KabukiManualShadowRun } from "./KabukiManualShadowRun";

afterEach(() => vi.unstubAllGlobals());

describe("Kabuki manual shadow run", () => {
  it("starts only the Kabuki source once and reports the asynchronous handoff", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    render(<KabukiManualShadowRun />);

    const button = screen.getByRole("button", { name: "歌舞伎を手動取得" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/official-import/shadow",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: "event.kabuki-bito.schedule" }),
      },
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "取得を開始しました",
    );
    expect(button).toBeDisabled();
    expect(screen.getByText(/自動承認・反映はしません/u)).toBeInTheDocument();
  });

  it("allows a retry after a rejected start without claiming that a run began", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 403 })
      .mockResolvedValueOnce({ status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    render(<KabukiManualShadowRun />);

    const button = screen.getByRole("button", { name: "歌舞伎を手動取得" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "取得を開始できませんでした",
    );
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "取得を開始しました",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
