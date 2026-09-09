# Production ランタイム構成

Canonical context: Issue #66。このドキュメントは新しいアーキテクチャの設計では
なく、現時点で実際に構築・運用されている実環境の記録です。実装の source of
truth は依然としてこのリポジトリ（migrations / route handler / config.toml）
であり、Dashboard 上の手動設定はここに記録した範囲でのみ効力を持ちます。

関連する既存ドキュメント:

- [docs/runbooks/gate-a-remote-environment.md](../runbooks/gate-a-remote-environment.md)
  — Gate A（2 ユーザー dogfood）環境の provisioning 手順書。本ドキュメントとの
  差分は「Local / CI / Remote 環境との差分」節と「既知の記載ずれ」節を参照。
- [docs/architecture/authentication.md](authentication.md) — Magic Link
  認証フローの詳細。

## 利用サービス一覧と責務

| サービス       | 責務                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Vercel**     | Next.js アプリケーションのホスティング、Production domain routing、Environment Variables の配布      |
| **Cloudflare** | `stage-tracker.com` の Registrar（ドメイン取得）と DNS 管理、Resend 送信用の SPF/DKIM/DMARC レコード |
| **Supabase**   | Authentication（Magic Link / Passkey）、Postgres Database、RLS by migration                          |
| **Resend**     | Supabase Auth のメール配送用 SMTP provider                                                           |
| **GitHub**     | Source control、Issue/PR ワークフロー、CI（`verify.yml`）                                            |

## Production 構成図

```mermaid
flowchart LR
    subgraph User["ブラウザ"]
        Browser
    end

    subgraph CF["Cloudflare"]
        DNS["DNS\n(stage-tracker.com\nSPF/DKIM/DMARC)"]
    end

    subgraph Vercel["Vercel (Hobby plan)"]
        App["Next.js 16 App Router\n(main ブランチを auto-deploy)"]
    end

    subgraph Supabase["Supabase (hosted project)"]
        Auth["Auth\n(Magic Link / GoTrue)"]
        DB["Postgres + RLS"]
    end

    Resend["Resend\n(SMTP provider)"]

    Browser -->|"https://stage-tracker.com"| DNS
    DNS -->|CNAME/A| App
    App -->|"NEXT_PUBLIC_SUPABASE_URL\nNEXT_PUBLIC_SUPABASE_ANON_KEY"| Auth
    App --> DB
    Auth -->|"custom SMTP"| Resend
    Resend -->|"magic link mail"| Browser
    Auth -. RLS 適用 .-> DB
```

- `stage-tracker.com`（サブドメインではなくルートドメイン）が Vercel の
  Production domain です。Cloudflare 側でこのドメインを取得・DNS 管理し、
  Vercel プロジェクトへ向けています。
- GitHub Actions（`verify.yml` / `claude-review.yml`）は Production の
  deploy パイプラインには関与しません。Vercel が `main` への push を検知して
  auto-deploy する構成であり、CI は「PR の merge 前検証」の役割に閉じています
  （詳細は「デプロイ・実行経路」節）。
- `.github/workflows/apply-migrations.yml`（Issue #387、PO 判断 D1 = D）は
  `main` への push を検知して Production migration を自動適用しますが、これも
  deploy パイプラインではありません。deploy を起動も抑止もせず、Vercel の
  auto-deploy とは独立に動きます（詳細は「migration pre-merge ordering
  fence」節）。

## デプロイ・実行経路

1. PR が `main` へ merge される（Foundation Review Protocol に従う通常の PR
   フロー）。
2. Vercel がその push を検知し、Production ビルドを自動実行・デプロイします。
   Vercel 側の deploy を起動する専用の GitHub Actions ステップは存在しません
   （`vercel.json` もリポジトリに存在せず、Vercel プロジェクト側の連携設定に
   委ねられています）。
3. スキーマ変更を伴う PR の場合、`main` への push を検知した
   `.github/workflows/apply-migrations.yml`（Issue #387、PO 判断 D1 = D）が
   `supabase db push` を自動実行し、Supabase 側へ migration を適用します。
   operator が手元で `supabase login` / `supabase link` / `db push` を実行する
   運用は不要になりました（旧運用は「Local / CI / Remote 環境との差分」参照）。
   - migration が後方互換（新規 nullable column 等、既存コードが未参照）で
     あれば、Vercel デプロイ後に適用されても安全です。下記の ordering fence
     ではこれを `post-deploy-safe` と呼びます。
   - 新しいビルドが直ちに参照する migration の場合でも、この workflow は
     デプロイの前後を保証しません（deploy には一切関与しないため）。この
     ordering fence ではこれを `schema-first-required` と呼び、そのケースは
     引き続き migration PR と app code PR を分離し、migration PR を先に
     merge・適用してから app code PR を merge する運用で担保します。
     Artifact Sequencing Fence（`scripts/lib/artifactSequencingFence.mjs`）が
     migration と app code の同一 PR 同居を拒否しているのはこのためです。

