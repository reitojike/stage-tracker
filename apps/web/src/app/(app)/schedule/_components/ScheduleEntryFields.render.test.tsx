import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScheduleEntryFields } from "./ScheduleEntryFields";

describe("ScheduleEntryFields selection controls", () => {
  it("renders the temporal mode selector as a compact two-column control", () => {
    render(<ScheduleEntryFields />);

    const group = screen.getByRole("radiogroup", { name: "予定の種類" });
    expect(group).toHaveClass("grid", "grid-cols-2");
    expect(group).not.toHaveClass("flex-col");
    expect(screen.getByRole("radio", { name: "終日" })).toHaveClass("min-h-11");
    expect(screen.getByRole("radio", { name: "時刻指定" })).toHaveClass(
      "min-h-11",
    );
  });

  it("submits blocking by presence and omits it when unchecked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <ScheduleEntryFields />
      </form>,
    );
    const form = container.querySelector("form");
    if (form === null) {
      throw new Error("schedule entry form is missing");
    }

    expect(new FormData(form).get("blocking")).toBe("on");
    await user.click(screen.getByRole("checkbox", { name: /blocking/ }));
    expect(new FormData(form).get("blocking")).toBeNull();
  });

  it("submits temporalMode and keeps radio keyboard navigation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <ScheduleEntryFields />
      </form>,
    );
    const form = container.querySelector("form");
    if (form === null) {
      throw new Error("schedule entry form is missing");
    }
    const allDay = screen.getByRole("radio", { name: "終日" });

    expect(new FormData(form).get("temporalMode")).toBe("all-day");
    allDay.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "時刻指定" })).toBeChecked();
    expect(new FormData(form).get("temporalMode")).toBe("time-bounded");
  });
});
