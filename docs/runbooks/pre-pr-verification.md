# Pre-PR verification

このrunbookは、PR作成前にrepositoryのmechanical verificationを実行するための
boundedな手順です。PR作成後のCI・review・MERGE_READY収束は、別の
[`post-pr-convergence.md`](./post-pr-convergence.md)の責務です。

## Normal path

このrepositoryのpackage managerはroot `package.json`の`packageManager`で指定されます。
Windows managed環境で子プロセスが別のpnpm shimを拾う場合は、Corepackの公式shimを
repo外の一時ディレクトリへprocess-localに生成します。恒久的な環境変数、registry、
repository内wrapperは変更しません。

PowerShellの例:

```powershell
$probeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('stage-tracker-corepack-' + [guid]::NewGuid().ToString('N'))
$shimDir = Join-Path $probeRoot 'bin'
$tempDir = Join-Path $probeRoot 'tmp'
New-Item -ItemType Directory -Force $shimDir, $tempDir | Out-Null

$env:TEMP = $tempDir
$env:TMP = $tempDir
corepack enable pnpm --install-directory $shimDir
$env:PATH = "$shimDir;$env:PATH"

pnpm --version
cmd.exe /d /c pnpm.cmd --version
```

両方のversionがrepositoryの指定と一致することを確認してから、次を順番に実行します。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run verify:code
git diff --check origin/main...HEAD
```

`verify:code`はformat、lint、typecheck、unit tests、script tests、migration checkを
含む、このbounded gateのcode verification entry pointです。既存の`verify`はbuild/
Storybookとdatabase/RLSを含むrepositoryのfull local verification entry pointとして
維持されますが、このrunbookのmandatory pre-PR sequenceには含めません。`git diff
--check`は最後に実行し、baseとの差分にwhitespace errorがないことも確認します。

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
