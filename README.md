# stage-tracker

複数ジャンルのイベント参加に伴う情報（イベント情報・チケット入手情報・自分の
参加予定・予算/支出）を一箇所で管理するための authenticated multi-user
application です。product intentの詳細は [`docs/prd.md`](./docs/prd.md) を
参照してください。

`ai-dev-foundation` の consumer bootstrap baseline (PR A) と、shared event
catalog の最初の product slice (Issue #3 / PR B) です。

## Canonical docs

| Document                                                                       | 内容                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`docs/prd.md`](./docs/prd.md)                                                 | product intent / user problem / target user / domain concepts / scope         |
| [`docs/roadmap.md`](./docs/roadmap.md)                                         | productとして何をどの方向に成立させていくか（directional roadmap）            |
| [`docs/ux-ui.md`](./docs/ux-ui.md)                                             | global UX/UI principle・design token semantics・shared UI patternの正本       |
| [`.ai-dev-foundation/product-rules.md`](./.ai-dev-foundation/product-rules.md) | agentが実装時に守るcurrent-approved product/domain constraintsの正本          |
| [`AGENTS.md`](./AGENTS.md)                                                     | 開発ルール（Foundation policy + technology profile + product rules から生成） |

`AGENTS.md` / `.ai-dev-foundation/quality/` は
[reitojike/ai-dev-foundation](https://github.com/reitojike/ai-dev-foundation)
からの生成物であり、直接編集しません。product-specific constraintの追加・
変更は `.ai-dev-foundation/product-rules.md` を編集した上で Foundation sync
を行います。

## Setup

```bash
npm install
```

Foundation tooling を使う `foundation:sync` / `foundation:check` は、pinされた
SHA の `ai-dev-foundation` checkout を `FOUNDATION_CHECKOUT` 環境変数(既定値
`../ai-dev-foundation`)で参照します。pin されている SHA の single source of
truthは [`.ai-dev-foundation/foundation-pin.json`](./.ai-dev-foundation/foundation-pin.json)
です。`.github/workflows/verify.yml` もこのfileからSHAを読み取り、CI上の
Foundation checkoutをpinします。

### Local Supabase (Docker が必要)

`public.events` の migration / RLS / generated types / DB・RLS test は、
local-first の Supabase スタックに対して実行します。Docker が起動している
必要があります。

```bash
npm run db:start   # ローカル Supabase スタックを起動
npm run db:reset    # migrations だけを適用してDBを再構築
npm run db:stop     # 停止
```

## Component catalog

Shared UI primitiveの examples / states は Storybook で確認できます。

```bash
npm run storybook        # local起動 (http://localhost:6006)
npm run build-storybook  # static build (storybook-static/)
```

Storybookはrendered examples / states catalogであり、UI ruleの正本では
ありません。ruleの正本は [`docs/ux-ui.md`](./docs/ux-ui.md) です。

## Verify

```bash
npm run verify
```

local / agent向けのone-command full deterministic verificationです。内部では
責務ごとに分けた3つのcomposition scriptを順に実行します。GitHub Actions
(`.github/workflows/verify.yml`) 上でもこの3責務を `Verify / Code` /
`Verify / Build` / `Verify / Database` という独立jobへ分割しており、PR Checks
上でどの責務が failed したか個別に確認できます。

- `npm run verify:code` — `format:check` / `lint` / `typecheck` /
  `test:unit` / `foundation:check` (generated adapter と Foundation-managed
  quality profile のdrift 検知) / `agent-rules:check` /
  `supabase:migrations:check`。いずれも local Supabase runtimeを必要としない
  deterministic checkです。
- `npm run verify:build` — `build` / `build-storybook`（component catalogの
  static build。Storybookのruntime Node要件がrepoのNode baselineと非互換化
  する事態をCIで検知するためblocking checkに含めています）。
- `npm run verify:database` — local Supabaseを起動・resetした上で、generated
  database typesのexact drift check (`supabase:types:check`) とDB/RLS test
  (`test:rls`)・auth test (`test:auth`)、および`anon` / `authenticated` /
  `PUBLIC`への`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`残存privilegeを
  検知するclient-role table privilege guardrail (`client-role-privileges:check`)
  を実行します。remote Supabase projectやremote credentialsは不要です。
  Docker が起動していない場合、このステップで失敗します。`test:auth` の
  browser test は `playwright-core`（devDependency）で **system Google
  Chrome** を headless 起動します（Issue #277）。browser binary の
  download（`npx playwright install`）は行わないため、local では Google
  Chrome のインストール、または `CHROME_PATH` で明示した Chrome/Chromium
  binary が必要です（GitHub Actions の ubuntu-latest には preinstalled）。
  Chrome が見つからない場合のエラーには探索した path と上記の解決方法が
  含まれます。起動は
  `verify:database:start`（Database/RLS/Auth checksが使わないStudio/
  Realtime/Storage等のservice - `supabase:start --exclude`の対象 - を
  除いたもの）、checkは`verify:database:checks`として分けており、
  GitHub Actions (`Verify / Database` job) は同じ`verify:database:start`
  の後にresetを省く`verify:database:ci`を使います（Issue #209 -
  GitHub-hosted runnerは常にfreshなため、既存local Supabaseがdirtyな
  状態を引きずるlocal/agent実行と異なりresetが不要と実証済み）。

`verify:profile` は、Foundation v0.4.0のcanonical extension point命名
（`.ai-dev-foundation/quality/README.md` が定める `verify:profile:code` /
`verify:profile:database` の2分割）とは別の、stage-trackerが既存互換の
ため保持しているrepo-local aggregate scriptです（Issue #118当時に
`verify:profile`という単一名で導入し、Issue #134のrepinではIssue #134
本文の「v0.4.0 reference exampleへ機械的に置換せず、coverageを欠落
させない最小integrationにする」方針により、この既存script自体の
rename/分割は行っていません）。`agent-rules:check` /
`supabase:migrations:check` に続けて `verify:database`（DB起動・reset・
`supabase:types:check`・`test:rls`・`test:auth`・
`client-role-privileges:check`）を呼ぶ構成にしており、DB runtimeを
要する部分は`verify:database`を単一のsourceとして参照します（同じ手順を
2箇所へ独立にハードコードしないため）。stage-trackerのcurrent full
verificationは`verify:profile`を経由せず、`npm run verify`から
`verify:code`/`verify:build`/`verify:database`を直接呼びます。
`agent-rules:check` / `supabase:migrations:check`はDB runtime不要なので
`verify:code`側にも含めており、`verify:profile`とはこの2 checkの呼び出し
のみ重複します（Issue #118のlane境界: agent-rules/migrationはCode lane
に属しDatabase laneには含めないため、full `verify`内での二重実行には
なりません）。

profile固有checkを追加・変更する場合は、DB runtimeが不要なら
`verify:code`（および必要なら`verify:profile`）へ、DB runtimeが必要なら
`verify:database`へ追加してください。

RLS policy の guardrail proof (`test/rls/guardrail-proof.mjs`) は
`npm run test:rls:guardrail-proof` で手動実行します。実際に policy /
grant を一時的に壊してnegative testが red になることを確認し、必ず
restore する one-off の検証スクリプトであり、blocking verify には含めて
いません。
