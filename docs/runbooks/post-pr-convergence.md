# post-PR convergenceの範囲限定手順

このrunbookは、`merge-ready`またはpost-PR convergenceを明示的に求めるTask Contractのための、project-localな継続手順です。
upstreamのSpec Kit SDD workflowを拡張せず、PR作成後に確認された手順上の空白を埋めます。

## 使用条件

canonical Issueまたはtask contractがagentに`MERGE_READY`への到達を要求する場合に限り、このphaseを使用します。その場合、PR作成は
中間checkpointであり、同じagent/sessionが直ちに作業を続けます。read-only checkpoint、report-plus-STOP task、またはPR作成で明示的に
停止するtaskは、元の完了境界を維持します。

作成後に継続するentry point:

```text
pnpm run post-pr:converge --create \
  --title "<PR title>" \
  --body-file "<PR body file>"
```

PRをすでに作成済みの場合は、次のcommandで続行します:

```text
pnpm run post-pr:converge --pr <number>
```

このcommandは、PR作成、GitHub APIの観測、review threadの観測、reviewの依頼に、認証済みの`gh` CLI経路を使用します。
`--create`形式は`gh pr create`の終了後、同じprocess内で観測loopに入り、PRをmergeすることはありません。

## Repository policy

policyは意図的に固定され、簡潔です。汎用delivery configuration frameworkではありません。

| 境界                | 現行policy                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PR base             | `main`                                                                                                                             |
| Base freshness      | GitHub PRの`mergeable_state`が既知かつ`behind`以外であること。`behind`または不明なら`HOLD`                                         |
| Required CI         | `Verify / Code`, `Verify / Build`, `Verify / Database`, `Verify / E2E`, and `Verify / Migration Ordering Fence`                    |
| Review trigger      | 現在のhead SHA全体に紐付くtop-levelの`@codex review`依頼                                                                           |
| Review evidence     | 観測されたreview object/top-level result surfaceにおけるcurrent-headのCodex findingなし結果。このpolicyではGitHub `APPROVED`は不要 |
| Thread prerequisite | outdated threadを含め、未解決review threadがないこと。obsoleteまたは修正済みthreadはGitHub上で明示的にresolveする必要がある        |
| CI wait             | 30分                                                                                                                               |
| Review wait         | current-headへの依頼または観測されたpending依頼から15分                                                                            |
| Correction ceiling  | 範囲を限定した修正は2回まで。3回目は`HOLD`                                                                                         |

現在、CodeRabbitはadvisory（`auto_review.enabled: false`）として設定されており、このphaseで必須となるclear evidenceではありません。

現行のmain-only deployment contractでは、Vercelは意図的にpre-merge checkではありません。Preview Deploymentを作成しないため、
main以外のPR headにはVercel statusがない想定です。したがってこのevaluatorは、上記のrepository gate、つまりVerify、現在のexact-head review、
未解決threadが0件であること、baseが最新であることだけを引き続き使用します。Vercel Production deploymentは`main`へのpush後に確認します。
Production deploymentの欠落、pending、失敗、quotaによるblockは通常の状態ではなく、merge-ready evidenceとして扱ってはなりません。

## Deterministic and semantic boundaries

helperは各cycleでPR、現在のbase freshness、current headを取得します。GitHub PRのmergeable stateが`behind`または不明ならmerge-readyでは
ありません。CIの観測はcurrent headのcheck run/statusから読み取り、review evidenceは同じheadに紐付く場合に限り受け入れます。base更新によりheadが
変わった場合、以前のCI/review evidenceは無効となり、phaseはCI評価に戻ります。新しいheadについてfreshなCIとCodex review evidenceが必要です。

helperは失敗したcheck、取得可能な関連GitHub Actions failure log、review output、未解決threadを報告します。agentが次を判断します。

- CI failureがこの変更に起因するか。
- review findingに対応すべきか、またscope内か。
- 必要な場合、どの範囲限定修正を行うか。

修正後はlocalでverifyし、新しいheadをpushし、`--correction-attempt`を増やしてcommandを再実行します。古いheadのevidenceを再利用しては
なりません。同じheadに対する新しいreview依頼も、以前のfindingなしという結果を無効にします。その依頼より新しい結果が観測されるまでcommandは
pendingのままです。timestampが同一または解析不能ならfail closedとします。新しい依頼によってreview待機時間も再度開始します。修正上限を超えた
場合、commandはCI待ちまたは次のreview依頼より前に`HOLD`を返します。

evidenceが欠落、pending、不明、失敗、timeout、または別headに紐付いている場合は、常に`HOLD`になります。outdated threadを含む未解決review
threadがある場合も`HOLD`となります。agentは修正済みかobsoleteかを判断し、GitHub上で明示的にresolveしなければなりません。GitHub認証/APIの
失敗も、error evidenceとともに`HOLD`となります。baseが最新と確認され、exact-headのCIがgreenで、現行の必須review evidenceがあり、未解決review
threadが0件の場合に限り`MERGE_READY`になります。

## Stop boundary

`MERGE_READY`は、current exact headがrepositoryの人間によるmerge authorityに進める状態を意味します。このrunbookは自動merge、Issue close、
polling daemonの永続化、credential保存、failure分類、reviewer routing、evidence ledger管理を行いません。
