# stage-tracker roadmap

このroadmapは、productとして何をどの方向に成立させていくかを示す
directional documentです。固定されたMVP bundleや厳密な実装順序を宣言する
ものではありません。development process（provider/model routing、review
工程、Issue運用等）はここに含みません。process governanceの正本は
Foundation v0.3.0 です。

## Roadmap principle

誤って静かに成立してしまうと事故につながるsemantics（permission /
privacy / RLS等）は、UIより先に固めることを原則とします。

## 1. Completed baseline

- Foundation v0.3.0 consumer baseline
- shared Event catalog（`public.events` / `public.event_occurrences` の
  schema / RLS）、Event owner semantics、temporal model、designated
  catalog creator限定のwrite boundary
- Event/Occurrenceのowner-only hard deletion（Issue #124）。downstream
  participation / invitation が存在する場合は拒否し、cascadeは行いません。
  Event/Occurrence cancellation（Issue #123/#125）も deletion と独立した
  reversible state として実装済みです。
- event-independent Personal Schedule の persistence / sharing / RLS
  baseline。all-day・multi-day all-day・time-bounded、free-form title、
  independent blocking、private default、entry単位のshare、owner-only
  recipient管理・entry hard deleteを含みます。
- occurrence-level Participation / Invitation の persistence / RLS
  baseline。Participationは `considering` / `attending`、Invitationは
  pending-only の独立coordination stateで、accept / decline / generic
  attending convergence によりresolve済みrowを保持しません。作成・
  declineは専用RPC経由で、inviteeのprivate stateをinviterへ開示しません。
- TicketOpportunity planning の persistence / RLS / typed boundary。
  sharedな `TicketOpportunity` と target occurrence / milestone、
  personalな `UserTicketOpportunityState`（statusは exactly
  `planned` / `applied`）を保持します。`/tickets` と Home deadline
  projectionがこのcurrent planning modelを利用します。
- 上記のcurrent domainは、generated `Database` typesをinfrastructure
  層だけでconsumeするtyped read/write boundaryを持ち、app UIからの
  direct Supabase table/RPC accessはlint guardrailで抑止します。
- My Calendarは Participation + Personal Schedule を、Homeは
  TicketOpportunity deadlines と Participation + Personal Schedule を
  既存のtyped boundaryから合成します。MVP user-facing journeyは
  `/calendar`、Personal Scheduleのdetail/create/edit routes、
  `/catalog/invitations`、`/tickets`、Homeに実装済みです。
- Issue #234で、従来の詳細なticket acquisition / inventory / assignment /
  ownership transfer modelをcurrent schema、runtime、専用テストから
  decommissionしました。将来の詳細な申込管理やinventoryは、
  TicketOpportunityを前提に新しいbounded product Taskで再設計します。

これらは [`docs/prd.md`](./prd.md) が指す
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に従って実装済みです。

## 2. MVP personal planning capabilities（成立させたい方向性）

以下は、[`docs/prd.md`](./prd.md) のmain domain conceptsのうち、event
catalog以外でMVPとして成立させたい主要capabilityです。列挙順は実装順序の
固定を意味しません。それぞれ、着手時に専用のbounded product Taskでscope
とsemanticsを確定してから進めます。detailed product semanticsは
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とします。

- **expense / budget** — event単位の支出と横断的な予算管理（semanticsは
  未確定）

TicketOpportunity planningはCompleted baselineのcurrent capabilityです。
詳細な申込管理・acquired Ticket inventory・assignment・ownership transferを
このroadmapへ追加する計画はなく、将来needが生じた場合は
TicketOpportunityを前提に新しいbounded product Taskで再設計します。

## 3. Post-MVP direction

以下はMVP scopeには含まれない、方向性としては採用済みだが着手時期を
決めていない領域です。着手時は専用のproduct Taskでscopeとsemanticsを
確定します。

- week-start preference
- photo upload / attendance memory・impression
- venue filtering / canonical venue identity
- 宝塚の組filter / visual cue UI、アイドルのグループfilter UI
- classification persistence / filter UI
- 宝塚 streaming
- movie release / admin-curated movie catalog
- broader Event create permissions（一般authenticated userへの拡大）＋
  verification / moderation mechanism（[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  のPost-MVP governance gate参照）

## 4. Deferred / uncommitted areas

以下はcurrent committed scopeに含まれない、未決定領域です。必要になった
時点で専用のproduct Taskで評価します（詳細は
[`docs/prd.md`](./prd.md#deferred-decisions) 参照）。

- MCP product scope
- PWAのoffline capabilityとWeb Push notificationのproduct scope
  （installabilityとstandalone起動はIssue #304で確定済み。canonicalな
  記述は[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)の
  「App delivery surface」）
- production hosting provider（Gate A dogfood限定でVercel Hobbyを
  bounded operational choiceとして採用済み。broader/general production
  hosting platformの恒久決定は引き続きuncommitted）
- 家族・友人への本格展開時期（現時点の実runtimeはGate Aの本人 + 妻の
  bounded 2-user dogfoodであり、broader rolloutは確約していません）

sign-in providerはEmail magic link + Supabase Auth cookie-based session
（Issue #11、account bootstrap / recovery用）に加え、日常sign-inの
primary pathとしてPasskey（Issue #106、Magic Linkを置換しないoptional
credential）を追加した構成として決定済みです（詳細は
[`docs/prd.md`](./prd.md#deferred-decisions) 参照）。production hosting
providerとは別項目として扱います。
