/**
 * `next-safe-action` の `useAction`/`useAction().result.validationErrors` は
 * zod の `.format()` に似た tree 形状（`{ field: { _errors: string[] } }`）
 * を返す。Client Component からフィールド単位のエラー文言を取り出すための
 * 共有 helper。schema側で `path` を明示した issue をそのまま読むだけの
 * 薄い adapter）。
 *
 * 型を厳密に絞り込まず `unknown` から安全に読む: `.transform()` を含む
 * schema の `ValidationErrors` 型引数は next-safe-action 側の内部型
 * 推論に依存し、呼び出し側の component ごとに微妙に異なり得るため、
 * 構造的に安全な読み取りだけを保証する。
 */
export function fieldErrorMessage(
  validationErrors: unknown,
  field: string,
): string | undefined {
  if (!isUnknownRecord(validationErrors)) {
    return undefined;
  }
  const entry = validationErrors[field];
  if (!isUnknownRecord(entry)) {
    return undefined;
  }
  const errors = entry._errors;
  if (!isUnknownArray(errors) || errors.length === 0) {
    return undefined;
  }
  const [first] = errors;
  return typeof first === "string" ? first : undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
