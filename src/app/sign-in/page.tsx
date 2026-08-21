import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { Surface } from '@/ui/Surface';
import { TextInput } from '@/ui/TextInput';
import { requestSignInLink } from './actions.ts';

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// docs/ux-ui.md「Common states」に従い、auth failure は empty result と
// 同一表示にしません。ここでは meaning / message を feature 側が所有し、
// presentation は shared primitive へ委ねます。
const AUTH_ERRORS: Record<string, { title: string; description: string }> = {
  link_expired: {
    title: 'サインインリンクが無効です',
    description:
      'リンクの有効期限が切れているか、すでに使用されています。もう一度サインインリンクを送信してください。',
  },
  missing_email: {
    title: 'メールアドレスを入力してください',
    description: 'サインインリンクの送信先となるメールアドレスが空でした。',
  },
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const authError = errorKey === undefined ? undefined : AUTH_ERRORS[errorKey];

  return (
    <main>
      <h1>stage-tracker サインイン</h1>

      {authError ? (
        <StatePanel variant="error" title={authError.title} description={authError.description} />
      ) : null}

      {sent ? (
        <Surface variant="subtle">
          {/* Worded so it does not confirm whether an account exists for
              the submitted address (see requestSignInLink). */}
          <p>
            入力されたメールアドレスにアカウントが存在する場合、サインイン用のリンクを送信しました。届いたメールのリンクを開いてください。
          </p>
        </Surface>
      ) : (
        <form action={requestSignInLink}>
          <TextInput
            label="メールアドレス"
            name="email"
            type="email"
            required
            autoComplete="email"
            helperText="登録済みのメールアドレスにサインインリンクを送信します。"
          />
          <Button type="submit">サインインリンクを送信</Button>
        </form>
      )}
    </main>
  );
}
