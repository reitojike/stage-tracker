# v2 並走検証 harness runbook

Canonical Task Contract: Issue #391（v2 M8: legacy と並走検証し、差分を分類しきる）
の「着手できる単位」2 のうち、local 並走 harness を対象とします。

Issue #391 の Decisions/Invariants により、**並走環境は Production-class**
として扱います。並走に使うデータは実データであり、v2 側の write は legacy
利用者へそのまま影響します。「検証中だから壊れてよい」環境ではありません。

## 前提

`apps/web`（v2）と `apps/legacy-web` は**同一 Supabase project / 同一
スキーマ**を共有します（`docs/v2/README.md`）。そのため単一の local Supabase
に対して両アプリを同時起動すれば、この前提はそのまま満たされます。別々の
Supabase インスタンスを用意する必要はありません。

- `pnpm run db:start`（ローカル Supabase スタックが起動済みであること。
  Docker が必要）

## Port 割り当て

`next dev` は既定で両アプリとも port 3000 を使うため、そのままでは同時起動
できません。次のとおり分けます（Storybook の既存の割り当て方針
`legacy-web=6006` / `web=6007` に倣う）。

| アプリ            | port   |
| ----------------- | ------ |
| `apps/legacy-web` | `3000` |
| `apps/web`        | `3001` |

`apps/web` の `dev` script はこの port を固定で使います
（`apps/web/package.json`）。`apps/legacy-web` は既定のまま変更していません。

`supabase/config.toml` の `additional_redirect_urls` と
`[auth.webauthn] rp_origins` に `http://localhost:3001` を追加済みです。
passkey は実際のリクエストの Origin を `rp_origins` と照合するため、これで
port 3001 からの passkey 認証も許可されます。Magic Link は下記「Auth
session の扱い」節の制約が別途あります。

## Env の用意

各アプリは**別々の** env file を読みます。`next dev` は起動時の cwd
（= turbo/pnpm がそのパッケージを実行するディレクトリ）を基準に
`.env.local` を探すため、repository root の `.env.local` は
`apps/legacy-web` からは読まれません（実測で確認済み: root にのみ置いた
場合 `next dev` の起動ログに `- Environments: .env.local` が出ず、
`apps/legacy-web/.env.local` に置いた場合だけ出る）。前提: 単一の local
Supabase から `supabase status -o json` で得た**同じ値**を両方へ書き込みます。

- `apps/legacy-web` → `apps/legacy-web/.env.local`（新規作成。repository
  root の `.env.local.example` は `next dev` 自体が読む場所ではないため、
  その中身と同じ 2 変数を `apps/legacy-web/.env.local` として作成する）
- `apps/web` → `apps/web/.env.local`（`apps/web/.env.example` を複製）

```bash
supabase status -o json
# api_url / anon_key を両方の .env.local へ書き写す
```

## 起動

```bash
pnpm run dev:parallel
```

内部では `turbo run dev --filter=@stage-tracker/web
--filter=@stage-tracker/legacy-web` を実行し、2 つの `next dev` を同一
プロセスグループで並行起動します（`turbo.json` の `dev` task は
`persistent: true` / `cache: false`）。個別に 2 つの terminal で
`pnpm --filter @stage-tracker/legacy-web run dev` /
`pnpm --filter @stage-tracker/web run dev` を分けて起動しても構いません
（ログを分けて見たい場合はこちらが読みやすいです）。

- legacy: <http://localhost:3000>
- v2: <http://localhost:3001>

停止は通常の `Ctrl+C`（`turbo run dev` はターミナルの中断シグナルを子
プロセスへ伝播します）。

## Auth session の扱い

Supabase Auth の session cookie は `localhost` を domain とし、port を
区別しません。そのため port 3000 で sign-in すれば、同じブラウザで
port 3001 を開いた時点で既に同じ session が有効です（同一 project /
同一 cookie のため）。これは並走比較が前提とする「同一 Auth identity」を
自然に満たします。**sign-in は legacy（port 3000）側で行ってください。**
別々に sign-in し直す必要はありません。

v2（`apps/web`）側の Magic Link 送信 UI からも sign-in を試すこと自体は
できますが、**local 環境ではリンクの着地先が port 3001 にはなりません。**
`apps/web/src/app/sign-in/actions.ts` の `requestSignInLink` は、環境を
問わず（Preview も含め）`emailRedirectTo` を一切渡さない実装です
（PO 判断: Free 運用中は remote Preview Supabase を持たず、Vercel Preview
で authenticated flow を提供しない。同 file のコメント参照）。そのため
GoTrue は常に `site_url`（`http://localhost:3000`、legacy 側）へ
fallback します。つまり v2 から送った Magic Link を踏んでも legacy 側の
`/auth/confirm` へ着地します。session 自体は cookie 経由で両 port に共有
されるため並走比較は成立しますが、「v2 自身の sign-in 画面〜callback まで」
を local で検証したい場合はこの制約を踏まえてください。

## この runbook が検証済みのこと / 未検証のこと

- **検証済み**: 上記の port 割り当てで両アプリが同時に `next dev` として
  起動し、それぞれ port 3000 / 3001 で応答すること（agent sandbox 内、
  Docker 無しの env-validation-skip 状態で確認。`SKIP_ENV_VALIDATION=1`
  でも port 衝突なく両方 `Ready` になり、両方とも HTTP 応答を返した）。
- **未検証（operator 側で Docker 環境から確認が必要）**: 実際に local
  Supabase を起動した状態での、実データを使った並走比較そのもの
  （同一データが両方から見えること、Auth session が port を跨いで共有
  されること）。この agent sandbox には Docker が無く、`supabase start`
  を実行できないため、ここでは検証していません。

## Out of Scope

- 自動 diff harness / スクリーンショット比較基盤（Issue #391 で明示的に
  Out of Scope。差分の判断には oracle の解釈が要るため機械比較で代替
  できない）
- 主要 user journey ごとの並走比較そのもの（Issue #391 の別の作業単位）
