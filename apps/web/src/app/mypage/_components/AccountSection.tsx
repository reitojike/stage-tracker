import { Button } from "@stage-tracker/ui";
import { signOut } from "@/app/sign-out/actions";

/**
 * AGENTS.md「マイページ」: email 取得失敗時は識別情報行を出さず
 * サインアウトボタンのみ（明示エラー表示はなし）。
 */
export function AccountSection({ email }: { email: string | null }) {
  return (
    <section
      aria-labelledby="mypage-account-heading"
      className="flex flex-col gap-sm border-b-2 border-border pb-lg"
    >
      <h2
        id="mypage-account-heading"
        className="text-title leading-title font-semibold text-foreground"
      >
        アカウント
      </h2>
      {email !== null ? (
        <p className="text-body-sm text-muted-foreground">{email}</p>
      ) : null}
      <form action={signOut}>
        <Button type="submit" variant="outline">
          サインアウト
        </Button>
      </form>
    </section>
  );
}
