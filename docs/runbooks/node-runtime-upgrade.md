# Node runtime upgrade

PR #868はCI・型定義・repo root・Vercel Root Directory (`apps/web`)をNode.js 26系へ
揃える変更です。依存更新の追跡はIssue #795で行います。スキーマ変更はありません。

## Before merge

- 現headの必須Verify 5系統、canonical Codex review、未解決thread 0、base freshnessを確認する。
- 現main SHAと、それに対応する既知の正常なProduction deployment URLを記録する。
  DashboardのNode選択値は過去deploymentの実runtimeの証拠ではない。
- `apps/web/package.json`の`engines.node: "26.x"`がVercelの設定を上書きする。
  Dashboardの24.x指定だけを変更しても、このpackage指定には優先しない。

## After merge

1. merge SHAに対する自然なmain VerifyとApply Migrationsの結果を確認する。
   本変更にmigrationは無く、新しいDB変更を手動実行しない。
2. 同SHAのVercel Production statusとProduction domainへの反映を確認する。
   取得できるdeployment metadata/build evidenceでNode 26の選択を確認する。
   証拠にアクセスできなければ実runtimeは未確認と記録し、成功と推測しない。
3. 既存の認証済みセッションで主要画面・catalog・自分の予定を読み取る。
   認証を再発行するメール送信や共有・import・候補適用は行わない。
4. 外部HTTPSとWorkflowは既存の安全なreadで確認できる範囲に限定する。
   readだけではdurable Workflow実行の確認にならない。実行にwriteが必要なら未検証とする。
   Node 26の`fetch`はHTTP/2を交渉し、HTTP/2の`statusText`は空になるため、HTTP判定は
   `status`または`ok`で行う。

失敗・runtime不一致・主要readの異常があれば後続の依存更新PRのマージを停止する。
不足した証拠とアプリケーションの失敗を区別し、SHA・status・確認範囲を報告する。
既知のログ403を反復せず、認証・アクセス設定を拡大しない。

## Recovery

- 緊急時は記録した既知の正常なProduction deploymentをVercelのrollback対象にする。
  rebuildではなく保存済みdeploymentへ戻す。対象SHA・URL・確認結果を先に照合する。
  この手順自体はrollbackの実行やアクセス設定変更を許可しない。
- Vercel rollbackは後続pushの自動domain割当を停止するため、修正版を確認した後に
  明示的なpromoteで通常の自動反映へ復帰する。
- codeで24系へ復帰する場合、Node移行commitのrevertだけでは不十分。
  元の`>=24.0.0`もVercel上で26を許容するため、repo rootと`apps/web`を明示的に
  `24.x`へ指定し、CI・型定義・lockfileを整合させ、通常のreview/CIを経て反映する。
  24系への復帰は障害時の別判断であり、今回の移行前に一時pinしない。

## References

- [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel HTTP/2 fetch on Node.js 26](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#http2-for-fetch-on-nodejs-26)
- [Corepack installation](https://github.com/nodejs/corepack#how-to-install)