`docs/runbooks/gate-a-remote-environment.md` の「Deploy / update」節が、この
判断基準の canonical な記述です。

### migration pre-merge ordering fence（Issue #131）

Issue #121 / #124 / #125 は、上記の判断（`schema-first-required` /
`post-deploy-safe`）自体は正しく認識されていたにもかかわらず、3 件連続で
Production migration 適用が Vercel デプロイより後回しになった（詳細は
Issue #131 の Context 参照）。human memory だけに依存した手順では
recurring failure になったため、次の 2 段構えの deterministic fence を
追加した。

1. **CI merge-fence（`Verify / Migration Ordering Fence` job、
   `.github/workflows/verify.yml`）**:
   `scripts/check-migration-ordering-fence.mjs`。`supabase/migrations/**.sql`
   を追加する PR は、PR 本文に次のどちらかの marker が無ければ fail する。

   ```text
   Migration ordering: schema-first-required
   Migration ordering: post-deploy-safe
   ```

   `schema-first-required` の場合はさらに次の marker も必須とする（テンプ
   レートは `.github/pull_request_template.md` を参照）。

   ```text
   Production migration applied: <evidence>
   ```

   この job は Production 認証情報を一切必要としない（PR 本文と `git
diff` だけを見る）。そのため、実際に Production へ migration が適用
   されたかどうかは検証できない — 検証できるのは「その判断が PR
   evidence として記録されているか」だけである。**Issue #131 当時は、この
   repository の Secret boundary に従い Production 認証情報を CI secret として
   追加することを意図的に避けていた。** Issue #387（PO 判断 D1 = D）でこの
   前提を明示的に変更し、`SUPABASE_DB_URL`（`--db-url` 用の接続文字列に限定、
   Personal Access Token や service-role key ではない）を下記 3 の workflow
   専用の CI secret として追加した。この job（`Verify / Migration Ordering
Fence`）自体は変更しておらず、`schema-first-required` の運用（migration PR
   と app code PR を分離し、migration PR を先に merge する）は依然として
   このマーカーと Artifact Sequencing Fence が担う。

2. **operator-facing read-only drift check
   （`scripts/check-migration-drift.mjs`）**: `supabase migration list
--linked` を wrap し、repository の migration file と Production へ
   適用済みの migration を比較する。

   ```text
   pnpm run supabase:migrations:drift -- --linked
   ```

   pending（repository にはあるが Production 未適用）・unexpected
   remote-only（Production にはあるが repository に対応 file がない）の
   いずれかがあれば non-zero で fail する。認証・接続に失敗した場合も
   synced とはみなさず、`UNKNOWN`（exit code 2）として fail する — この
   スクリプト自体は CI からは実行しない、operator が
   `supabase link --project-ref <ref>` 済みの shell から明示的に実行する
   コマンドである（`docs/runbooks/gate-a-remote-environment.md`
   「Deploy / update」参照）。下記 3 の自動適用 workflow は、この
   operator-facing スクリプトを呼ばず、`scripts/lib/migrationDrift.mjs` を
   共有しつつ別経路（`scripts/apply-pending-migrations.mjs`）で同じ
   classify を行う。

3. **Production migration の自動適用（`.github/workflows/apply-migrations.yml`、
   Issue #387、PO 判断 D1 = D）**: `main` への push（および
   `workflow_dispatch`）を検知し、`scripts/apply-pending-migrations.mjs` が
   `supabase migration list --db-url` → 分類 → `supabase db push --db-url
--include-all --skip-vault --yes` を実行する。`SUPABASE_DB_URL` は
   `production` environment の Environment secret で、Deployment branches が
   `main` に限定される（`docs/runbooks/v2-migration-apply-setup.md`）。
   pending 以外（remote-only / unknown）を検知した場合は書き込まずに stop
   し、適用後も同じ classify 経路で `skip` を再確認する（詳細は runbook と
   `docs/v2/decisions.md` の A8 追補）。deploy の起動・抑止には一切関与せず、
   Vercel の Git auto-deploy とは独立に動く。

