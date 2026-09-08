/**
 * Vercel deployment environment 判定（Preview 判定）。
 *
 * PO 判断（`docs/v2/decisions.md`「PO 判断: Preview 環境の位置づけ」節）に
 * より、Vercel Preview は Production Supabase へ authenticated 接続しない。
 * これに対する独立レビュー（Codex, P1）指摘: `emailRedirectTo` を渡さない
 * だけでは authenticated flow を禁止できない。
 *
 *   1. 安定した branch URL に、以前のデプロイで発行された session cookie が
 *      新しい deployment でも `proxy.ts` に受理され続ける
 *   2. Production 向けメールの `token_hash` を Preview の公開
 *      `/auth/confirm` に渡せば、検証が通って Preview host に新しい
 *      session cookie が発行される
 *
 * その結果 Preview から Production データへの書き込みに到達できてしまう。
 * これを塞ぐため、`VERCEL_ENV` が `"preview"` のとき authenticated flow を
 * server-side で拒否する。判定はこのモジュールに閉じる。
 * `process.env.NEXT_PUBLIC_VERCEL_ENV` を読むのはこのモジュールだけであり、
 * 拒否を行う 3 箇所（`src/proxy.ts` / `src/app/auth/confirm/route.ts` /
 * `src/app/sign-in/actions.ts`）はすべて `isPreviewDeployment` を経由する。
 *
 * Vercel の framework 値だけを読む。リクエストの `Host` /
 * `X-Forwarded-Host` は絶対に読まない — これらは client が指定できるため、
 * 信頼すると default-deny 境界そのものを client 入力で迂回できてしまう
 * （`docs/architecture/authentication.md` が legacy 側で踏んだ設計原則と
 * 同じ理由）。
 *
 * `NEXT_PUBLIC_` prefix が付いた framework environment variable は、
 * Vercel の Next.js Framework Preset により Preview deployment へ自動付与
 * される（`docs/v2/decisions.md` 参照）。追加の設定は必要ない。
 */

/**
 * 判定の純関数本体。env を引数で受け取るため、テストは
 * `process.env` を一切変更せずにこの関数を検証できる。
 */
export function isPreviewVercelEnv(vercelEnv: string | undefined): boolean {
  return vercelEnv === "preview";
}

/**
 * 呼び出し側が実際に使う判定。`process.env.NEXT_PUBLIC_VERCEL_ENV` を
 * 読むのはこの関数だけ。
 */
export function isPreviewDeployment(): boolean {
  return isPreviewVercelEnv(process.env.NEXT_PUBLIC_VERCEL_ENV);
}
