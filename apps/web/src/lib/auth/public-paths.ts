/**
 * default-deny な認証境界が公開する唯一の許可リスト。
 *
 * `docs/v2/oracle-routes-ui.md` §0/§4.3 で確認した現行 (`src/proxy.ts`)
 * の `PUBLIC_PATHS` に対応する。これ以外の全パスは未認証アクセスを
 * 拒否する（新しい route を追加しても、この一覧へ明示的に足さない限り
 * 自動的には公開されない）。
 *
 * PWA の manifest / icon は現行では同じ default-deny 境界の例外だが、
 * `config.matcher`（静的解析が必要な Next.js の制約）側の除外として
 * 扱われ、この allowlist には含まれない。apps/web にはまだ PWA の
 * manifest route / icon asset 自体が存在しないため、ここでは追加しない
 * （実装され次第、`src/proxy.ts` の matcher 側で改めて確認すること）。
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/sign-in",
  "/auth/confirm",
]);

/**
 * 完全一致のみ。descendant（例: `/sign-in/internal`）まで公開してしまうと、
 * 将来そのプレフィックス配下へ追加された route が、allowlist へ明示的に
 * 追加されないまま未認証で到達可能になる。
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}