## Environment Variables の所有境界

| 変数                                                                          | 所有者 / 設定場所                                                                         | 用途                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                    | Vercel Production / Preview Environment Variables                                         | ブラウザ/サーバー双方で読まれる公開値（[src/infrastructure/supabase/env.ts](../../src/infrastructure/supabase/env.ts)）                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                               | Vercel Production / Preview Environment Variables                                         | 同上。anon key であり service role key ではない                                                                                                                               |
| Supabase Auth SMTP 資格情報（Resend）                                         | Supabase Dashboard → Authentication → SMTP Settings                                       | アプリコードにもVercelにも存在しない。Dashboard にのみ入力                                                                                                                    |
| `STAGE_TRACKER_REMOTE_SUPABASE_URL` / `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY` | オペレーターの shell（コマンド実行時のみ export）                                         | `scripts/provision-user.mjs` / `scripts/grant-catalog-creator.mjs` からの remote 操作専用。恒久的な保存場所を持たない                                                         |
| `SUPABASE_DB_URL`                                                             | GitHub `production` environment の Environment secret（Deployment branches: `main` のみ） | `.github/workflows/apply-migrations.yml` 専用。Postgres 接続文字列で `--db-url` の到達範囲はその 1 データベースに限られる。Personal Access Token や service-role key ではない |

- `NEXT_PUBLIC_*` プレフィックスの 2 変数だけが、実際にデプロイされたアプリへ
  Supabase client 値として渡る変数です
  （[src/infrastructure/supabase/env.ts](../../src/infrastructure/supabase/env.ts)）。
  どちらも public であることを前提に設計されています。
- Supabase の **service role key は Vercel には一切設定されません**。
  リポジトリにもコミットされません。管理系スクリプトを手元 shell から
  `--remote` フラグ付きで実行する、その一回限りの実行時にのみ環境変数として
  与えられます。
- Resend の API キー / SMTP 資格情報は Supabase Dashboard の Auth → SMTP
  設定にのみ存在し、このリポジトリにもVercelにも存在しません。

## Vercel Preview Auth runtime contract（Issue #268）

- Vercel Project Settings の Preview scope には
  `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定します。
  どちらも public runtime value であり、Preview に service-role key は設定
  しません。
- Next.js Framework Preset が提供する Framework Environment Variables
  `NEXT_PUBLIC_VERCEL_ENV`、`NEXT_PUBLIC_VERCEL_BRANCH_URL`、
  `NEXT_PUBLIC_VERCEL_URL`を使用します。Previewでは branch URLを優先し、無い
  場合だけ generated deployment URLへfallbackします。legacy raw
  `VERCEL_ENV` / `VERCEL_URL` のためにSystem Environment Variables exposureを
  手動で要求しません。
- [docs/architecture/authentication.md](authentication.md) の実装は、
  `NEXT_PUBLIC_VERCEL_ENV === "preview"` と trusted host が揃った場合だけ
  `https://<trusted-host>/` を Magic Link の `emailRedirectTo` にします。trailing
  slashはSupabaseのVercel wildcard `https://*-reitojike.vercel.app/**` とcallback
  pathの連結に合わせたcanonical形式です。GoTrueがredirect未指定時にSite URLを
  `.RedirectTo`へfallbackするため、templateは `.RedirectTo` が `.SiteURL` と異なる
  明示targetのときだけ使い、そこへ直接 `auth/confirm`を連結します。double slashを
  作りません。
  `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL` はPreview redirectへ使いません。
  Production / local では explicit target を渡さず、Supabase Site URL fallback
  を維持します。request `Host` / `X-Forwarded-Host` や user input は authority
  になりません。
- hosted Supabase Auth の Site URL は `https://stage-tracker.com` のままです。
  Redirect URLs には current Vercel account slug に bounded な
  `https://*-reitojike.vercel.app/**` を追加し、hosted Magic Link template は
  `.RedirectTo` 条件分岐と `.SiteURL` fallback を repository template と同期
  します。Previewごとのexact Redirect URLはsteady stateでは不要です。
- Preview と Production が同じ hosted Supabase を共有する場合、Preview の
  write は real remote dogfood data に反映され得ます。remote Dashboard 設定と
  メール受信を含む materialization は operator-owned で、agent が未確認の設定を
  configured と報告してはいけません。
