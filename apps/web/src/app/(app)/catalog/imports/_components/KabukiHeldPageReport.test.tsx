import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KabukiHeldPageReport } from "./KabukiHeldPageReport";

describe("Kabuki held page report", () => {
  it("links only the bounded page identity for human follow-up", () => {
    render(
      <KabukiHeldPageReport
        state={{
          variant: "populated",
          data: {
            runId: "00000000-0000-4000-8000-000000000001",
            startedAt: "2026-09-24T00:00:00Z",
            pages: [
              {
                canonicalUrl:
                  "https://www.kabuki-bito.jp/theaters/other/play/1000",
                officialExternalId: "1000",
                title: "保留公演",
                startsOn: "2026-10-01",
                endsOn: "2026-10-02",
                reasonCode: "source_parse",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "保留公演" })).toHaveAttribute(
      "href",
      "https://www.kabuki-bito.jp/theaters/other/play/1000",
    );
    expect(screen.getByText(/日程の解釈を要確認/u)).toBeInTheDocument();
    expect(
      screen.getByText(/以前の候補を承認・反映する前にも/u),
    ).toBeInTheDocument();
  });

  it("distinguishes a clean run from the absence of a completed run", () => {
    const { rerender } = render(
      <KabukiHeldPageReport
        state={{
          variant: "populated",
          data: {
            runId: "00000000-0000-4000-8000-000000000001",
            startedAt: "2026-09-24T00:00:00Z",
            pages: [],
          },
        }}
      />,
    );
    expect(
      screen.getByText("この取得で解析保留のページはありません。"),
    ).toBeInTheDocument();
    rerender(<KabukiHeldPageReport state={{ variant: "empty" }} />);
    expect(
      screen.getByText("完了した歌舞伎の取得履歴はまだありません。"),
    ).toBeInTheDocument();
  });
});
