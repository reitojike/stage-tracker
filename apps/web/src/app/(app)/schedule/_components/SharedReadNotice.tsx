"use client";
import { Button, StatePanel } from "@stage-tracker/ui";

export function SharedReadNotice({
  status,
  retry,
}: {
  readonly status:
    "checking" | "error" | "unavailable" | "identity-changed" | "ready";
  readonly retry: () => void;
}) {
  if (status === "ready") return null;
  return (
    <StatePanel
      variant={status === "error" ? "error" : "unavailable"}
      title={
        status === "checking"
          ? "共有予定を確認中です"
          : status === "identity-changed"
            ? "サインイン状態が変わりました。画面を開き直してください"
            : "共有予定を確認できません"
      }
      {...(status !== "identity-changed"
        ? {
            description:
              "確認できるまで共有予定を表示しません。自分の予定は引き続き利用できます。",
          }
        : {})}
      {...(status === "checking" || status === "identity-changed"
        ? {}
        : {
            action: (
              <Button type="button" variant="outline" onClick={retry}>
                共有予定を再確認
              </Button>
            ),
          })}
    />
  );
}
