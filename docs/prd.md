# stage-tracker PRD

## Product overview

stage-tracker は、オペレーター本人と、オペレーターが明示的に事前プロビジョニングした
家族が複数ジャンルのイベント参加情報を一箇所で管理する private household
application です。

## User problem

イベント参加者は、以下の情報が別々の場所に分散しがちです。

- 公演・イベント情報そのもの
- チケットの抽選・先行・販売開始などの販売機会
- 自分が参加を予定しているかどうか
- 参加にかかる予算・支出

stage-tracker はこれらを一つのproductの中で扱えるようにし、分散管理の負担を
減らすことを目的とします。

## Target user / usage context

現在の利用対象は、オペレーター本人と、オペレーターが明示的に事前プロビジョニングした
家族のアカウントです。友人・任意の第三者・一般ユーザーへの展開や public
event-information service は current scope に含みません。将来その範囲へ拡張するには、
別途明示的な product decision が必要です。

## Main domain concepts

現在採用しているtop-level domain conceptは次の5つです。各conceptの内部構造
（例: **event** と公演回（occurrence）の関係）はこの一覧では展開せず、
Event / Occurrenceの詳細は
[`Event / Occurrence Living Spec`](../specs/005-event-occurrence-lifecycle/spec.md)、
Catalog classification / filterのcurrent semanticsは
[`Catalog classification / filter Living Spec`](../specs/011-catalog-classification-filter/spec.md)、
Personal Schedule lifecycleは
[`Personal Schedule lifecycle Living Spec`](../specs/007-personal-schedule-lifecycle/spec.md)、
Personal Schedule sharing / recipient privacyは
[Personal Schedule sharing / recipient privacy Living Spec](../specs/012-personal-schedule-sharing-privacy/spec.md)、
その他の current product semantics は relevant topic の Living Spec
(`specs/**/spec.md`) を参照します。この一覧に現れないことは、実装対象から
外れることを意味しません。未実装 / future intent は本PRD、roadmap、関連 Issue
で扱い、current behaviorへ昇格させません。
TicketOpportunity planningは
[`TicketOpportunity planning Living Spec`](../specs/008-ticket-opportunity-planning/spec.md)、
timeline projectionは
[`TicketOpportunity timeline Living Spec`](../specs/003-ticket-opportunity-timeline/spec.md)を
参照します。current semantics は各 topic の relevant Living Spec を参照します。
この一覧に現れないことは、実装対象から外れることを意味しません。

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
- **TicketOpportunity** の販売機会も共有情報です。現在の authenticated users は、
  この deployment のオペレーター本人と事前プロビジョニングされた家族のアカウントに
  限られます。
- **participation / personal schedule**、TicketOpportunity の personal
  planning state、および **expense / budget** は、event catalog とは分離
  された personal concept です。同じ event に対して、ユーザーごとに独立
  した participation / planning state / expense を持ちます。

この分離は、screen構成やDB schemaの形を固定するものではなく、conceptとして
の責務分離を表します。

## Current-approved product-level semantics

Event / Occurrenceのnormativeなconstraintは
[`Event / Occurrence Living Spec`](../specs/005-event-occurrence-lifecycle/spec.md)を
参照します。
Personal Schedule lifecycleのnormativeなconstraintは
[`Personal Schedule lifecycle Living Spec`](../specs/007-personal-schedule-lifecycle/spec.md)を
参照します。
その他の current domain constraint も該当する Living Spec
(`specs/**/spec.md`)を参照します。
Occurrence Participation とその直接の Invitation convergence / cancellation
behavior は [Living Spec](../specs/001-occurrence-participation/spec.md) が正本です。
Invitation の pending-only lifecycle、targeting、privacy / opacity などの broader
behavior は [Invitation Living Spec](../specs/006-invitation-coordination-opacity/spec.md)
が正本であり、このPRDでは詳細を複製しません。
TicketOpportunity planningのbroader current semanticsは
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)が正本であり、
timeline projectionは[Spec 003](../specs/003-ticket-opportunity-timeline/spec.md)が正本です。
Catalog classification / filterのcurrent semanticsは
[Spec 011](../specs/011-catalog-classification-filter/spec.md)が正本です。

## Current committed scope

現在current repositoryでschema/RLS/permission実装として成立している主な
scopeは、shared Event catalog と owner semantics（owner限定更新・owner
transfer不可・owner spoofing防止）、Event/Occurrenceのtemporal model、
owner-only hard deletion、および Event/Occurrence cancellation です。

Catalog classification / filter も Gate-A の current capability です。genre / group /
venue facet、filter composition、catalog-wide option universe、browser-local filter
persistence の product semantics は [Spec 011](../specs/011-catalog-classification-filter/spec.md)
を参照し、classification の import / schema / RLS mechanics は実装側のauthorityを
参照します。

