# stage-tracker

`ai-dev-foundation` の consumer bootstrap baseline (PR A) です。詳細な開発ルールは
生成された [`AGENTS.md`](./AGENTS.md) を正本とし、product-specific rule は
[`.ai-dev-foundation/product-rules.md`](./.ai-dev-foundation/product-rules.md)
に置きます。`AGENTS.md` / `.ai-dev-foundation/quality/` は
[reitojike/ai-dev-foundation](https://github.com/reitojike/ai-dev-foundation)
からの生成物であり、直接編集しません。

## Setup

```bash
npm install
```

Foundation tooling を使う `foundation:sync` / `foundation:check` は、pinされた
SHA の `ai-dev-foundation` checkout を `FOUNDATION_CHECKOUT` 環境変数(既定値
`../ai-dev-foundation`)で参照します。pin されている SHA は
`.github/workflows/verify.yml` に記載しています。

## Verify

```bash
npm run verify
```

`format:check` / `lint` / `typecheck` / `test:unit` / `build` /
`foundation:check` (generated adapter と Foundation-managed quality profile の
drift 検知) を順に実行する one-command verify です。
