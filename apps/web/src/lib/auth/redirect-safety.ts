/**
 * サインイン後の redirect 先（`/auth/confirm` の `next` クエリパラメータ）
 * はメールのクエリ文字列に由来し、attacker-influenceable
 * （`docs/v2/oracle-domain.md` §2.12）。同一オリジンかつ単一スラッシュの
 * 絶対パスのみを許可し、それ以外は `/` にフォールバックする。
 */

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function safeRedirectPath(next: string | null | undefined): string {
  if (next === null || next === undefined || next.length === 0) {
    return "/";
  }

  // CR/LF 等の制御文字は Location header へ絶対に到達させない。実際には
  // runtime がレスポンス全体を reject するため、"%0D%0A" を含むリンクは
  // ユーザーの one-time token を消費した上で 500 を返してしまう
  // （サインインに失敗する）。
  if (hasControlCharacter(next)) {
    return "/";
  }

  // 一部の user agent はバックスラッシュをスラッシュへ正規化するため、
  // "/\evil.example" が scheme-relative URL として解釈され得る。
  // 両方の形を拒否する。
  const normalized = next.replaceAll("\\", "/");

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/";
  }

  return normalized;
}
