# Gate A remote environment runbook

Canonical Task Contract: Issue #61。この runbook は Gate A の bounded な
2-user dogfood remote environment（Vercel Hobby + 新規 hosted Supabase
project + Resend custom SMTP）のみを対象とします。一般的な production
deployment guide ではありません — Gate A を超えて deferred のまま残っている
事項は `docs/roadmap.md` / `docs/prd.md` を参照してください。

Gate A の bounded provider decision は当初 SMTP provider として Postmark
Developer を採用する想定でした（Issue #61 の「Bounded provider decision for
Gate A」参照）。実際の Production environment は代わりに **Resend** を
使っており、この runbook もそれに合わせて更新済みです。この切り替えは
operator 側の履歴に過ぎず（ここで再検討はしません）、他の Gate A bounded
decision（Vercel Hobby、新規 hosted Supabase project）を変更するものでは
ありません。sign-in provider は Magic Link のみから、Magic Link（account
bootstrap / recovery）+ Passkey（日常の primary sign-in path）へ拡張済み
です（Issue #106）。remote project 側の Passkey 有効化手順は下記「Auth
configuration」節を参照してください。

Repository migrations が唯一の schema authority です。Supabase Dashboard の
SQL editor で schema/RLS/RPCs を手編集しないでください — すべての schema
変更は `supabase/migrations/**` の migration として出荷し、この repository
から remote project へ適用します。

## Secret boundary

- deploy された app が受け取るのは `NEXT_PUBLIC_SUPABASE_URL` と
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` のみで、いずれも Vercel production
  environment variables です。両方とも public であることを前提に設計されて
  います（`src/infrastructure/supabase/env.ts` 参照）。
- Supabase の **service role key** は Vercel の environment variable として
  設定することも commit することもありません。operator 自身の shell から、
  一回のコマンド実行時にのみ
  `STAGE_TRACKER_REMOTE_SUPABASE_URL` / `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY`
  経由で使用します（`scripts/lib/adminTarget.mjs` 参照）。あるいは Supabase
  CLI 自身の linked-project auth を使います。
- Resend server tokens は Supabase Dashboard の Auth SMTP settings にのみ
  存在し、この repository にも Vercel にも存在しません。
- 実際の dogfood email address / service role key / Resend tokens /
  Vercel・Supabase project identifier を Issue / PR / commit message へ
  貼り付けないでください。2 名の dogfood account は `A` / `B` として記録
  します。

## One-time provider setup（operator-only、この repository の外での作業）

これらの手順は Vercel/Supabase/Resend への対話的な login を必要とし、agent
session が operator 自身の credential なしに実行できるものではありません。
完了の記録はこのファイルの checklist を編集して行い、実際の identifier は
記録しないでください。

1. この GitHub repository から新規 Vercel project（Hobby plan）を作成し、
   `main` を production branch にします。まだ build させないでください —
   手順 5 で必須の env var を先に投入する必要があり、投入前の最初の build は
   欠落値で throw します。
2. 新規 hosted Supabase project を作成します（Gate A では Free plan で
   問題ありません）。`supabase link` 用に project ref を控えておきます。
3. Resend account を作成し、送信 domain を verify します（Production では
   `stage-tracker.com` ルートドメインを使用しており、Cloudflare で登録・
   DNS 管理され、SPF/DKIM/DMARC レコードもそこに追加されています）。その
   domain の Resend SMTP credentials を控えます。
4. Supabase Dashboard の Auth → SMTP で custom SMTP を有効化し、Resend の
   SMTP credentials を入力し、sender / default From address を verify 済み
   の Resend domain 上のアドレスに設定します。unverified もしくは
   mismatched な From address だと Resend が送信を拒否し、magic-link mail
   が無言で届かなくなります。
5. Vercel project の Production environment variables に、hosted Supabase
   project の API settings（Project Settings → API）から
   `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定
   します。両方とも request 時に `src/infrastructure/supabase/env.ts` が
   読み、値が欠けていると throw します — 最初の production deploy はこれら
   を設定した後に行う必要があり、設定前に走った deploy は設定後に再 deploy
   する必要があります。

