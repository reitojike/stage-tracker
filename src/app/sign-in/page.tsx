import { requestSignInLink } from './actions.ts';

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Temporary minimal UI: #10's global UX/UI baseline (docs/ux-ui.md) isn't
// merged yet, so this intentionally does not build a bespoke visual system.
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const error = params.error;

  return (
    <main>
      <h1>stage-tracker サインイン</h1>

      {sent ? (
        <p>サインイン用のリンクをメールで送信しました。届いたメールのリンクを開いてください。</p>
      ) : (
        <form action={requestSignInLink}>
          <label htmlFor="email">メールアドレス</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
          <button type="submit">サインインリンクを送信</button>
        </form>
      )}

      {error === 'link_expired' && (
        <p role="alert">リンクの有効期限が切れているか、無効です。もう一度お試しください。</p>
      )}
      {error === 'send_failed' && (
        <p role="alert">
          サインインリンクを送信できませんでした。メールアドレスをご確認いただくか、管理者にお問い合わせください。
        </p>
      )}
    </main>
  );
}
