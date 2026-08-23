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

**expense・budget**は未実装です。
event-independent **personal schedule**、occurrence-level
**participation / invitation**、および **ticket acquisition / ticket**
（ticket transferを含む）は、いずれも persistence / RLS baseline が
実装済みです（personal schedule は sharing も含む。詳細は
[Current committed scope](#current-committed-scope) 参照）。
participation / invitation、ticket acquisition / ticket については、
UIがad-hocなSupabase table/RPC accessをせずに済むtyped feature-level
read/write boundaryも実装済みです。ただしいずれもuser-facing UI
journeyは未実装です。

**expense / budget**のsemanticsはまだ未確定です。

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
invitee側3分岐・declineはinvitation側の`declined_at`で表現）、および
ticket acquisition / ticket / ticket transferのpersistence / RLS
baseline（acquisitionはuser-owned・occurrence-linkedで同一user/occurrence
に複数attempt可・statusは`pending`/`secured`/`unsuccessful`、ticketは
secured acquisitionの結果として複数持てseat/queue/mediumはticket単位で
nullable、registered assigneeとexternal companionの排他assignmentで
account不要の同行者を表現可能、transferはeligibleなregistered invitee
向けでrecipientのacceptanceが必須、accept後はownershipがrecipientへ移り
sourceとのprovenanceは保持、transferはparticipationを自動変更しない）
です（詳細は `product-rules.md` を参照）。event作成はevent + initial
occurrenceを1 transactionで作るRPC経由のみをsupported pathとし、直接の
`events` INSERTは提供しません。invitationのcreateとdeclineも同様に
それぞれ専用RPC経由のみで、直接の`occurrence_invitations`書き込みは
提供しません。ticket transferのownership移転とtransfer lifecycle
state（request/accept/cancel）の変更も専用RPC経由のみで、`tickets`の
ownership列や`ticket_transfers`への直接UPDATEは提供しません。一方、
ticketのseat/queue/medium/assignmentといった通常の詳細編集は、current
ticket ownerによる直接UPDATEで提供します。

上記6 domain（participation / invitation / personal schedule /
ticket acquisition / ticket / ticket transfer）は、persistence / RLS
baselineに加えて、UIがad-hocなSupabase table/RPC accessをせずに済む
typed feature-level read/write boundaryも実装済みです。generated
`Database` typesはinfrastructure層だけがconsumeし、UI-facing boundaryは
domain modelを返します。app UIからのdirect Supabase table/RPC accessは
lint guardrailで抑止されています。これはUI-facing boundaryの実装状態
であり、user-facing UI journey自体（My Calendar統合・ticket管理・
personal schedule共有操作等）はまだ実装されていません。

occurrence-level participation / invitationについては、上記typed
boundaryに加えてMVP user-facing UI journeyも実装済みです（Issue #36）。
event catalogのevent詳細画面から、公演回ごとに`considering`/`attending`
participationの登録・切替と参加予定の解除（row削除）ができ、`attending`
状態の occurrence では invite-by-email affordance が表示されます。invitee側は
`/catalog/invitations`で自分が受け取ったinvitationを一覧・declineできます。
RLS/auth failureはempty stateへ潰さず、読み込み失敗を区別して表示します。

invitationのMVP write/read boundaryには、participation privacyを守る
ための追加の制約があります。invite操作の結果はinviterに対して不透明
です。上記3分岐のどれが実行されたかはinvitee本人のparticipation status
だけで決まるため、これをinviterへ返すことはprivate participationの
開示にあたります。したがってinvite RPCは3分岐すべてで同一の結果を返し、
invitee statusを理由とするerrorを返しません。あわせてinvitation rowの
通常readはinvitee本人に限定します。inviterがrowの有無を観測できると、
「invitation rowを作らない」分岐から同じ情報が復元できるためです。
inviter向けのinvitation history表示は現時点のcommitted scopeに含めず、
必要になった時点でこの境界を壊さないprojectionとして別途設計します。

招待の宛先選択（invitee selection）は、`.ai-dev-foundation/
product-rules.md`の「Authenticated-user targeting（identity boundary）」
節（Issue #55）が定めるMVP共通decisionに従い、user directory/search/UUID
inputではなく登録済みemail addressのexact inputです。email resolutionは
trusted server/DB boundary内（`invite_to_occurrence_by_email` RPC）で行い、
account existence自体を含むopacity requirementを維持します（invitee-
dependentな分岐はaccount不存在を含め、inviterから見てすべて同一の結果を
返します）。実装・product decisionの詳細はIssue #55 / PR #57を正本とし、
本PRDでは複製しません。

加えて、designated catalog creator限定のminimal Event catalog
create/update UIが成立しています。Event作成はdesignated catalog creator
（`public.catalog_creators` membership）に限り、作成者がevent ownerに
なります。Event記述情報の更新と公演回のadd/updateはevent ownerのみです。
deletion / cancellationは提供しません。開演/終演の前後関係は本UIが提供する
write pathで検証しますが、`event_occurrences` へのCHECK制約は未導入です。

以下は `product-rules.md` で承認済みのproduct-level semanticsですが、
対応する schema/RLS/UI 実装はまだありません（approved-but-unimplemented）。

- ticket acquisition / ticket / ticket transfer の user-facing UI journey
  （schema/RLS baselineとtyped read/write boundaryは上記のとおり成立済み）
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
- Ticket の deletion / correction semantics
- 各domain concept（classification / venue）の exact persistence・
  mechanism詳細。event-independent personal schedule、occurrence-level
  participation / invitation、および ticket acquisition / ticket /
  ticket transfer は persistence / RLS baseline が実装済みのため対象外
  です（[Current committed scope](#current-committed-scope)
  参照）。これらについて残っているのは UI journey であって persistence
  shape ではありません。designated catalog creator（Administrator）の
  permission mechanismも、UUID hard-codeでもgenericなadmin/role
  frameworkでもないmembership allowlistとして確定済みのため対象外です。
  未決定なのは、Administrator以外へのEvent create権限拡大に伴う
  verification / moderationのexact workflow（Post-MVP）です
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
