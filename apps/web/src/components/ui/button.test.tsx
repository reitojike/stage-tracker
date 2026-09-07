import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children as an accessible button", () => {
    render(<Button>クリック</Button>);

    expect(
      screen.getByRole("button", { name: "クリック" }),
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送信</Button>);

    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        無効
      </Button>,
    );

    const button = screen.getByRole("button", { name: "無効" });
    expect(button).toBeDisabled();

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});
