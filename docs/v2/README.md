# stage-tracker v2

現行 stage-tracker を段階的に置き換える greenfield 実装の計画と決定記録。

## 方針

同一リポジトリ内で v2 を新規構築し、現行実装を `apps/legacy-web` として
移行期間だけ並走させる。product semantics / データ / Auth identity /
GitHub history を引き継ぎ、implementation は白紙から作り直す。

現行コードは **移植元ではなく oracle**（正しい振る舞いを確認する対象）
として扱う。`docs/v2/oracle-*.md` がその仕様化であり、v2 実装者は
oracle ドキュメントだけを見て再実装する。

## 引き継ぐもの / 捨てるもの

| 引き継ぐ | 捨てる |
|---|---|
| product semantics | UI implementation |
| DB / RLS semantics | CSS Modules design system |
| データと Auth identity | FormData 手続き的パース |
| source key（import 冪等性） | test infrastructure / browser harness |
| GitHub history / Issue | deployment plumbing（手動 migration fence） |
| design intent | Foundation skill packaging |

## Target stack

| 領域 | 採用 |
|---|---|
| Web | Next.js 16 + React 19 + TypeScript |
| Package | pnpm workspace + Turborepo |
| DB / Auth | Supabase Postgres + Auth + RLS（ORM は使わない） |
| UI | Tailwind CSS v4 + shadcn/ui + Base UI |
| Design token | Tailwind `@theme` semantic token |
| Validation | Zod |
| Server Action | next-safe-action + Zod |
| env | T3 Env + Zod |
| Unit / integration | Vitest |
| Component | Storybook |
| API mock | MSW |
| E2E / visual | Playwright Test |
| DB / RLS test | pgTAP |
| Background job | Trigger.dev |
| Mail | React Email + Resend |
| Observability | Sentry + PostHog |
| Deploy | GitHub Actions が Supabase migration → Vercel deploy を単一 pipeline で実行 |

Supabase を SQL migration + RLS + generated types のまま維持するのは意図的な選択。
現行の設計上の強みであり、ORM へ寄せる理由がない。

## 目標ディレクトリ構成

```
apps/
  web/            v2 本体
  legacy-web/     移行期間のみ。完了後に削除
packages/
  domain/         Zod schema / pure logic
  ui/             design token + shadcn ベースの共有 UI
  config/         TS / lint 共有設定
  test-support/   MSW handler / factory
supabase/         migrations / pgTAP（共有）
```

## Milestone

| # | 内容 | 完了判定 |
|---|---|---|
| 0 | 現行仕様の oracle 抽出 | `docs/v2/oracle-*.md` |
| 1 | monorepo 化 + v2 scaffold | root がクリーン / build・lint・typecheck green |
| 2 | 基盤配線（Zod / T3 Env / next-safe-action / Vitest / MSW / Playwright / Storybook） | 各 runner が green |
| 3 | `packages/domain` 実装 | unit test 全通過 |
| 4 | DB layer 再構築（migration + RLS + pgTAP） | pgTAP green |
| 5 | UI 再構築 | Storybook + a11y |
| 6 | 画面統合 + E2E | Playwright green |
| 7 | CI/CD 単一 release pipeline | dry-run 成功 |
| 8 | 並行検証 → cutover 判断 | 停止して報告 |
| 9 | legacy 削除 + 構成の最終化 | clean-repo equivalence check |

## 不変ルール（Milestone 1 以降、機械で強制する）

1. `apps/web` と `packages/*` は `apps/legacy-web` から **import してはならない**。
   legacy は実行して結果を比較する対象であり、コードの参照先ではない。
   ESLint / CI で強制する。
2. oracle ドキュメントに記載のない振る舞いを推測で実装しない。
   不明点は oracle を更新してから実装する。
3. Milestone 1 完了時点で、リポジトリ root に legacy 由来のファイルを残さない。
4. Milestone 9 の受け入れ条件は、ゼロから組んだ scaffold とのファイルツリー比較で
   legacy 由来の残骸がないこと。

## 未決事項

- `packages/*` が価値を出しているかを Milestone 8 で評価し、出していなければ
  `apps/web` を root へ引き上げて単一 app 構成へ戻す（monorepo は手段であって目的ではない）
- Supabase remote project は新規作成する。それまで CI/CD 層は未接続で実装のみ進める
- 外部 SaaS（Sentry / PostHog / Trigger.dev / Resend）は配線コードのみ用意し、
  key 未設定の状態で停止する
