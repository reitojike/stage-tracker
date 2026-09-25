import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAll = vi.fn();
const mockSet = vi.fn();
const cookieStore = { getAll: mockGetAll, set: mockSet };

type CookieToSet = {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
};

type ServerClientOptions = {
  readonly auth?: { readonly experimental?: { readonly passkey?: boolean } };
  readonly cookies: {
    readonly getAll: () => unknown;
    readonly setAll: (cookies: readonly CookieToSet[]) => void;
  };
};

const mockCreateServerClient =
  vi.fn<
    (
      url: string,
      key: string,
      options: ServerClientOptions,
    ) => { readonly options: ServerClientOptions }
  >();

const createdOptions: ServerClientOptions[] = [];

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    url: string,
    key: string,
    options: ServerClientOptions,
  ) => mockCreateServerClient(url, key, options),
}));

const { createSupabaseCookielessServerClient, createSupabaseServerClient } =
  await import("./server");

describe("Supabase server factories", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
    mockGetAll.mockReset();
    mockSet.mockReset();
    createdOptions.length = 0;
    mockCreateServerClient.mockImplementation(
      (_url: string, _key: string, options: ServerClientOptions) => {
        createdOptions.push(options);
        return { options } satisfies { options: ServerClientOptions };
      },
    );
    mockGetAll.mockReturnValue([{ name: "sb-session", value: "session" }]);
  });

  it("uses default Auth capabilities and preserves cookie wiring", async () => {
    await createSupabaseServerClient();
    const options = createdOptions[0];
    if (options === undefined) {
      throw new Error("createServerClient options were not captured");
    }
    expect(options.auth).toBeUndefined();

    expect(options.cookies.getAll()).toEqual([
      { name: "sb-session", value: "session" },
    ]);

    options.cookies.setAll([
      { name: "sb-session", value: "updated", options: { httpOnly: true } },
    ]);
    expect(mockSet).toHaveBeenCalledWith("sb-session", "updated", {
      httpOnly: true,
    });

    mockSet.mockImplementationOnce(() => {
      throw new Error("read-only cookie store");
    });
    expect(() =>
      options.cookies.setAll([
        { name: "sb-session", value: "updated", options: {} },
      ]),
    ).not.toThrow();
  });

  it("keeps the cookieless client write-free", async () => {
    await createSupabaseCookielessServerClient();
    const options = createdOptions[0];
    if (options === undefined) {
      throw new Error("createServerClient options were not captured");
    }

    expect(options.cookies.getAll()).toEqual([
      { name: "sb-session", value: "session" },
    ]);
    options.cookies.setAll([
      { name: "sb-code-verifier", value: "value", options: {} },
    ]);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