event-independent Personal Schedule は、all-day / multi-day all-day /
time-bounded、required free-form title、独立した blocking、private default、
entry単位の sharing、owner-only recipient管理・entry deletion を備えます。
Personal Schedule lifecycleのcurrent behavior詳細は
[Living Spec](../specs/007-personal-schedule-lifecycle/spec.md)を参照します。sharing /
recipient privacyのcurrent semanticsは
[Personal Schedule sharing / recipient privacy Living Spec](../specs/012-personal-schedule-sharing-privacy/spec.md)
を参照します。
occurrence-level Participation は `considering` / `attending` と private/
public visibility を持ち、Invitation は pending-only の独立 coordination
recordです。Participation側から見た直接的な収束は
[Occurrence Participation Living Spec](../specs/001-occurrence-participation/spec.md)、
Invitation lifecycleの詳細は [Invitation Living Spec](../specs/006-invitation-coordination-opacity/spec.md)
を参照します。Personal ScheduleやTicketOpportunityの詳細は本PRDの各scopeに
属し、これらの仕様を再掲しません。

TicketOpportunity planningは、sharedな販売機会とuser-ownedなplanning stateを
提供するcurrent capabilityです。詳細なidentity、target scope、milestone、
`planned` / `applied`、row absence、およびout-of-scopeは
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)
に集約します。`/tickets`とHomeのdeadline blockはこのcurrent capabilityを利用します。

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

詳細なcurrent product semanticsは、Event / Occurrenceについては
[`Living Spec`](../specs/005-event-occurrence-lifecycle/spec.md)、Occurrence
Participationについては[Living Spec](../specs/001-occurrence-participation/spec.md)を
参照します。その他の current semantics も各 topic の Living Spec を参照し、
schema / RLS / runtime / test の mechanics はそれぞれの実装側 authority に残します。
Personal Schedule lifecycleについては
[Living Spec](../specs/007-personal-schedule-lifecycle/spec.md)を参照します。
TicketOpportunity planningについては
[TicketOpportunity planning Living Spec](../specs/008-ticket-opportunity-planning/spec.md)、
timeline projectionについては[Spec 003](../specs/003-ticket-opportunity-timeline/spec.md)、
その他の current semantics は各 topic の relevant Living Spec を参照します。
calendar presentationは[`docs/ux-ui.md`](./ux-ui.md)を参照してください。

## Deferred decisions

以下は、関連する専用product Taskが起票されるまで未決定（deferred /
uncommitted）です。current committed scopeには含みません。

- Event/公演回の cancellation（中止）の exact UI workflow（semanticsは
  Issue #123で決定済み、実装はIssue #125）
- 各domain concept（classification / venue）の将来拡張に関する exact
  persistence・mechanism詳細。current Catalog classification / filter baseline は
  [Spec 011](../specs/011-catalog-classification-filter/spec.md)で定義し、schema / RLS /
  importのmechanicsは実装側のauthorityに残します。将来の追加UI、canonical venue
  identity、alias normalization、visual cue、追加facet、multi-genre、
  occurrence-level classificationはcurrent baselineへ昇格しません。designated catalog creator（Administrator）の
  permission mechanismも、UUID hard-codeでもgenericなadmin/role
  frameworkでもないmembership allowlistとして確定済みのため対象外です。
  未決定なのは、Administrator以外へのEvent create権限拡大に伴う
  verification / moderationのexact workflow（Post-MVP）です
  （未決定項目は本PRD、roadmap、関連 Issue で管理し、本PRDでは
  implementation-level detailを複製しません）
- budget集計の期間基準
- MCP product scope
- production hosting provider（Gate A dogfood限定でVercel Hobbyを
  bounded operational choiceとして採用済み。broader/general production
  hosting platformの恒久決定は引き続きuncommitted。詳細は Issue #61 と
  roadmapで扱います）
- PWAのoffline capability（offline read / offline write / cache戦略）と
  Web Push notificationのproduct scope。installabilityとstandalone起動は
  Issue #304で確定済みで、canonicalな記述は
  [`Installable standalone Web App Living Spec`](../specs/010-installable-standalone-web-app/spec.md)
  です

友人・任意の第三者・一般ユーザーへの将来の展開は current scope 外であり、
検討する場合は別途明示的な product decision を必要とします。

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
invariant / default / 禁止事項等）は、該当する domain の Living Spec
(`specs/**/spec.md`) が所有します。schema / RLS / runtime / test の mechanics は
それぞれの実装側 authority が所有します。
本PRDと矛盾する記述がある場合は、該当domainのcurrent authorityを優先します。
