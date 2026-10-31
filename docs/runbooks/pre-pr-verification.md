# Pre-PR verification

このrunbookは、PR作成前のdefault mandatory mechanical floorを定義する
boundedな手順です。`verify:code`はformat、lint、typecheck、unit tests、script tests、
migration mechanical checkをPR作成前に止める責務を持ちます。PR作成後のCI・review・MERGE_READY収束は、別の
[`post-pr-convergence.md`](./post-pr-convergence.md)の責務です。

`pnpm run verify`は、build/Storybookとdatabase/RLSを含むrepositoryのfull local
verification entry pointとして維持されます。Task Contract、risk、または明示的な要件が
より広いlocal verificationを必要とする場合は`pnpm run verify`を使いますが、full local
verificationとdefault mandatory pre-PR mechanical floorは同義ではありません。Build、
Database、E2E等のrequired GitHub CI lanesは、引き続きpost-PR convergenceで必須です。

## Normal path

このrepositoryのpackage managerはroot `package.json`の`packageManager`で指定されます。
Node.jsはrootと`apps/web/package.json`に指定した26系を使用します。Node.js 25以降は
Corepackが同梱されないため、`pnpm`を直接実行します。CIは既存の`pnpm/action-setup`を
使用します。
Windows managed環境で子プロセスが別のpnpm shimを拾う場合は、指定されたpnpmを
repo外の一時ディレクトリへnpmでインストールし、process-localにPATHを設定します。
恒久的な環境変数、registry、repository内wrapperは変更しません。

PowerShellの例:

```powershell
$probeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('stage-tracker-pnpm-' + [guid]::NewGuid().ToString('N'))
$shimDir = Join-Path $probeRoot 'node_modules\.bin'
$tempDir = Join-Path $probeRoot 'tmp'
New-Item -ItemType Directory -Force $shimDir, $tempDir | Out-Null

$env:TEMP = $tempDir
$env:TMP = $tempDir
$packageManager = (Get-Content -Raw package.json | ConvertFrom-Json).packageManager
npm install --prefix $probeRoot --no-save --package-lock=false $packageManager
$env:PATH = "$shimDir;$env:PATH"

node --version
pnpm --version
cmd.exe /d /c pnpm.cmd --version
```

両方のversionがrepositoryの指定と一致することを確認してから、次を順番に実行します。

```powershell
pnpm install --frozen-lockfile
pnpm run verify:code
git diff --check origin/main...HEAD
```

`verify:code`は、このrunbookのbounded gateにおけるcode verification entry pointです。
`git diff --check`は最後に実行し、baseとの差分にwhitespace errorがないことも確認します。

## Environment-blocked fallback

TEMP、registry、workspace linker、network、権限などの環境要因で通常のcode gateを
完走できない場合も、実行可能なcheckを省略しません。少なくとも次をchanged filesと
repositoryの変更範囲に合わせて試行します。

- changed-file Prettier
- changed-file ESLint
- typecheck
- unit tests
- script tests
- Supabase migration check
- `git diff --check origin/main...HEAD`

PR本文には、通常のcode gateを完走できなかった理由、実行できたcheck、実行できな
かったcheckを記録します。degraded checksはfull preflightと同等ではありません。
実行不能なcheckの最終authorityはrequired CIです。

fallbackを使う場合でも、環境要因を理由に実行可能なformat/lintやdiff checkを飛ばし
ません。repository code failureとして再現した場合は、PRを作成せず原因を解消するか、
bounded taskをHOLDします。

## Boundaries

- `.worktrees/` と `.pnpm-store/` はlocal-only infrastructure/cacheとしてGitと
  repo-wide Prettierの対象外です。
- Windows固有のabsolute store pathをrepository-wide contractには埋め込みません。
- custom pnpm wrapper、permanent repo-local shim、新しいpackage、CI redesign、
  post-PR state machine、correction ceilingの再設計はこのrunbookの範囲外です。
