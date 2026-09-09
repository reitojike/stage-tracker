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
これが無いと、v2 側（port 3001）から開始した Magic Link / passkey 認証が
`site_url`（port 3000）にしか redirect を許可されず失敗します。

## Env の用意

各アプリは別々の env file を読みます（前提: 単一の local Supabase から
`supabase status -o json` で得た**同じ値**を両方へ書き込みます）。

- `apps/legacy-web` → repository root の `.env.local`
  （`.env.local.example` を複製）
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
自然に満たします。別々に sign-in し直す必要はありません。

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
