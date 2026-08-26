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

## デプロイ・実行経路

1. PR が `main` へ merge される（Foundation Review Protocol に従う通常の PR
   フロー）。
2. Vercel がその push を検知し、Production ビルドを自動実行・デプロイします。
   Vercel 側の deploy を起動する専用の GitHub Actions ステップは存在しません
   （`vercel.json` もリポジトリに存在せず、Vercel プロジェクト側の連携設定に
   委ねられています）。
3. スキーマ変更を伴う PR の場合、`supabase db push` による Supabase 側への
   migration 適用は **自動化されていません**。オペレーターが手動で実行する
   運用です（理由は「Local / CI / Remote 環境との差分」を参照）。
   - migration が後方互換（新規 nullable column 等、既存コードが未参照）で
     あれば、Vercel デプロイ後に migration を適用しても安全です。
   - 新しいビルドが直ちに参照する migration であれば、デプロイより先に
     migration を Supabase 側へ適用する必要があります。

`docs/runbooks/gate-a-remote-environment.md` の「Deploy / update」節が、この
判断基準の canonical な記述です。

## Environment Variables の所有境界

| 変数                                                                          | 所有者 / 設定場所                                   | 用途                                                                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                    | Vercel Production Environment Variables             | ブラウザ/サーバー双方で読まれる公開値（[src/infrastructure/supabase/env.ts](../../src/infrastructure/supabase/env.ts)） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                               | Vercel Production Environment Variables             | 同上。anon key であり service role key ではない                                                                         |
| Supabase Auth SMTP 資格情報（Resend）                                         | Supabase Dashboard → Authentication → SMTP Settings | アプリコードにもVercelにも存在しない。Dashboard にのみ入力                                                              |
| `STAGE_TRACKER_REMOTE_SUPABASE_URL` / `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY` | オペレーターの shell（コマンド実行時のみ export）   | `scripts/provision-user.mjs` / `scripts/grant-catalog-creator.mjs` からの remote 操作専用。恒久的な保存場所を持たない   |

- `NEXT_PUBLIC_*` プレフィックスの 2 変数だけが、実際にデプロイされたアプリへ
  渡る唯一の Environment Variables です
  （[src/infrastructure/supabase/env.ts](../../src/infrastructure/supabase/env.ts)）。
  どちらも public であることを前提に設計されています。
- Supabase の **service role key は Vercel には一切設定されません**。
  リポジトリにもコミットされません。管理系スクリプトを手元 shell から
  `--remote` フラグ付きで実行する、その一回限りの実行時にのみ環境変数として
  与えられます。
- Resend の API キー / SMTP 資格情報は Supabase Dashboard の Auth → SMTP
  設定にのみ存在し、このリポジトリにもVercelにも存在しません。

## Local / CI / Remote 環境との差分

| 項目                | Local dev                                         | CI（`verify.yml`）                             | Production (Remote)                                         |
| ------------------- | ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Supabase            | ローカル Docker スタック（`supabase start`）      | ローカル Docker スタック（同上、CI 内で起動）  | 新規作成した hosted Supabase project                        |
| `site_url`          | `http://127.0.0.1:3000`（`supabase/config.toml`） | 同左                                           | `https://stage-tracker.com`（Dashboard で個別設定）         |
| SMTP                | `[local_smtp]`（実送信せず Web UI で確認のみ）    | 同左                                           | Resend（Supabase Dashboard の Auth SMTP 設定）              |
| Auth 設定の適用方法 | `supabase/config.toml` を直接読む                 | 同左                                           | **`supabase config push` は使わない**。Dashboard へ手動反映 |
| migration 適用      | `supabase db reset` / CLI が自動適用              | CI 内で自動適用                                | `supabase db push` をオペレーターが手動実行                 |
| Env vars            | `.env.local`（`.env.local.example` を複製）       | 不要（ローカル Docker スタックの既定値を使用） | Vercel Production Environment Variables                     |

### なぜ `supabase config push` を remote へ使わないか

`supabase/config.toml` はローカル開発スタック向けに書かれています
（`site_url = "http://127.0.0.1:3000"`、`[studio]` / `[local_smtp]` / `[db]`
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
- **Drift 検知**: `supabase db diff --linked` は手動実行が前提であり、
  スキーマ drift を継続的に検知する自動化は存在しません。
