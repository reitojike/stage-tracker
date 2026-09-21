"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, StatePanel } from "@stage-tracker/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  classifyPasskeyCeremonyError,
  resolveRegisterPasskeyFeedback,
  type PasskeyCeremonyFeedback,
} from "@/lib/passkey-ceremony-error";

/**
 * `specs/009-authentication-account-access/spec.md` `/mypage`: 登録は Server Action ではなく
 * ブラウザ直接 `supabase.auth.registerPasskey()`（WebAuthn ceremony
 * (`navigator.credentials.create()`) のため Client 限定）。
 *
 * Passkey capability は shared browser factory が所有するため、ceremony
 * ごとに同じ factory から client を取得する。
 */
type RegisterState =
  | { readonly status: "idle" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly feedback: PasskeyCeremonyFeedback };

export function RegisterPasskeyButton() {
  const router = useRouter();
  const [state, setState] = useState<RegisterState>({ status: "idle" });

  async function handleRegister() {
    setState({ status: "busy" });
    const client = createSupabaseBrowserClient();
    const { error } = await client.auth.registerPasskey();
    if (error) {
      const kind = classifyPasskeyCeremonyError(error);
      setState({
        status: "error",
        feedback: resolveRegisterPasskeyFeedback(kind),
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
        <StatePanel
          variant="error"
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}
    </div>
  );
}
