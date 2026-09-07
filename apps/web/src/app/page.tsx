"use client";

import { useAction } from "next-safe-action/hooks";
import { pingAction } from "@/app/_actions/ping";
import { Button } from "@/components/ui/button";

/**
 * env / Supabase client / next-safe-action の配線を実際に確認するための
 * 動作確認ページ。認証 UI は本 Task の scope 外のため、未サインイン状態
 * では `pingAction` が `unauthenticated` kind のエラーを返す — これも
 * 配線が正しく動いていることの証跡として、そのまま表示する。
 */
export default function Home() {
  const { execute, result, isExecuting } = useAction(pingAction);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">stage-tracker v2</h1>
      <Button
        disabled={isExecuting}
        onClick={() => execute({ message: "hello from the placeholder page" })}
      >
        {isExecuting ? "実行中…" : "pingAction を実行"}
      </Button>
      {result.data ? (
        <p className="text-sm text-muted-foreground">
          成功: userId={result.data.userId} / echo=
          {result.data.echoedMessage}
        </p>
      ) : null}
      {result.serverError ? (
        <p className="text-sm text-destructive">
          エラー種別: {result.serverError.kind} / {result.serverError.message}
        </p>
      ) : null}
      {result.validationErrors ? (
        <p className="text-sm text-destructive">入力エラーがあります。</p>
      ) : null}
    </main>
  );
}
