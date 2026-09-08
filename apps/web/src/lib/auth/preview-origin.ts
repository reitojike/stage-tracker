/**
 * Vercel Preview デプロイの origin を解決する（`docs/v2/decisions.md` F4b）。
 *
 * **なぜ必要か**: `emailRedirectTo` を渡さないと、Supabase は project 設定の
 * Site URL（= Production）へ戻すリンクをメールに埋める。Preview で
 * サインインすると Production へ飛ばされ、Preview の動作確認ができない。
 *
 * **なぜ Host ヘッダを見ないか**: リクエストの `Host` / `X-Forwarded-Host` は
 * クライアントが指定できる。これを redirect 先に使うと、攻撃者が自分の
 * ドメインを載せたサインインリンクを他人のメールへ送らせられる。ここで読むのは
 * **Vercel が build 時に注入する framework の値だけ**で、リクエストからは
 * 一切導出しない。
 *
 * **なぜ host しか受け付けないか**: scheme / path / query / fragment を
 * 受け取れるようにすると、この小さな resolver が任意 URL の構築境界に変わる。
 */
const HOSTNAME_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

const MAX_HOSTNAME_LENGTH = 253;

function isPlausibleHostname(candidate: string | undefined): boolean {
  if (typeof candidate !== "string") {
    return false;
  }
  const value = candidate.trim();
  return (
    value.length > 0 &&
    value.length <= MAX_HOSTNAME_LENGTH &&
    HOSTNAME_PATTERN.test(value)
  );
}

/**
 * `vercelEnv` が `"preview"` のときだけ origin を返す。
 *
 * Production と local は `undefined` を返し、Supabase の Site URL による
 * 既定の挙動へ委ねる。**Production の URL はここで一切読まない** —
 * Preview の redirect 先に Production が混ざる経路を作らないため。
 *
 * branch URL を deployment URL より優先するのは、branch URL の方が
 * デプロイのたびに変わらず、Supabase 側の許可リストに登録しやすいため。
 *
 * 末尾のスラッシュは落とさない。Supabase が案内する Vercel 向けワイルドカード
 * (`https://*-<account-slug>.vercel.app/**`) が、この redirect 先の後ろへ
 * 付くコールバックパスと一致する形になっている。
 */
export function resolvePreviewOrigin(
  vercelEnv: string | undefined,
  branchUrl: string | undefined,
  deploymentUrl: string | undefined,
): string | undefined {
  if (vercelEnv !== "preview") {
    return undefined;
  }

  const host = [branchUrl, deploymentUrl].find(isPlausibleHostname);
  if (host === undefined) {
    return undefined;
  }

  // Vercel の framework 値は scheme を含まない形で届く。
  return `https://${host.trim()}/`;
}

/**
 * Vercel が注入する framework の環境値だけを読む薄い wrapper。
 * 分岐の判断そのものは `resolvePreviewOrigin` が持つ（純関数なので
 * 環境変数を触らずにテストできる）。
 */
export function readPreviewOrigin(): string | undefined {
  return resolvePreviewOrigin(
    process.env.NEXT_PUBLIC_VERCEL_ENV,
    process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL,
  );
}
