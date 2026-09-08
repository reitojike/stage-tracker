"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@stage-tracker/ui";
import { env } from "@/env";

/**
 * `docs/v2/oracle-routes-ui.md` §1 `/mypage`: 登録は Server Action ではなく
 * ブラウザ直接 `supabase.auth.registerPasskey()`（WebAuthn ceremony
 * (`navigator.credentials.create()`) のため Client 限定）。
 *
 * `@/lib/supabase/browser.ts` の共有 `createSupabaseBrowserClient` には
 * `experimental.passkey: true` flag が付いていない（このタスクの編集許可
 * 範囲外）ため、この画面専用にこの1箇所だけ独自 client を構築する
 * （`../_data/passkeySupabaseClient.ts` の server 版と同じ理由）。
 */
function createPasskeyBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { experimental: { passkey: true } } },
  );
}

type RegisterState =
  | { readonly status: "idle" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly message: string };

export function RegisterPasskeyButton() {
  const router = useRouter();
  const [state, setState] = useState<RegisterState>({ status: "idle" });

  async function handleRegister() {
    setState({ status: "busy" });
    const client = createPasskeyBrowserClient();
    const { error } = await client.auth.registerPasskey();
    if (error) {
      setState({
        status: "error",
        message: "Passkeyを登録できませんでした。もう一度お試しください。",
      });
      return;
    }
    setState({ status: "idle" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-xs">
      <Button
        type="button"
        variant="outline"
        disabled={state.status === "busy"}
        onClick={() => {
          void handleRegister();
        }}
      >
        {state.status === "busy" ? "登録中…" : "この端末にPasskeyを登録"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-body-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
