# stage-tracker PRD

## Product overview

stage-tracker は、複数ジャンルのイベント参加に伴う情報を一箇所で管理するための
authenticated multi-user application です。

## User problem

イベント参加者は、以下の情報が別々の場所に分散しがちです。

- 公演・イベント情報そのもの
- チケットの抽選・先行・販売開始などの販売機会
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
- **TicketOpportunity planning** — チケットの抽選・先行・販売開始などの
  販売機会と、自分の `planned` / `applied` state
- **expense** — そのeventに関する支出
- **budget** — 支出を横断した予算

このうち **event** は、current `public.events` schema / RLS baseline
としてすでに実装済みです（[`docs/roadmap.md`](./roadmap.md) の
Completed baseline参照）。これはcurrent baselineとして成立している事実で
あり、将来の専用product Taskで見直せないことを意味しません。

**expense・budget**は未実装です。
event-independent **personal schedule**、occurrence-level
**participation / invitation**、および **TicketOpportunity planning** は、
persistence / RLS baseline と、UIがad-hocなSupabase table/RPC accessを
せずに済む typed feature-level read/write boundary が実装済みです
（personal schedule は sharing も含む。詳細は
[Current committed scope](#current-committed-scope) 参照）。この3 domainの
user-facing UI journeyも実装済みです。詳細な申込・acquired Ticket inventory・
ownership transfer は Issue #234 で current schema / runtime から撤去しており、
現行PRDのdomainではありません。

**expense / budget**のsemanticsはまだ未確定です。

## Shared catalog と personal concepts の関係

- **event** は authenticated users 間で共有される catalog concept です。
  ある event の情報は、それを作成した owner が管理しますが、catalog自体は
  複数ユーザーが参照する共有情報です。
- **participation / personal schedule**、TicketOpportunity の personal
  planning state、および **expense / budget** は、event catalog とは分離
  された personal concept です。同じ event に対して、ユーザーごとに独立
  した participation / planning state / expense を持ちます。

この分離は、screen構成やDB schemaの形を固定するものではなく、conceptとして
の責務分離を表します。

## Current-approved product-level semantics

event owner の権限、invitation の可否条件、participation visibility の
既定値、participation と TicketOpportunity planning state の独立性などのnormativeな
constraintは、実装agentが従うべき正本として
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に一意に置かれています。本PRDではそれらの詳細を複製しません。

## Current committed scope

現在current repositoryでschema/RLS/permission実装として成立している主な
scopeは、shared Event catalog と owner semantics（owner限定更新・owner
transfer不可・owner spoofing防止）、Event/Occurrenceのtemporal model、
owner-only hard deletion、および Event/Occurrence cancellation です。

event-independent Personal Schedule は、all-day / multi-day all-day /
time-bounded、required free-form title、独立した blocking、private default、
entry単位の sharing、owner-only recipient管理・entry deletion を備えます。
occurrence-level Participation は `considering` / `attending` と private/
public visibility を持ち、Invitation は pending-only の独立 coordination
recordです。accept / decline / generic attending convergence で resolve済み
rowを保持せず、Invitationの作成・declineは専用RPC経由です。

TicketOpportunity planning は、sharedな販売機会・target scope・milestoneと、
user-ownedな `UserTicketOpportunityState`（statusは exactly `planned` /
`applied`）を提供します。これは実際の申込内容・希望順位・枚数・当落・
acquired Ticket inventoryを表しません。`/tickets` と Homeのdeadline blockが
このcurrent Ticket planning capabilityを利用します。

上記の各domainには、generated `Database` typesをinfrastructure層だけで
consumeするtyped feature-level read/write boundaryがあります。My Calendar
は Participation + Personal Schedule を、Homeは TicketOpportunity deadlines
と Participation + Personal Schedule を、それぞれ既存boundaryから合成します。
app UIからのdirect Supabase table/RPC accessはlint guardrailで抑止します。

従来の詳細なticket acquisition / inventory / assignment / ownership transfer
modelは、Issue #234でcurrent schema・runtime・専用テストから撤去しました。
このPRDはその旧modelのpersistence shapeやlifecycleをcurrent scopeとして扱い
ません。将来そのneedが生じた場合は、TicketOpportunityを前提に新しいbounded
product Taskで再設計します。

詳細なproduct semanticsは、[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とします。calendar presentationは[`docs/ux-ui.md`](./ux-ui.md)を
参照してください。

## Deferred decisions

以下は、関連する専用product Taskが起票されるまで未決定（deferred /
uncommitted）です。current committed scopeには含みません。

- Event/公演回の cancellation（中止）の exact UI workflow（semanticsは
  Issue #123で決定済み、実装はIssue #125）
- 各domain concept（classification / venue）の exact persistence・
  mechanism詳細。event-independent personal schedule、occurrence-level
  participation / invitation、および TicketOpportunity planning は
  persistence / RLS baseline が実装済みのため対象外です
  （[Current committed scope](#current-committed-scope) 参照）。これらに
  ついて残っているのは将来の追加UIであって、current baselineの
  persistence shapeではありません。designated catalog creator（Administrator）の
  permission mechanismも、UUID hard-codeでもgenericなadmin/role
  frameworkでもないmembership allowlistとして確定済みのため対象外です。
  未決定なのは、Administrator以外へのEvent create権限拡大に伴う
  verification / moderationのexact workflow（Post-MVP）です
  （未決定項目の一覧は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  の「まだ決めていないもの」を正本とし、本PRDでは複製しません）
- budget集計の期間基準
- MCP product scope
- production hosting provider（Gate A dogfood限定でVercel Hobbyを
  bounded operational choiceとして採用済み。broader/general production
  hosting platformの恒久決定は引き続きuncommitted。詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  および Issue #61）
- PWAのoffline capability（offline read / offline write / cache戦略）と
  Web Push notificationのproduct scope。installabilityとstandalone起動は
  Issue #304で確定済みで、canonicalな記述は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)の
  「App delivery surface」です
- 家族・友人への本格展開時期（現時点の実runtimeはGate Aの本人 + 妻の
  bounded 2-user dogfoodであり、broader rolloutは確約していません）

sign-in provider（具体的な認証方式）は、account bootstrap / recovery用の
Email magic link + Supabase Auth cookie-based session（Issue #11）に加え、
日常sign-inのprimary pathとしてPasskey（Supabase Auth WebAuthn, Beta）を
追加した構成として決定済みです（Issue #106）。Passkeyは Magic Linkを
置換するものではなく、既存 provisioned accountへ追加するoptional
credentialです。現時点でdeferredなのはproduction hosting providerと
PWAのoffline / Web Push scopeのみで、sign-in providerをこれらと同一の
deferred項目として扱いません。

## Canonical constraints

実装agentが従うべきnormativeなproduct/domain constraint（permission /
invariant / default / 禁止事項等）の正本は
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
です。本PRDと矛盾する記述がある場合は `product-rules.md` を優先します。
