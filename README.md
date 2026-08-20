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
`../ai-dev-foundation`)で参照します。pin されている SHA は
`.github/workflows/verify.yml` に記載しています。

### Local Supabase (Docker が必要)

`public.events` の migration / RLS / generated types / DB・RLS test は、
local-first の Supabase スタックに対して実行します。Docker が起動している
必要があります。

```bash
npm run db:start   # ローカル Supabase スタックを起動
npm run db:reset    # migrations だけを適用してDBを再構築
npm run db:stop     # 停止
```

## Verify

```bash
npm run verify
```

`format:check` / `lint` / `typecheck` / `test:unit` / `build` /
`foundation:check` (generated adapter と Foundation-managed quality profile の
drift 検知) に続けて `verify:profile` を実行する one-command verify です。
`verify:profile` は local Supabase を起動・reset した上で、generated
database types の exact drift check (`supabase:types:check`) と DB/RLS
test (`test:rls`) を実行します。remote Supabase project や remote
credentials は不要です。Docker が起動していない場合、この最後のステップで
失敗します。

RLS policy の guardrail proof (`test/rls/guardrail-proof.mjs`) は
`npm run test:rls:guardrail-proof` で手動実行します。実際に policy /
grant を一時的に壊してnegative testが red になることを確認し、必ず
restore する one-off の検証スクリプトであり、blocking verify には含めて
いません。