- このFramework Environment Variables契約は、PR #269のPreview smokeでraw
  `VERCEL_ENV` / `VERCEL_URL`前提がProduction fallbackを起こしたため採用しました。
- 同じsmokeではbare Preview originがwildcard-onlyで受理されず、`Site URL`へfallback
  しました。bare Preview exact URLを一時追加した後はPreview authが成功したため、
  このPRではtrailing slash付きoriginへreconcileし、exact URLを削除した状態で
  wildcard-only smokeを再実施します。

## Local / CI / Remote 環境との差分

| 項目                | Local dev                                         | CI（`verify.yml`）                             | Production (Remote)                                                    |
| ------------------- | ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Supabase            | ローカル Docker スタック（`supabase start`）      | ローカル Docker スタック（同上、CI 内で起動）  | 新規作成した hosted Supabase project                                   |
| `site_url`          | `http://localhost:3000`（`supabase/config.toml`） | 同左                                           | `https://stage-tracker.com`（Dashboard で個別設定）                    |
| SMTP                | `[local_smtp]`（実送信せず Web UI で確認のみ）    | 同左                                           | Resend（Supabase Dashboard の Auth SMTP 設定）                         |
| Auth 設定の適用方法 | `supabase/config.toml` を直接読む                 | 同左                                           | **`supabase config push` は使わない**。Dashboard へ手動反映            |
| migration 適用      | `supabase db reset` / CLI が自動適用              | CI 内で自動適用                                | `main` push を検知した `apply-migrations.yml` が自動適用（Issue #387） |
| Env vars            | `.env.local`（`.env.local.example` を複製）       | 不要（ローカル Docker スタックの既定値を使用） | Vercel Production Environment Variables                                |

### なぜ `supabase config push` を remote へ使わないか

`supabase/config.toml` はローカル開発スタック向けに書かれています
（`site_url = "http://localhost:3000"`、`[studio]` / `[local_smtp]` / `[db]`
のポート設定などローカル専用のセクションを含む）。これをそのまま
`config push` で remote project へ適用すると、意図しない Site URL や
ローカル専用設定を Production へ書き込んでしまうリスクがあります。

そのため、Production の Auth 関連設定（Site URL、Redirect URLs、Email
Templates など）は Supabase Dashboard 上で手動反映する運用としています。
remote 専用の `config.toml`（または別の config-as-code 手段）を用意して
`config push` を安全に使えるようにすることは、将来の改善候補として
「将来的な改善領域」節に記録します。

## 既知の記載ずれ（解消済み・履歴記録）

Issue #66 完了時点では以下 2 件の記載ずれが未解消として記録されていました。
Issue #61 の docs consistency 対応で両方とも解消済みです。履歴として残します。

- `docs/runbooks/gate-a-remote-environment.md` は当初 SMTP provider を
  Postmark と記載していましたが、実際に Production で稼働している SMTP
  provider は Resend であり、runbook 側を Resend 向けに書き換え済みです。
  runbook 冒頭に「Gate A の bounded provider decision は当初 Postmark
  Developer だったが、実際の Production 運用では Resend に変更された」
  という履歴注記を残しています。
- `src/infrastructure/supabase/serverClient.ts` の該当コメントは
  `middleware.ts` という古い呼称を使っていましたが、`proxy.ts` を指すよう
  修正済みです。

## 将来的な改善領域

- **Remote Supabase config materialization**: 現在 Dashboard への手動反映に
  依存している Auth 設定（Site URL、Redirect URLs、Email Templates、
  signup 無効化設定）を、config-as-code で管理し drift を検知できる仕組みに
  すること。
- **Drift 検知の継続的自動化**: Issue #131 で `pnpm run
supabase:migrations:drift -- --linked` という operator-facing の
  on-demand deterministic command は追加したが（上記「migration
  pre-merge ordering fence」参照）、これは手動実行が前提であり、
  スケジュール実行等による継続的な自動検知ではない。Issue #387（PO 判断
  D1 = D）で「CI へ Production 認証情報を持たせるか」という trade-off 自体は
  `main` push 契機の自動適用（上記「migration pre-merge ordering fence」3）
  として決着し、`SUPABASE_DB_URL` を到達範囲の狭い（`--db-url` のみ、
  Personal Access Token ではない）CI secret として導入した。ただしこれは
  push 契機の apply であり、独立したスケジュール実行による continuous drift
  detection ではない。両者を同一視しない。
