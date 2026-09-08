import { instantSchema, instantToTokyoWallClock } from "@stage-tracker/domain";

/**
 * Passkey 一覧の表示ラベル（`<friendlyName> — <登録日時>`）。
 * `apps/legacy-web/src/domain/passkey.ts` の `passkeyDisplayLabel` と同じ
 * product 判断（PO 決定: 固定フォーマット、id は表示に含めない、
 * 衝突検出はしない）を、`@stage-tracker/domain` の Asia/Tokyo 変換のみで
 * 再実装したもの（legacy は import 禁止）。
 */
export interface PasskeyListItemRaw {
  readonly friendly_name?: string;
  readonly created_at: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function passkeyDisplayLabel(passkey: PasskeyListItemRaw): string {
  const name = passkey.friendly_name ?? "登録済みPasskey";
  const parsed = instantSchema.safeParse(passkey.created_at);
  if (!parsed.success) {
    return name;
  }
  const wall = instantToTokyoWallClock(parsed.data);
  const registeredAt = `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)} ${pad2(wall.hour)}:${pad2(wall.minute)}`;
  return `${name} — ${registeredAt}`;
}
