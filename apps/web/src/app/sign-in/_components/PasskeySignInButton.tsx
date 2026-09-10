"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button, StatePanel } from "@stage-tracker/ui";
import { env } from "@/env";
import {
  classifyPasskeyCeremonyError,
  resolveSignInPasskeyFeedback,
  type PasskeyCeremonyFeedback,
} from "@/lib/passkey-ceremony-error";

/**
 * `docs/v2/oracle-routes-ui.md:49` `/sign-in`「サインイン（Passkey優先＋
 * Magic Linkフォールバック）...Passkeyは Server Action ではなくブラウザ
 * 直接 `supabase.auth.signInWithPasskey()`」（Issue #406）。
 *
 * `@/lib/supabase/browser.ts` の共有 `createSupabaseBrowserClient` には
 * `experimental.passkey: true` flag が付いていないため、この画面専用に
 * 独自 client を構築する（`RegisterPasskeyButton.tsx` と同じ理由・同じ
 * 実装）。
 */
function createPasskeyBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { experimental: { passkey: true } } },
  );
}

type SignInState =
  | { readonly status: "idle" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly feedback: PasskeyCeremonyFeedback };

/**
 * discoverable credential のため、Magic Link と異なりメールアドレス入力を
 * 求めない。成功後は常に `/` へ遷移する（legacy の
 * `PasskeySignInButton.tsx` と同じく、どちらの経路も任意ページへの
 * return-to には対応していない）。
 */
export function PasskeySignInButton() {
  const router = useRouter();
  const [state, setState] = useState<SignInState>({ status: "idle" });

  async function handleSignIn() {
    setState({ status: "busy" });
    const client = createPasskeyBrowserClient();
    const { error } = await client.auth.signInWithPasskey();
    if (error) {
      const kind = classifyPasskeyCeremonyError(error);
      setState({
        status: "error",
        feedback: resolveSignInPasskeyFeedback(kind),
      });
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-xs">
      {state.status === "error" ? (
        <StatePanel
          variant="error"
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}
      <Button
        type="button"
        disabled={state.status === "busy"}
        onClick={() => {
          void handleSignIn();
        }}
      >
        {state.status === "busy" ? "サインイン中…" : "Passkeyでサインイン"}
      </Button>
      <p className="text-sm text-muted-foreground">
        登録済みの端末ならこれだけで入れます。
      </p>
    </div>
  );
}
