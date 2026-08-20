# stage-tracker PRD

## Product overview

stage-tracker は、複数ジャンルのイベント参加に伴う情報を一箇所で管理するための
authenticated multi-user application です。

## User problem

イベント参加者は、以下の情報が別々の場所に分散しがちです。

- 公演・イベント情報そのもの
- チケット入手に関する情報
- 自分が参加を予定しているかどうか
- 参加にかかる予算・支出

stage-tracker はこれらを一つのproductの中で扱えるようにし、分散管理の負担を
減らすことを目的とします。

## Target user / usage context

当面は本人（開発者自身）が主な利用者です。ただし本人限定の設計にはせず、
authenticated multi-user application として家族・友人等の複数ユーザーへ拡張
できる形を維持します。家族・友人への本格展開時期は、現時点でcommitしません
（deferred）。

## Main domain concepts

現在採用しているdomain conceptは次の5つです。

- **event** — 公演・イベントそのものの情報
- **participation / personal schedule** — 自分がそのeventにどう関わる予定か
- **ticket acquisition** — チケット入手に関する情報
- **expense** — そのeventに関する支出
- **budget** — 支出を横断した予算

これらのうち、table naming・永続化shape・relation shape・詳細なstatus model
は本ドキュメントの時点では固定しません。各conceptを扱うbounded product Task
の中で確定します。

## Shared catalog と personal concepts の関係

- **event** は authenticated users 間で共有される catalog concept です。
  ある event の情報は、それを作成した owner が管理しますが、catalog自体は
  複数ユーザーが参照する共有情報です。
- **participation / personal schedule**、**ticket acquisition**、
  **expense / budget** は、event catalog とは分離された personal concept
  です。同じ event に対して、ユーザーごとに独立した participation / ticket
  acquisition / expense を持ちます。

この分離は、screen構成やDB schemaの形を固定するものではなく、conceptとして
の責務分離を表します。

## Current-approved product-level semantics

event owner の権限、invitation の可否条件、participation visibility の
既定値、participation と ticket acquisition の独立性などのnormativeな
constraintは、実装agentが従うべき正本として
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に一意に置かれています。本PRDではそれらの詳細を複製しません。

## Current committed scope

現在current repositoryで成立しているのは、event catalog の共有・owner
semantics・invitation semantics・participation visibilityの既定値といった
constraintと、それらを支えるschema/RLS/permission実装です（詳細は
`product-rules.md` を参照）。

participation / ticket acquisition / expense / budget の実装は、今後
それぞれ専用のbounded product Taskでscope・semanticsを確定した上で進めます
（[`docs/roadmap.md`](./roadmap.md) 参照）。

## Deferred decisions

以下は、関連する専用product Taskが起票されるまで未決定（deferred /
uncommitted）です。current committed scopeには含みません。

- event deletion semantics
- participation の persistence / table naming / 詳細status model
- ticket acquisition と participation の persistence関係
- budget集計の期間基準
- MCP product scope
- sign-in provider（具体的な認証方式）
- production hosting provider
- PWA scope（installability / offline capability）
- 家族・友人への本格展開時期

## Canonical constraints

実装agentが従うべきnormativeなproduct/domain constraint（permission /
invariant / default / 禁止事項等）の正本は
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
です。本PRDと矛盾する記述がある場合は `product-rules.md` を優先します。
