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
- shared event catalog（`public.events` / `public.event_occurrences` の
  schema / RLS）
- event ownership semantics（owner限定更新・owner transfer不可・owner
  spoofing防止を含む permission baseline）
- eventと公演回（occurrence）のtemporal model・公演回の管理権限
  （1 event : N occurrence、occurrence starts_at必須/ends_at nullable、
  create/updateはparent event ownerのみ、event作成はevent + initial
  occurrenceを1 transactionで作るRPC経由のみ）
- designated catalog creator限定のminimal Event catalog write UI
  （Event作成は `public.catalog_creators` membershipに限定・作成者が
  owner・Event更新と公演回のadd/updateはowner限定・開演/終演の前後関係は
  write pathで検証。`event_occurrences` へのCHECK制約は未導入で、DB level
  の不変条件ではない）
- Event/公演回のowner限定hard deletion（Issue #124）。downstream data
  （participation/invitation/ticket acquisition）が存在する公演回・Event
  は削除できず、cascadeも行わない。cancellation（公演の中止）はdeletion
  とは別概念で対象外のまま（semanticsはIssue #123で決定済み、実装は
  Issue #125）
- event-independent personal scheduleのpersistence / sharing / RLS
  baseline（all-day・multi-day all-day・time-boundedを曖昧なく区別する
  temporal shape、required free-form `title` + 独立した`blocking`
  boolean（Issue #121。旧`paid_leave`/`work`/`travel`/`other`のclosed
  vocabularyをsupersede）、creator = owner、default private、entry単位の
  explicit share・approvalなし即時反映、owner限定のrecipient追加削除、
  recipientの自己離脱、owner限定のentry hard delete（dependent shareは
  ON DELETE CASCADEでcleanup）
- occurrence-level participation / invitationのpersistence / RLS
  baseline（participationはoccurrence単位・statusは`considering`/
  `attending`のみで`not_attending`は持たない・default private
  visibility・withdrawは自分のrow削除で表現、invitationはoccurrence
  単位でinviterが対象occurrenceで`attending`の場合のみ作成でき、event
  ownershipはinvite権を与えない・invitee側3分岐（row無し→invitationのみ
  / `considering`→invitationのみ・participation不変 / `attending`→
  invite対象外）。Issue #225/#230でpending-onlyへ収束し、旧
  auto-considering作成とdecline後の永久re-invite拒否をsupersede：
  accept（=通常のattending participation writeと同一operation）・
  decline・通常participation UIからのgeneric attending convergence
  のいずれでもpending invitationは即resolve（削除）され、durableな
  accepted/declined historyは持たない。invitationのcreateとdeclineは
  それぞれ専用RPCのみがwrite pathで、`occurrence_invitations`への
  INSERT/UPDATE/DELETE grantもpolicyも持たない。invite結果はinviterに
  対して不透明で、3分岐すべてが同一の結果を返し、invitation rowの
  通常readはinvitee本人に限定する。inviter向けinvitation historyは
  committed scope外）
- ticket acquisition / ticket / ticket transferのpersistence / RLS
  baseline（acquisitionはuser-owned・occurrence-linkedで同一user/
  occurrenceに複数attempt可・statusは`pending`/`secured`/
  `unsuccessful`のみ、ticketはsecured acquisitionの結果として複数持て
  seat/queue/mediumはticket単位でnullable、registered assigneeと
  外部同行者名の排他assignmentでaccount不要の同行者を表現可能、
  transferはeligibleなregistered invitee向け・recipientのacceptance
  必須・accept前はsenderがcancel可・accept後はownershipがrecipientへ
  移りsourceとのprovenanceは保持・participationを自動変更しない。
  この機構自体はDROPされていないが、Issue #225/#230でlegacy Ticket
  acquisition/inventory/assignment/transferはcurrent runtimeの
  supported UI/API pathから切り離され、`ticket_transfer_recipient_is_
eligible`のoccurrence_invitations参照はもはやcurrent product
  journeyから到達不能。pending中のtransfer offerは、accept前まで前
  ownerのassignment情報を
  recipientへ開示しません。recipientがsource acquisition ownerを兼ねる
  場合も同様に非開示で、source acquisition provenance read自体は維持
  されます）
- occurrence-level participation / invitation・event-independent
  personal schedule・ticket acquisition / ticket / ticket transferの
  6 domainについて、UIがad-hocなSupabase table/RPC accessをせずに済む
  typed feature-level read/write boundary（generated `Database` types
  をinfrastructure層でconsumeするadapterと、それを返すdomain model）。
  write / RPC operationはすべて、呼び出し元idを値として必要とするかに
  かかわらず、事前にunauthenticatedを明示的に検出したうえでnot-found /
  permission / validation / infrastructure failureを意味を失わず区別
  します。read operationのうち、自分のacquisition/participationのように
  呼び出し元idで絞り込むものは同様に事前検出しますが、RLS自身の
  auth.uid()判定だけで可視範囲や結果が決まり呼び出し元idを必要としない
  read・読み取り専用RPCは事前session精査を行わず、未認証呼び出しは
  RLS/grant拒否によりpermission-deniedへ分類されます。app UIからの
  direct Supabase table/RPC accessはlint
  guardrailで抑止されています。ticket transferのrequest/accept/cancelが
  participationを自動変更しないことはbehavioral regressionとして
  pin済みです
