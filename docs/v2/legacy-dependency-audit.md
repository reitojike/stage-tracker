# Legacy dependency audit

Issue #373 Milestone 9 で `apps/legacy-web` を削除する前に、旧 application
directory が担っていた責務を runtime / scripts / tests / config / docs の全領域で
inventory した結果です。調査基準は cutover 済みの `origin/main`
(`4b370f717da84b9c59f407dc230ec3f41f4092fd`) です。

## 結論

`apps/legacy-web` を残す必要があった理由は、Production runtime ではなく、次の
operational asset が application package 内に同居していたためでした。

- Supabase migration / generated types / RLS の検証 runner と DB/RLS integration test
- catalog creator / user provisioning / Event・Ticket Opportunity import の operator script
- Foundation sync / drift check と holiday data 更新 script
- 旧 application 自身の build / unit / Auth browser test / Storybook
- 並走期間の port・Auth redirect・WebAuthn origin・CI・documentation 設定

M9 では application 固有でない資産を root の `scripts/` と `test/rls/` へ移し、旧
application 固有の資産と並走設定を削除しました。`pnpm run legacy:check` は旧 directory、
旧 workspace package、active operational surface からの旧 path 参照が復活した場合に
fail します。

## Dependency inventory と解消

| 領域                 | cutover 直後に残っていた依存                                                                                                                                                                                               | M9 の解消                                                                                                                                                                                                                  | 検証                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Runtime              | Production は既に Vercel Root Directory `apps/web` で、`apps/web` / `packages/*` から旧 package への runtime import は ESLint boundary により 0 件。一方、workspace 全体の build / lint / test は旧 package も実行していた | 旧 package を workspace から除去。旧 import 防止用 ESLint rule は対象 directory 自体が無くなったため削除                                                                                                                   | `pnpm run build`、`pnpm run lint`、`pnpm run typecheck`、Production deployment |
| Scripts              | Foundation sync/check、migration ordering/drift、Supabase type generation/drift、RLS runner、user provisioning、catalog creator grant、Event / Ticket Opportunity import、holiday update が `apps/legacy-web/scripts` 配下 | application 非依存の entry / library / test を root `scripts/` へ `git mv`。root package script を全て新 path に変更                                                                                                       | `pnpm run test:scripts`、`pnpm run foundation:check`、`pnpm run legacy:check`  |
| DB / RLS tests       | authoritative な DB/RLS integration suite と fixture が `apps/legacy-web/test/rls` 配下で、generated database type も旧 app 側を import                                                                                    | raw DB/RLS suite を `test/rls/` へ移動し、current generated type `apps/web/src/lib/data/database.types.ts` を参照。app-specific typed-boundary test は current app の unit / E2E coverage と重複するため削除               | `pnpm run test:rls`、`pnpm run verify:database`                                |
| Auth / browser tests | 旧 Next.js server を起動する custom browser harness と journey test が `apps/legacy-web/test/auth` に存在                                                                                                                  | 旧 runtime と一体の harness は削除。current app の Auth unit tests と Playwright journeys (`sign-in`、protected routes、event management、participation、invitation、schedule、ticket planning) を closure evidence とする | `pnpm run test:auth`、`pnpm run test:e2e`                                      |
| Generated types      | 同一 schema から旧 app と current app の 2 ファイルを生成し drift check                                                                                                                                                    | current app の 1 ファイルだけを生成・検査。artifact sequencing fence と PR template も 1 出力へ変更                                                                                                                        | `pnpm run supabase:types`、`pnpm run supabase:types:check`                     |
| Local Auth config    | 旧 app `:3000` と current app `:3001` の並走 redirect / WebAuthn origin、current app の固定 `-p 3001`                                                                                                                      | current app を標準 `:3000` に戻し、Playwright server `:3100` だけを additional redirect に保持。WebAuthn origin は `:3000` のみ                                                                                            | Auth unit / E2E、`supabase/config.toml` review                                 |
| Root / CI config     | root package scripts、pnpm lock、Prettier ignore、CodeRabbit exclusion、PR template、Verify workflow、Playwright config、UI ESLint comment が旧 package を前提                                                             | root path / current app に更新し、旧 package entry と専用依存を lockfile から除去                                                                                                                                          | `pnpm install --lockfile-only`、`pnpm run verify`、`pnpm run legacy:check`     |
| Documentation        | root README と runtime/Auth architecture が旧 implementation や並走 port を current として参照。並走 harness runbook が active                                                                                             | current path / command へ更新し、並走 runbook を削除。M8 comparison / oracle / decision 文書内の旧 path は、当時の比較対象を示す immutable historical evidence として意図的に保持                                          | Markdown format/check、リンクと current command の spot check                  |

## Test coverage の置換境界

削除した test は「legacy app を起動して legacy の実装を再検査する」ものだけです。
DB/RLS invariant は root の integration suite にそのまま残し、現行 application の
behavior は `apps/web` の unit / component / Playwright E2E で検査します。このため、
旧 Auth harness や旧 app の typed adapter を root へ延命していません。

## Package value の評価

M9 の単一 application 化後も monorepo package は 2 つとも実使用されています。

- `packages/domain`: branded ID、Zod schema、Asia/Tokyo date conversion、Result、Event /
  Participation / Invitation / Personal Schedule / Ticket Opportunity の pure invariant を
  I/O から分離し、`apps/web` の action・mapper・view model から広く import されています。
- `packages/ui`: AppShell、navigation、Button、Sheet、StatePanel、list 等の accessible UI
  primitive を所有し、複数 route から import されています。

どちらも future-only な scaffold ではなく、current application の dependency direction と
test boundary を形成しています。`apps/web` を repository root へ引き上げるためにこれらを
再び app 内へ埋め込む利点はないため、pnpm workspace / Turborepo 構成を維持します。

## Historical reference policy

`docs/v2/oracle-*.md`、M8 comparison、decision log、Issue / PR には調査時点の
`apps/legacy-web/...` path が残ります。これは削除済み code への dependency ではなく、git
history と照合できる provenance です。active runtime / script / test / config からの参照とは
区別し、`legacy:check` の対象外にします。
