# stage-tracker

複数ジャンルのイベント参加に伴う情報（イベント情報・チケット入手情報・自分の
参加予定・予算/支出）を一箇所で管理するための authenticated multi-user
application です。product intentの詳細は [`docs/prd.md`](./docs/prd.md) を
参照してください。

GitHub Spec Kit v1.0.6 の standard harness を使う、shared event catalog と
personal planning の authenticated multi-user application です。既存の
Foundation harness への runtime dependency は持ちません。

## Canonical docs

| Document                                                                       | 内容                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`docs/prd.md`](./docs/prd.md)                                                 | product intent / user problem / target user / domain concepts / scope   |
| [`docs/roadmap.md`](./docs/roadmap.md)                                         | productとして何をどの方向に成立させていくか（directional roadmap）      |
| [`docs/ux-ui.md`](./docs/ux-ui.md)                                             | global UX/UI principle・design token semantics・shared UI patternの正本 |
| [`docs/screens.md`](./docs/screens.md)                                         | 画面ごとの状態・権限分岐と実文言のdecisionの正本                        |
| [`.specify/`](./.specify/)                                                     | Spec Kit standard workflow / template / integration metadata            |
| [`.claude/skills/`](./.claude/skills/)                                         | Claude の Spec Kit standard integration                                 |
| [`.agents/skills/`](./.agents/skills/)                                         | Codex の Spec Kit standard integration                                  |
| [`specs/`](./specs/)                                                           | current product behavior の Living Spec（`specs/**/spec.md`）           |
| [`.ai-dev-foundation/product-rules.md`](./.ai-dev-foundation/product-rules.md) | 未移行 domain の temporary static product authority                     |

Foundation generated `AGENTS.md` / `CLAUDE.md`、Foundation Skills、reviewer
routing、pin、checkout、sync/check は post-cutover harness に含めません。
新しい product rule は対象 domain の Living Spec、または未移行 domain の
temporary static product rules に、その責務に応じて記録します。

## Setup

```bash
pnpm install
```

開発用の harness は Spec Kit standard surface（`.specify/`、標準の Codex /
Claude integration、`specs/**/spec.md`）です。Codex を default integration と
し、Claude も multi-install しています。Next.js の `agentRules: false` は、
Spec Kit が管理する guidance surface と Next.js の自動生成 root guidance が
競合しないよう、`apps/web/next.config.ts` の project-owned standard setting
として維持します。

Spec Kit の標準 helper scripts は、Codex の実行環境を限定しないよう、v1.0.6 の
first-party `--script py` variantで生成しています。生成されたSkillは`python3`
commandでhelperを呼ぶため、Spec Kit workflowを実行するときは`python3` commandで
Python 3を利用可能にしてください。repository側のlauncher wrapper、post-processing、
managed fileの手編集は追加しません。

Claude secondary integration利用時、Spec Kit shared prerequisite scriptがdefault
Codex syntaxの `$speckit-*` recovery commandを表示する場合は、対応するClaude
`/speckit-*` Skillを使用してください。これはSpec Kit v1.0.6のshared recovery
guidance limitationであり、managed filesはproject側でpatchしません。

Current behavior の authority は、Occurrence Participation については
[`specs/001-occurrence-participation/spec.md`](./specs/001-occurrence-participation/spec.md)
です。未移行 domain は temporary static product rules、architecture / runbook /
schema / migration / test はそれぞれの既存責務の文書・コードを参照します。

Issue #487 は既存 behavior の authority cutover と initial bootstrap です。
新規 feature の implementation plan を必要とする Task ではないため、Participation
spec に `plan.md` / `tasks.md` は付けていません。通常の Wave 4 feature / bug fix /
DB migration では Spec Kit standard plan/tasks workflow を実作業で評価し、不要な
artifactだけを意図的に省略します。Issue が存在すること自体を省略理由にはしません。

### Local Supabase (Docker が必要)

`public.events` の migration / RLS / generated types / DB・RLS test は、
local-first の Supabase スタックに対して実行します。Docker が起動している
必要があります。

