import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Sheet } from "./sheet";

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open sheet
      </button>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
        title="Test sheet"
      >
        <button type="button">Body action</button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("supports controlled open/close, modal focus, Escape, backdrop, and focus return", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole("button", { name: "Open sheet" });
    await user.click(trigger);
    expect(
      screen.getByRole("heading", { name: "Test sheet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Test sheet" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByTestId("sheet-backdrop"));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Test sheet" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("keeps footer outside the scrollable body", () => {
    render(
      <Sheet
        open
        onOpenChange={() => undefined}
        title="Short viewport"
        footer={<button type="button">Save</button>}
      >
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByText("Body").parentElement).toHaveClass(
      "overflow-y-auto",
    );
  });
});
