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

現在採用しているtop-level domain conceptは次の5つです。各conceptの内部構造
（例: **event** と公演回（occurrence）の関係）はこの一覧では展開せず、
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とします。この一覧に現れないことは、実装対象から外れることを意味しません。

- **event** — 公演・イベントそのものの情報
- **participation / personal schedule** — 自分がそのeventにどう関わる予定か
- **ticket acquisition** — チケット入手に関する情報
- **expense** — そのeventに関する支出
- **budget** — 支出を横断した予算

このうち **event** は、current `public.events` schema / RLS baseline
としてすでに実装済みです（[`docs/roadmap.md`](./roadmap.md) の
Completed baseline参照）。これはcurrent baselineとして成立している事実で
あり、将来の専用product Taskで見直せないことを意味しません。

**participation・ticket acquisition・expense・budget**は未実装です。
event-independent **personal schedule** は persistence / sharing / RLS
baselineが実装済みです（[Current committed scope](#current-committed-scope)
参照）。participation / invitation / ticket acquisition / ticket / ticket
transferのproduct-level semanticsは`product-rules.md`で承認済みですが、
table naming・永続化shape・relation shapeはそれぞれを扱うbounded product
Taskの中で確定します。**expense / budget**のsemanticsはまだ未確定です。

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

現在current repositoryでschema/RLS/permission実装として成立しているのは、
event catalog の共有と owner semantics（owner限定更新・owner transfer
不可・owner spoofing防止）、eventと公演回（occurrence）のtemporal
model（1 event : N occurrence・occurrence starts_at必須/ends_at
nullable・occurrence create/updateはparent event ownerのみ）、および
event-independent personal schedule のpersistence / sharing / RLS
baseline（all-day・multi-day all-day・time-boundedを曖昧なく区別する
temporal shape・`paid_leave`/`work`/`travel`/`other`のMVP vocabulary・
creator = owner・default private・entry単位のexplicit share・owner限定の
recipient追加削除・recipientの自己離脱）、および occurrence-level
participation / invitation のpersistence / RLS baseline
（participationはoccurrence単位・statusは`considering`/`attending`のみ・
default private visibility・withdrawはrow削除で表現、invitationは
occurrence単位でinviterが対象occurrenceで`attending`である場合のみ・
invitee側3分岐・declineはinvitation側の`declined_at`で表現）です
（詳細は `product-rules.md` を参照）。event作成はevent + initial
occurrenceを1 transactionで作るRPC経由のみをsupported pathとし、直接の
`events` INSERTは提供しません。invitationのcreateとdeclineも同様に
それぞれ専用RPC経由のみで、直接の`occurrence_invitations`書き込みは
提供しません。

加えて、designated catalog creator限定のminimal Event catalog
create/update UIが成立しています。Event作成はdesignated catalog creator
（`public.catalog_creators` membership）に限り、作成者がevent ownerに
なります。Event記述情報の更新と公演回のadd/updateはevent ownerのみです。
deletion / cancellationは提供しません。開演/終演の前後関係は本UIが提供する
write pathで検証しますが、`event_occurrences` へのCHECK制約は未導入です。

以下は `product-rules.md` で承認済みのproduct-level semanticsですが、
対応する schema/RLS/UI 実装はまだありません（approved-but-unimplemented）。

- occurrence-level participation / invitation の UI journey
  （schema/RLS baselineは上記のとおり成立済み）
- ticket acquisition / ticket の分離、ticket transfer
- catalog classification / venue のMVP data boundary
- calendar上のSaturday/Sunday/Japanese holiday presentation

詳細なsemanticsはいずれも
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
（calendar presentationは[`docs/ux-ui.md`](./ux-ui.md)）を正本とし、
本PRDでは複製しません。

これらの実装は、今後それぞれ専用のbounded product Taskでscope・詳細
semanticsを確定した上で進めます（[`docs/roadmap.md`](./roadmap.md) 参照）。

## Deferred decisions

以下は、関連する専用product Taskが起票されるまで未決定（deferred /
uncommitted）です。current committed scopeには含みません。

- event deletion semantics
- 各domain concept（participation / invitation / ticket acquisition /
  ticket / ticket transfer / classification / venue / Administrator権限
  機構）のexact persistence・mechanism詳細。event-independent personal
  scheduleはpersistence / sharing / RLS baselineが実装済みのため対象外
  です（[Current committed scope](#current-committed-scope)参照）
  （未決定項目の一覧は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  の「まだ決めていないもの」を正本とし、本PRDでは複製しません）
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