## Schema migration to the hosted project

Supabase CLI がインストールされ authenticate 済み（`supabase login`）の
マシンから実行します。

```bash
supabase link --project-ref <the-project-ref-from-step-2>
supabase db push
```

`supabase db push` は `supabase/migrations/**` を順番に適用し、remote
project 上に migration history を記録します。完了後、drift がないことを
確認します。

```bash
supabase db diff --linked
```

diff が空であれば remote schema は repository と完全に一致しています。
非空の diff は、migration の外側で何かが変更されたこと（多くの場合
Dashboard での手編集）を意味し、先へ進む前に調査が必要です — drift した
状態をそのまま re-state するだけの新しい migration で覆い隠さないで
ください。

migration を追加する merge の後は毎回 `supabase db push` を re-run します。
hosted project へ migration を push する自動 CI ステップは存在しません。
これは意図的な manual operator action です（Issue #61: 「multiple
sessions が同じ remote schema を無秩序に mutate しない」）。

## Auth configuration（Supabase Dashboard → Authentication）

- **URL Configuration → Site URL**: この project の canonical Vercel
  production URL。
- **URL Configuration → Redirect URLs**: 同一 origin の `/auth/confirm`
  path を追加します（magic-link template がリンクする route —
  `src/app/auth/confirm/route.ts` と `supabase/config.toml` の
  `[auth.email.template.magic_link]` 配下のコメント参照）。
- **Providers → Email**: 有効化し、confirmations は off にします
  （`supabase/config.toml` の local baseline と一致）。
- **Auth settings → Allow new users to sign up**: **無効化**します。これは
  `supabase/config.toml` の `enable_signup = false` の remote 相当であり、
  local `config.toml` が適用されなくなった後の実際の enforcement point
  です。Dashboard へアクセスするたびに off になっていることを確認して
  ください — この節で最も重要な設定です。
- **Email Templates → Magic Link**: `supabase/templates/magic_link.html`
  （この repository の source of truth）の内容を貼り付け、hosted project
  のリンクも local development と同様に `/auth/confirm` を経由するように
  します。Supabase の default template は、この app の route handler を
  bypass してしまいます。

Supabase CLI には `supabase config push` という、`supabase/config.toml` の
`[auth]` section（および template 参照）を linked hosted project へ適用
できるコマンドがあります。この runbook はそれを使いません。この
repository の `config.toml` は local dev stack 向けに書かれており
（`site_url = "http://127.0.0.1:3000"`、`[studio]` / `[local_smtp]` /
`[db]` の port 設定など local 専用の section を含む）、Gate A の hosted
project 向けではないため、blind な `config push` は誤った Site URL や他の
local 専用設定を Gate A project へ push してしまいます。上記の Dashboard
設定を手で materialize することが Gate A の accepted bounded choice です。
`config push` をここで安全に使えるようにするための remote 専用
`config.toml`（または他の config-as-code 手段）の構築は、この runbook の
scope 外です。project が再作成された場合は、これらの設定を手で re-apply
してください。

### Passkey / WebAuthn configuration（Supabase Dashboard → Authentication → Passkeys）

Issue #106 で Passkey（Supabase Auth WebAuthn, Beta）が Magic Link に追加
した primary sign-in path として決定済みです。app code
（`supabase/config.toml` の `[auth.passkey]` / `[auth.webauthn]`）は
local dev stack 向けの設定であり、上記の理由で `config push` を使わない
ため、remote project へは反映されません。これを手で materialize しない
限り、production 上の Passkey UI（サインイン・登録ボタン）はすべて失敗
します — 事前に必ず設定してください。

- **Passkeys → Enable passkeys**: 有効化します。
- **Relying Party Display Name**: `stage-tracker`（local と同一）。
- **Relying Party ID**: この project の canonical production domain の
  bare domain（scheme / port / path なし）。上記「URL Configuration →
  Site URL」と一致する domain を使います。
