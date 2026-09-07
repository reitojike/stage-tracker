import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatePanel, STATE_PANEL_VARIANTS } from "./state-panel";

describe("StatePanel", () => {
  it.each(STATE_PANEL_VARIANTS)(
    "renders title -> description -> action for variant=%s",
    (variant) => {
      render(
        <StatePanel
          variant={variant}
          title="タイトル"
          description="説明文"
          action={<button type="button">アクション</button>}
        />,
      );

      const title = screen.getByText("タイトル");
      const description = screen.getByText("説明文");
      const action = screen.getByRole("button", { name: "アクション" });

      // Same structural order for all 3 variants - the oracle requires the
      // 3 states to share one structure and not be told apart visually.
      expect(
        title.compareDocumentPosition(description) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        description.compareDocumentPosition(action) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("marks data-variant so tests/tooling can tell the 3 states apart without relying on color", () => {
    render(<StatePanel variant="empty" title="空です" />);

    expect(
      screen.getByText("空です").closest("[data-slot='state-panel']"),
    ).toHaveAttribute("data-variant", "empty");
  });

  it("only the error variant gets role=alert", () => {
    const { rerender } = render(
      <StatePanel variant="error" title="読み込めませんでした" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("読み込めませんでした");

    rerender(<StatePanel variant="empty" title="0件です" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<StatePanel variant="unavailable" title="閲覧できません" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("omits the description/action nodes entirely when not given", () => {
    render(<StatePanel variant="empty" title="タイトルのみ" />);

    expect(screen.getByText("タイトルのみ")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // --- Compile-time regression tests -----------------------------------
  // `pnpm run typecheck` (tsc --noEmit) is what actually enforces these -
  // vitest strips types and does not evaluate `@ts-expect-error` itself.
  // If either the "no default" or "closed union" invariant were ever
  // weakened, `tsc` would report an unused `@ts-expect-error` directive and
  // typecheck would fail.
  it("never runs (compile-time only) - variant has no default value", () => {
    function assertVariantIsRequired() {
      // @ts-expect-error - `variant` is required; StatePanel must not have
      // a default variant (see StatePanelProps jsdoc).
      return <StatePanel title="variant なしでは呼べない" />;
    }
    void assertVariantIsRequired;
  });

  it("never runs (compile-time only) - variant is a closed 3-member union", () => {
    function assertVariantIsClosedUnion() {
      return (
        <StatePanel
          // @ts-expect-error - only "empty" | "error" | "unavailable" are
          // valid; a typo'd/invented variant must not silently compile.
          variant="not-a-real-variant"
          title="不正な variant"
        />
      );
    }
    void assertVariantIsClosedUnion;
  });
});
