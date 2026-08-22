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
// A Map, not an object literal: `errorKey` comes straight from the query
// string, and an object lookup would resolve inherited keys - `?error=toString`
// would hand back Object.prototype.toString and render a blank error panel.
// Map.get only ever sees entries that were actually put in.
const AUTH_ERRORS = new Map<string, { title: string; description: string }>([
  [
    'link_expired',
    {
      title: 'サインインリンクが無効です',
      description:
        'リンクの有効期限が切れているか、すでに使用されています。もう一度サインインリンクを送信してください。',
    },
  ],
  [
    'missing_email',
    {
      title: 'メールアドレスを入力してください',
      description: 'サインインリンクの送信先となるメールアドレスが空でした。',
    },
  ],
]);

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const requested = params.requested === '1';
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const authError = errorKey === undefined ? undefined : AUTH_ERRORS.get(errorKey);

  return (
    <main>
      <h1>stage-tracker サインイン</h1>

      {authError ? (
        <StatePanel variant="error" title={authError.title} description={authError.description} />
      ) : null}

      {requested ? (
        <Surface variant="subtle">
          {/* Acknowledges the request only. It must not claim an email was
              sent, nor imply anything about whether the address has an
              account - see requestSignInLink. */}
          <p>
            リクエストを受け付けました。登録済みのメールアドレスで、メール送信が利用可能な場合はサインインリンクが届きます。届かない場合は時間をおいて再試行するか、管理者に連絡してください。
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
            helperText="登録済みのメールアドレス宛にサインインリンクをリクエストします。"
          />
          <Button type="submit">サインインリンクをリクエスト</Button>
        </form>
      )}
    </main>
  );
}
