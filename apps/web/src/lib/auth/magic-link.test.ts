import { describe, expect, it, vi } from "vitest";
import type { MagicLinkAuthClient } from "./magic-link";
import { requestMagicLink } from "./magic-link";

function stubClient(
  signInWithOtp: MagicLinkAuthClient["auth"]["signInWithOtp"],
): MagicLinkAuthClient {
  return { auth: { signInWithOtp } };
}

describe("requestMagicLink", () => {
  it("always resolves to void, even when the request succeeds", async () => {
    const client = stubClient(async () => ({ error: null }));

    await expect(
      requestMagicLink(client, "known@example.test"),
    ).resolves.toBeUndefined();
  });

  it("always resolves to void when the account does not exist (no branch to observe)", async () => {
    // signInWithOtp itself never reveals account existence via its return
    // value (that's Supabase's own contract), but this asserts the
    // wrapper doesn't introduce an observable difference of its own.
    const client = stubClient(async () => ({ error: null }));

    await expect(
      requestMagicLink(client, "unknown@example.test"),
    ).resolves.toBeUndefined();
  });

  it("resolves to void and reports to diagnostics when the client returns an error", async () => {
    const authError = Object.assign(new Error("smtp outage"), {
      status: 500,
    });
    const client = stubClient(async () => ({ error: authError }));
    const requestFailed = vi.fn();

    await expect(
      requestMagicLink(client, "known@example.test", { requestFailed }),
    ).resolves.toBeUndefined();

    expect(requestFailed).toHaveBeenCalledTimes(1);
    expect(requestFailed).toHaveBeenCalledWith("known@example.test", {
      kind: "failure",
      message: "smtp outage",
    });
  });

  it("swallows a thrown (non-AuthError) rejection instead of letting it escape", async () => {
    const client = stubClient(() => {
      throw new Error("network down");
    });
    const requestFailed = vi.fn();

    await expect(
      requestMagicLink(client, "known@example.test", { requestFailed }),
    ).resolves.toBeUndefined();

    expect(requestFailed).toHaveBeenCalledWith("known@example.test", {
      kind: "failure",
      message: "network down",
    });
  });

  it("never enables public signup regardless of caller options", async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const client = stubClient(signInWithOtp);

    await requestMagicLink(client, "someone@example.test", undefined, {
      emailRedirectTo: "https://preview.example/",
    });

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "someone@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://preview.example/",
      },
    });
  });

  it("omits emailRedirectTo entirely when not provided", async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const client = stubClient(signInWithOtp);

    await requestMagicLink(client, "someone@example.test");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "someone@example.test",
      options: { shouldCreateUser: false },
    });
  });
});
