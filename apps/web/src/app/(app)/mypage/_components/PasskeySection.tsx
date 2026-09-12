import { StatePanel } from "@stage-tracker/ui";
import { createPasskeyServerClient } from "../_data/passkeySupabaseClient";
import { passkeyDisplayLabel } from "../_data/passkeyDisplay";
import { DeletePasskeyForm } from "./DeletePasskeyForm";
import { RegisterPasskeyButton } from "./RegisterPasskeyButton";

/**
 * 未サインインでは表示自体をしない（呼び出し元の `page.tsx` 参照）。
 * `docs/v2/decisions.md`「M6 が負う責任」節どおり、読込失敗は必ず
 * `unavailable`/`error`（`StatePanel`）へ分類し、0件（empty文言）へ
 * 誤変換しない。
 */
export async function PasskeySection() {
  const client = await createPasskeyServerClient();
  const { data, error } = await client.auth.passkey.list();

  return (
    <section
      aria-labelledby="mypage-passkey-heading"
      className="flex flex-col gap-sm"
    >
      <h2
        id="mypage-passkey-heading"
        className="text-title leading-title font-semibold text-foreground"
      >
        Passkey
      </h2>
      <p className="text-body-sm text-muted-foreground">
        登録した端末では、次回以降メールアドレス入力なしでサインインできます。
      </p>

      <RegisterPasskeyButton />

      {error || data === null ? (
        <StatePanel
          variant="error"
          title="Passkeyの一覧を取得できませんでした"
          description="時間をおいてもう一度お試しください。"
        />
      ) : data.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          登録済みのPasskeyはありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {data.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-sm border-b border-border py-sm"
            >
              <span className="text-body-sm text-foreground">
                {passkeyDisplayLabel(passkey)}
              </span>
              <DeletePasskeyForm
                passkeyId={passkey.id}
                passkeyLabel={passkeyDisplayLabel(passkey)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
