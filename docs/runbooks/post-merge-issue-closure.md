# post-merge Issue closeの範囲限定手順

このrunbookは[`post-pr-convergence.md`](post-pr-convergence.md)の後に行う別phaseです。post-PR phaseは引き続き`MERGE_READY`で終了し、
PRのmergeやIssueのcloseは行いません。

canonical Issue / Task Contractが、merge済み実装によってIssueが完了し、agentに完了操作を行う権限があると定めている場合に限り、このphaseを
使用します。read-only checkpoint、report-plus-STOP task、parent/coordination/umbrella/tracking Issue、既知のfollow-up workがあるtask、closeが
禁止されたtask、または意味上のclose reasonが`completed`ではないtaskには使用しません。適用可否が不明なら`HOLD`で停止します。

repositoryのentry point:

```text
pnpm run post-merge:closure <command> ...
```

helperの役割は意図的に限定されています。認証済みGitHub `gh` CLI/API経路を通じ、現在のIssueと明示された実装PRを読み取ります。決定的に
確認できる前提条件を検査しますが、Acceptance Criterionが満たされたか、Issueが親またはtracking itemか、merge後の作業が残っているかは判断しません。
これらはagentの判断事項であり、明示的なassertionとして渡す必要があります。

## 手順

### 1. 最新snapshotを取得する

実装PRのmergeを確認した後、次を実行します。

```text
pnpm run post-merge:closure snapshot --repo owner/name --issue <issue> --pr <pr> --json
```

outputには最新Issue body、bodyのSHA-256値、PRのmerge state/SHA、解析したAC itemが含まれます。parserが受け付けるのは、top-levelの
`- [ ]` / `- [x]` itemを持つ正確な`## Acceptance Criteria` sectionが1つだけの場合です。sectionがない、重複している、nested、またはその他の
曖昧さがある場合、close判定では`HOLD`とします。推測で修復してはなりません。

### 2. 意味上のverificationを行う

最新bodyとmerge済みcode、test、CI、review、永続artifactを使い、ACを1件ずつ確認します。evidenceで実際に満たしたと判断できるcriterionだけを
選択します。未達、deferred、scope外、不確かなcriterionは未チェックのままにします。

変更を行うcommandの前に、agentは次の3つすべてをaffirmできなければなりません。

```text
--allow-completion
--semantic-ac-verified
--no-known-remaining-work
```

これらのflagはassertionであり、意味を判定するclassifierではありません。1つでも省略するとhelperはfail closedになります。

### 3. 達成済みACのcheckboxだけを更新する

最新snapshotの`bodySha256`を使い、達成済みACごとに`--check-index`を指定します。例:

```text
pnpm run post-merge:closure update --repo owner/name --issue <issue> --pr <pr> --expected-body-sha256 <snapshot-sha256> --check-index 1 --check-index 4 --allow-completion --semantic-ac-verified --no-known-remaining-work
```

helperは書き込み直前にIssueを再取得し、body hashが一致しなければ拒否します。最新bodyに差分を適用し、期待するcheckbox stateを確認するため、
書き込み後にもbodyを再取得します。変更するのは選択された直接のchecklist lineだけです。GitHub標準のIssue更新はbody全体を置き換え、
文書化されたatomicな条件付きbody writeを提供しません。そのためhelperはoptimistic-locking frameworkを提供すると偽りません。別のeditorやbotが
Issueを変更する可能性のある間は、この変更を実行しないでください。安全な実行時間を確保できない場合は`HOLD`とします。API/auth/write確認の
失敗も`HOLD`です。

ACが未達ならそのindexを選択しません。未チェックのACが1件でも残る場合は、evidence追加やcloseへ進みません。

### 4. 完了evidenceを永続化する

tracked repository fileの外に、実際の値を使った次の項目を含む短いtext fileを用意します。

```text
Implementation PR: #<pr>
Merge commit: `<40-character merge SHA>`
Acceptance Criteria: every item was reviewed individually and satisfied.
Verification: <relevant CI/tests and other verification>
Review: <relevant exact-head review evidence>
Unresolved items: 0
```

次に実行します。

```text
pnpm run post-merge:closure evidence --repo owner/name --issue <issue> --pr <pr> --evidence-file <path> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

helperはIssue number、PR number、merge SHAを含む小さなidentity markerを追加します。先に同markerを確認し、十分なcommentを重複投稿しません。
必須fieldの欠落、既存commentの形式不正、API/auth/confirmation failureは`HOLD`です。

### 5. 検証後にcloseする

決定的な前提条件checkを実行します。

```text
pnpm run post-merge:closure verify --repo owner/name --issue <issue> --pr <pr> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

`READY_TO_CLOSE`の場合に限り、最後のcommandを実行できます。

```text
pnpm run post-merge:closure close --repo owner/name --issue <issue> --pr <pr> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

`close`はIssue/PR/commentを再度最新取得し、変更前にIssue bodyを再確認して、stateだけを更新するGitHub操作を行い、`state=closed`と
`state_reason=completed`を確認します。PRがmergeされたという理由だけで、そのPRのIssueをcloseすることはありません。

close guardでは、次のすべてを必須とします。

- Issueが現在openである。
- agentが適用可能性、ACごとの意味上のverification、既知の残作業がないことを明示的にaffirmしている。
- 指定された実装PRがmerge済みで、完全なmerge SHAを持つ。
- 明示されたAC sectionに曖昧さがなく、未チェックitemが0件である。
- identityが一致する十分な完了evidenceがある。
- 最新取得後の最終state更新が受理され、確認されている。

失敗、不明、stale、競合、または曖昧な条件が1つでもあれば`HOLD`です。assertionを弱めたり無関係なIssue内容を編集したりして再試行しては
なりません。

## Canaryと継続性の境界

Issue #517 / PR #518はread-onlyのnegative exampleです。PRはmerge済みですがIssueには未チェックのACが残っているため、`HOLD`のままにし、
このtaskでcloseしてはなりません。

Issue #527自体は、明示的なmerge authorityにより実装PRがmergeされた後に限り、範囲限定のself-canaryとして使用できます。これにより手順、意味に
基づくcheckbox更新、決定的なguard、evidence、close pathを検証できます。この実装sessionはすでにこのroutingを知っているため、将来のagentが
手順を発見できることや、merge後に自動で継続することの証明にはなりません。次に通常業務でclose可能となるIssueで、merge、追加のuser prompt
なしの継続、Issueの最新read、意味に基づくAC review、checkbox更新、evidence、`completed` closeを実証する必要があります。

daemon、webhook、Issue/PR registry、任意Markdown parser、semantic classifier、lifecycle engine、custom Skill、reviewer router、evidence ledger、
Foundation compatibility layerはこのphaseの対象ではありません。