- MVPのauthenticated-user targeting（Issue #55, #36/#37共通prerequisite）
  はStage Tracker登録emailのexact input成立です。raw UUIDのuser-facing
  input・generic user directory・partial/fuzzy search・client-readableな
  generic `email -> user_id` lookup APIは持たず、resolutionはoperation
  ごとにinternalizeされたtyped boundary RPC
  （`invite_to_occurrence_by_email` / `share_schedule_entry_by_email` /
  `list_schedule_share_recipient_emails`）の内部でのみ行います。
  invitationのemail-based invite entrypointは、id-based
  `invite_to_occurrence`と同一のcanonical 3分岐dispatch・opacity要件を
  維持し、no-such-account分岐を含むinvitee-dependentな分岐すべてが
  inviter向けに区別不能です。personal schedule sharingのemail-based
  share entrypointは、対応する第三者private stateがないためこの
  opacity要件を持たず、未登録emailをownerへ明示できます。owner向けの
  share済みrecipient emailのbounded read projectionは、そのownerが
  管理権限を持つ既存share relationに限定されます

これらは [`docs/prd.md`](./prd.md) が指す
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に従って既に実装済みです。

calendar上のSaturday/Sunday/Japanese holiday presentation（`docs/ux-ui.md`
で承認済みのglobal rule）は、My Calendar（下記参照）で実装済みです。

occurrence-level participation / invitationはschema/RLS baseline・typed
read/write boundaryに加え、MVP user-facing UI journeyも実装済みです
（Issue #36。Issue #225/#230でpending-only invitation UIとevent詳細の
bottom sheet UIへ更新）。event詳細画面の各occurrence rowはconsidering/
attending/未定の状態テキストと、quietな「変更」（Participation sheet）・
「招待」（attending時のみ、Invite sheet）を提供します。
`/catalog/invitations`はpendingなinvitationのみを一覧し、「参加する」
（通常のattending participation writeと同一operation）・「参加しない」
（pending invitationをresolveしparticipationは変更しない、8秒の
client-local undo付き）で直接応答できます。招待の宛先選択は上記
「Authenticated-user targeting」節のとおり登録済みemail addressの
exact inputで、`invite_to_occurrence_by_email`で解決します。

event-independent personal scheduleも同様に、schema/RLS baseline・typed
read/write boundaryに加え、MVP user-facing UI journeyが実装済みです
（Issue #37。Issue #121でfree-form `title` + `blocking` modelおよび
owner限定のentry hard delete journeyへ更新）。`/schedule`での一覧、
all-day・multi-day all-day・time-boundedの作成/編集（固定種別selectは
廃止し、free-form件名とblocking/non-blocking controlを提供）、owner向け
recipient追加/一覧/削除、shared user自身によるself-remove、owner向けの
confirmation付きentry削除ができます。recipient追加は上記
「Authenticated-user targeting」節のとおり登録済みemail addressの
exact inputで、`share_schedule_entry_by_email`で解決します。owner向け
recipient一覧は`list_schedule_share_recipient_emails`が返す、そのentryに
実際にshare済みのrecipientのみのbounded projectionです。

ticket acquisition / ticket / ticket transferはschema/RLS baselineと
typed read/write boundaryが成立済みですが、Issue #225（PO decision）で
acquisition/ticketの新規作成・編集user-facing UI journeyの方向性自体を
撤回しました。現時点で価値が確認できているTicket capabilityは次節の
Ticket Opportunity（`TicketOpportunity` + `UserTicketOpportunityState`
`planned`/`applied`）のみで、legacy Ticket acquisition/inventory/
transferは実利用要求が確認された時点でcurrent TicketOpportunityを前提に
再設計します（詳細は`.ai-dev-foundation/product-rules.md`「Ticket
acquisition / Ticket」参照）。

**My Calendar**（Issue #34）は、participation登録済みoccurrenceと
event-independent personal schedule（own/shared）の状態表示、および
calendar上のSaturday/Sunday/Japanese holiday presentationを統合した
user-facing UI journeyとして実装済みです。`/calendar`で月表示と
selected-day詳細を提供します。共有されたpersonal scheduleはrecipient側
My Calendarにも反映されます。祝日データは内閣府「国民の祝日について」
CSVのsnapshotを正本とし、更新手順は
[`docs/holiday-data.md`](./holiday-data.md)に記録されています。
Issue #225/#230でlegacy Ticket acquisitionの状態表示は除去済みで、My
Calendarのcanonical sourceはParticipation + Personal Scheduleのみです。

catalog classification / venueについては、将来の分類導入を阻害しない
MVP data boundary（event-level・複数value許容・`troupe`等の
domain-specific columnを追加しない、venueは現行`events.venue` textを
維持する等）のみがMVPで承認済みです。classification / venueの
persistence実装・filter UIは対象外で、下記「Post-MVP direction」に
含みます。MVPでの実装対象には含めません。

## 2. MVP personal planning capabilities（成立させたい方向性）

以下は、[`docs/prd.md`](./prd.md) のmain domain conceptsのうち、event
catalog以外でMVPとして成立させたい主要capabilityです。列挙順は実装順序の
固定を意味しません。それぞれ、着手時に専用のbounded product Taskでscope
とsemanticsを確定してから進めます。detailed product semanticsは
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とします。

- **expense / budget** — event単位の支出と横断的な予算管理（semanticsは
  未確定）

legacy **ticket acquisition / ticket / ticket transfer**は、Issue #225
（PO decision）によりこの方向性の対象から外れました。persistence / RLS
baselineとtyped read/write boundaryはCompleted baselineのとおり
schemaとして残存しますが（destructive DROPは別途bounded Issueで
Production preflight後に検討）、acquisition/ticketの新規作成・編集UI
journeyを実装する計画はありません。現行のTicket capabilityは
Ticket Opportunity（`TicketOpportunity` + `UserTicketOpportunityState`
`planned`/`applied`。schema/RLS/UIとも実装済み - 詳細は
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
「Ticket Opportunity（Ticket planning MVP）」参照）のみです。

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
- PWA scope（installability / offline capability）
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
