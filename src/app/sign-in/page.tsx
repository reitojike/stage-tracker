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
  send_failed: {
    title: 'サインインリンクを送信できませんでした',
    description:
      'メールアドレスをご確認ください。アカウントが未登録の場合は、管理者にアカウント作成を依頼してください。',
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
          <p>サインイン用のリンクをメールで送信しました。届いたメールのリンクを開いてください。</p>
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