```bash
pnpm run db:start   # ローカル Supabase スタックを起動
pnpm run db:reset    # migrations だけを適用してDBを再構築
pnpm run db:stop     # 停止
```

## Component catalog

Shared UI primitiveの examples / states は Storybook で確認できます。

```bash
pnpm --filter @stage-tracker/web run storybook         # http://localhost:6007

# workspace の static build
pnpm run build-storybook
```

Storybookはrendered examples / states catalogであり、UI ruleの正本では
ありません。ruleの正本は [`docs/ux-ui.md`](./docs/ux-ui.md) です。

## Verify

```bash
pnpm run verify
```

local / agent向けのone-command full deterministic verificationです。内部では
責務ごとに分けた3つのcomposition scriptを順に実行します。GitHub Actions
(`.github/workflows/verify.yml`) 上でもこの3責務を `Verify / Code` /
`Verify / Build` / `Verify / Database` という独立jobへ分割しており、
`Verify / Database` は `Start local Supabase` / `Verify / DB checks` のnamed
stepに分けています。Auth unit coverageは`Verify / Code`内の`test:unit`、
real HTTP/browser coverageは独立した`Verify / E2E`がauthorityです。

- `pnpm run verify:code` — `format:check` / `lint` / `typecheck` /
  `test:unit` / `test:scripts` / `supabase:migrations:check`。いずれも local
  Supabase runtimeを必要としない
  deterministic checkです。`typecheck`はworkspace packageに加えてroot
  `test/rls/**/*.ts`も`test/rls/tsconfig.json`でblocking検証します。Auth unit
  testだけを絞って再実行する場合は`pnpm run test:auth:unit`を使えます。
- `pnpm run verify:build` — `build` / `build-storybook`（component catalogの
  static build。Storybookのruntime Node要件がrepoのNode baselineと非互換化
  する事態をCIで検知するためblocking checkに含めています）。
- `pnpm run verify:database` — local Supabaseを起動・resetした上で、
  `verify:database:checks` を実行します。これはDB層の
  `supabase:types:check` / `test:rls` / `test:db:client-role-privileges` を
  `verify:database:db-checks` として実行する構成です。
  generated database typesのexact drift、DB/RLS test、および`anon` /
  `authenticated` / `PUBLIC`への`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`
  残存privilegeを検知するclient-role table privilege guardrailを含みます。
  guardrailは`supabase/tests/13_client_role_table_privileges_test.sql`だけを
  `supabase test db <path> --local`で実行するpath-scoped pgTAP testです。既存の
  pgTAP suite全体をrequired checkへ昇格させず、guardrailだけをactive verification
  pathへ組み込んでいます。DB / migration の deterministic safety は project-owned
  scripts と migrations / tests で維持します。
  remote Supabase projectやremote credentialsは不要です。
  Docker が起動していない場合、このステップで失敗します。real browser の
  Auth / journey coverage は独立した `verify:e2e` が担います。
  Supabase の起動は `verify:database:start`（Database/RLS checksが使わないStudio/
  Realtime/Storage等のservice - `supabase:start --exclude`の対象 - を
  除いたもの）です。checkは`verify:database:checks`が
  `verify:database:db-checks`を呼び出し、
  GitHub Actions (`Verify / Database` job) は同じ`verify:database:start`の
  後にresetを省き、同じDB check groupをnamed stepで実行します
  （Issue #209 - GitHub-hosted runnerは常にfreshなため、既存local
  Supabaseがdirtyな状態を引きずるlocal/agent実行と異なりresetが不要と
  実証済み）。

Code lane に project-owned quality config と migration collision fence を含め、
DB runtime を必要とするものは `verify:database` に分離しています。新しい check
もこの責務境界に従って追加します。

RLS policy の guardrail proof (`test/rls/guardrail-proof.mjs`) は
`pnpm run test:rls:guardrail-proof` で手動実行します。実際に policy /
grant を一時的に壊してnegative testが red になることを確認し、必ず
restore する one-off の検証スクリプトであり、blocking verify には含めて
いません。
