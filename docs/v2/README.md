# stage-tracker 再構築記録

stage-tracker を greenfield 実装へ置き換えた計画と決定の記録です。M8 の
Production cutover は 2026-09-12 に closure を確認し、M9 で旧アプリを削除しました。
現在の application runtime は `apps/web` だけです。

## 方針

同一リポジトリ内で新実装を構築し、移行期間だけ旧実装と並走させました。
product semantics / データ / Auth identity / GitHub history を引き継ぎ、
implementation は白紙から作り直しています。

旧コードは **移植元ではなく oracle**（正しい振る舞いを確認する対象）として
扱いました。削除後も `docs/v2/oracle-*.md` と Issue / PR が移行判断の durable
evidence です。これらは current runtime の仕様ではなく、再構築時の履歴です。

## 引き継ぐもの / 捨てるもの

| 引き継ぐ                    | 捨てる                                      |
| --------------------------- | ------------------------------------------- |
| product semantics           | UI implementation                           |
| DB / RLS semantics          | CSS Modules design system                   |
| データと Auth identity      | FormData 手続き的パース                     |
| source key（import 冪等性） | test infrastructure / browser harness       |
| GitHub history / Issue      | deployment plumbing（手動 migration fence） |
| design intent               | Foundation skill packaging                  |

## Target stack

| 領域               | 採用                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Web                | Next.js 16 + React 19 + TypeScript                                                                            |
| Package            | pnpm workspace + Turborepo                                                                                    |
| DB / Auth          | Supabase Postgres + Auth + RLS（ORM は使わない）                                                              |
| UI                 | Tailwind CSS v4 + shadcn/ui + Base UI                                                                         |
| Design token       | Tailwind `@theme` semantic token                                                                              |
| Validation         | Zod                                                                                                           |
| Server Action      | next-safe-action + Zod                                                                                        |
| env                | T3 Env + Zod                                                                                                  |
| Unit / integration | Vitest                                                                                                        |
| Component          | Storybook                                                                                                     |
| API mock           | MSW                                                                                                           |
| E2E / visual       | Playwright Test                                                                                               |
| DB / RLS test      | pgTAP                                                                                                         |
| Background job     | Trigger.dev                                                                                                   |
| Mail               | React Email + Resend                                                                                          |
| Observability      | Sentry + PostHog                                                                                              |
| Deploy             | Vercel の Git auto-deploy を維持。migration と deploy を単一 pipeline で orchestrate しない（PO 判断 D1 = D） |

Supabase を SQL migration + RLS + generated types のまま維持するのは意図的な選択。
現行の設計上の強みであり、ORM へ寄せる理由がない。

## 目標ディレクトリ構成

```
apps/
  web/            application 本体
packages/
  domain/         Zod schema / pure logic
  ui/             design token + shadcn ベースの共有 UI
  config/         TS / lint 共有設定
  test-support/   MSW handler / factory
supabase/         migrations / pgTAP（共有）
```

## Milestone

| #   | 内容                                                                                | 完了判定                                       |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| 0   | 現行仕様の oracle 抽出                                                              | `docs/v2/oracle-*.md`                          |
| 1   | monorepo 化 + v2 scaffold                                                           | root がクリーン / build・lint・typecheck green |
| 2   | 基盤配線（Zod / T3 Env / next-safe-action / Vitest / MSW / Playwright / Storybook） | 各 runner が green                             |
| 3   | `packages/domain` 実装                                                              | unit test 全通過                               |
| 4   | DB layer 再構築（migration + RLS + pgTAP）                                          | pgTAP green                                    |
| 5   | UI 再構築                                                                           | Storybook + a11y                               |
| 6   | 画面統合 + E2E                                                                      | Playwright green                               |
| 7   | release contract（artifact sequencing fence / Preview 隔離）                        | fence が同居を拒否する                         |
| 8   | 並行検証 → cutover 判断                                                             | 完了（Issue #373 / #391）                      |
| 9   | legacy 削除 + 構成の最終化                                                          | 完了（legacy dependency audit + Verify）       |

## 再構築時の不変ルール

1. 移行中、`apps/web` と `packages/*` は旧アプリから import しない。M9 では
   directory の不存在と active tooling / config の legacy 非依存を
   `pnpm run legacy:check` で強制する。
2. oracle ドキュメントに記載のない振る舞いを推測で実装しない。
   不明点は oracle を更新してから実装する。
3. Operational asset は application package に所有させず、root の `scripts/` と
   `test/rls/` に置く。
4. 過去の path を引用する oracle / migration evidence は履歴として残せるが、
   runtime / scripts / tests / config の依存先にはしない。

## M9 の構成判断

`packages/domain` は I/O 非依存の product invariant と ticket timeline logic を、
`packages/ui` は application shell / navigation 等の UI primitive と dependency
direction を所有しており、いずれも `apps/web` から現に利用されています。単なる将来用の
空 package ではないため維持します。legacy dependency の全 inventory と解消結果は
`docs/v2/legacy-dependency-audit.md` を正本とします。
