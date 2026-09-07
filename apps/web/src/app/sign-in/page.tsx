import { Button } from "@stage-tracker/ui";
import { requestSignInLink } from "./actions";

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `?error=` の既知の値のみを表示対象にする。Map なら `?error=toString` の
 * ような query 値で `Object.prototype` 由来のプロパティを引いてしまう
 * 心配がない（`Map.get` は実際に `set` された key しか返さない）。
 */
const AUTH_ERRORS = new Map<string, { title: string; description: string }>([
  [
    "link_expired",
    {
      title: "サインインリンクが無効です",
      description:
        "リンクの有効期限が切れているか、すでに使用されています。もう一度サインインリンクを送信してください。",
    },
  ],
  [
    "missing_email",
    {
      title: "メールアドレスを入力してください",
      description: "サインインリンクの送信先となるメールアドレスが空でした。",
    },
  ],
]);

/**
 * サインイン画面（`docs/v2/oracle-routes-ui.md` §1 `/sign-in`）。
 *
 * enumeration 対策として、送信後（`requested=1`）はアカウントの有無を
 * 一切示唆しない中立文言のみを表示する（`requestSignInLink` 参照）。
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const requested = params.requested === "1";
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const authError =
    errorKey === undefined ? undefined : AUTH_ERRORS.get(errorKey);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">サインイン</h1>

      {authError ? (
        <div
          role="alert"
          className="w-full max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">{authError.title}</p>
          <p>{authError.description}</p>
        </div>
      ) : null}

      {requested ? (
        <p className="w-full max-w-sm text-sm text-muted-foreground">
          {/* アカウントの有無・メール送信成否のいずれも示唆しない
              (docs/v2/oracle-routes-ui.md §1 / §2 サインイン)。 */}
          リクエストを受け付けました。登録済みのメールアドレスで、メール送信が利用可能な場合はサインインリンクが届きます。届かない場合は時間をおいて再試行するか、管理者に連絡してください。
        </p>
      ) : (
        <form
          action={requestSignInLink}
          className="flex w-full max-w-sm flex-col gap-3"
        >
          <label htmlFor="email" className="text-sm font-medium">
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit">リンクをリクエスト</Button>
        </form>
      )}
    </main>
  );
}
