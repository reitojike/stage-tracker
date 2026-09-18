import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasskeySection } from "./PasskeySection";

const mockList = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { passkey: { list: mockList } },
  })),
}));

vi.mock("./RegisterPasskeyButton", () => ({
  RegisterPasskeyButton: () => <div>register-passkey</div>,
}));

vi.mock("./DeletePasskeyForm", () => ({
  DeletePasskeyForm: ({ passkeyLabel }: { passkeyLabel: string }) => (
    <button type="button">delete-{passkeyLabel}</button>
  ),
}));

vi.mock("../_data/passkeyDisplay", () => ({
  passkeyDisplayLabel: () => "device-label",
}));

describe("PasskeySection", () => {
  it("shows an error panel when listing fails", async () => {
    mockList.mockResolvedValueOnce({ data: null, error: new Error("failed") });

    render(await PasskeySection());

    expect(
      screen.getByText("Passkeyの一覧を取得できませんでした"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no Passkeys are registered", async () => {
    mockList.mockResolvedValueOnce({ data: [], error: null });

    render(await PasskeySection());

    expect(
      screen.getByText("登録済みのPasskeyはありません"),
    ).toBeInTheDocument();
  });

  it("renders registered Passkeys from the shared server client", async () => {
    mockList.mockResolvedValueOnce({
      data: [{ id: "passkey-1" }],
      error: null,
    });

    render(await PasskeySection());

    expect(screen.getByText("delete-device-label")).toBeInTheDocument();
  });
});