- **Relying Party Origins**: 上記 Site URL と同一の `https://` origin
  （最大 5 件まで登録可）。
- Passkey は登録時の Relying Party ID に暗号学的に紐づきます。**Relying
  Party ID を後から変更すると、既存の登録済み Passkey はすべて sign-in に
  使えなくなります**（Magic Link は影響を受けません — fallback として
  引き続き機能します）。production domain が未確定のまま Passkey 機能を
  有効化しないでください。
- 採用可否・maturity・test automation boundary の詳細は
  [Issue #106 の Phase 1 checkpoint コメント](https://github.com/reitojike/stage-tracker/issues/106)
  を参照してください。

## Deploy / update

Vercel は project が接続済み（上記手順 1）であれば、push のたびに `main`
を auto-deploy します。個別の manual deploy ステップはありません。
migration の適用順序は、その変更が既に deploy 済みの build と
backward-compatible かどうかで決まります。

- **新しい migration がない、または backward-compatible な migration**
  （新規 nullable column、まだ何も参照していない新規 table/RPC 等）:
  merge して Vercel に deploy させ、その後 hosted project に対して schema
  migration の手順を実行します。既に deploy 済みの build は新しい shape に
  依存しないため、一時的に古い schema に対して serve しても安全です。
- **新しい build が即座に必要とする migration**（新しいコードが実行直後に
  read/write する column/table/RPC）: schema migration の手順を merge /
  deploy の**前**に hosted project へ適用します。先に新しい build を
  deploy すると、まだ必要なものが揃っていない schema を参照することに
  なり、そのパスに触れるすべての request が migration が着地するまで
  失敗します。

いずれの場合も、`main` へ merge し（通常の PR フロー、Foundation v0.3.0
Review Protocol）、その commit の Vercel deployment が成功して production
URL が新しい build を serve していることを確認し、該当するケースが求める
タイミングで上記の schema migration 手順を実行します。

## Account provisioning（2 dogfood accounts）

operator shell から、remote service role key をこのコマンドの実行時だけ
export して実行します。

```bash
STAGE_TRACKER_REMOTE_SUPABASE_URL=https://<project-ref>.supabase.co \
STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/provision-user.mjs <email> --remote
```

2 名の dogfood account それぞれについて一度ずつ実行します。これは account
の作成のみを行います（`email_confirm: true`、password なし）— sign-in は
その後常に `/sign-in` での通常の magic-link flow です。

## Catalog creator grant / revoke

同じ remote-target pattern です。

```bash
STAGE_TRACKER_REMOTE_SUPABASE_URL=https://<project-ref>.supabase.co \
STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/grant-catalog-creator.mjs <email> grant --remote
```

membership を外す場合は `grant` の代わりに `revoke` を渡します。両方の
script とも `--remote` を省略すると local dev stack が既定になります —
remote は常に明示的な opt-in であり、既定の target にはなりません。

## 2-user cross-account smoke

正確な checklist は Issue #61 の「2-user remote smoke / acceptance」
（項目 1–12）を参照してください。結果は `A` / `B` で記録し、実際の email
は記載しません。項目 1–11 は Issue #34（My Calendar）が merge される前に
実施できます。項目 12（cross-user My Calendar smoke）は Gate A final
acceptance の一部であり、この Issue 自身の merge-ready fence には含まれ
ません。

## Known operational limits

- Supabase Free plan は低 activity が続くと project を pause します。これは
  Gate A の accepted limitation であり、この runbook は keepalive job で
  それを回避しません。実害が出た場合は、pause を回避する automation を
  追加するのではなく Pro upgrade を再評価してください。
- 2-user dogfood の利用量が Resend の有効な plan の送信上限に達する場合は
  上限を確認してください。SMTP provider を場当たり的に切り替えるのでは
  なく plan を再評価してください。
