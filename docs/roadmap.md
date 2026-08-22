# stage-tracker roadmap

このroadmapは、productとして何をどの方向に成立させていくかを示す
directional documentです。固定されたMVP bundleや厳密な実装順序を宣言する
ものではありません。development process（provider/model routing、review
工程、Issue運用等）はここに含みません。process governanceの正本は
Foundation v0.2.0 です。

## Roadmap principle

誤って静かに成立してしまうと事故につながるsemantics（permission /
privacy / RLS等）は、UIより先に固めることを原則とします。

## 1. Completed baseline

- Foundation v0.2.0 consumer baseline
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
  owner・Event更新と公演回のadd/updateはowner限定・deletion/cancellationは
  対象外・開演/終演の前後関係はwrite pathで検証。`event_occurrences` への
  CHECK制約は未導入で、DB levelの不変条件ではない）
- event-independent personal scheduleのpersistence / sharing / RLS
  baseline（all-day・multi-day all-day・time-boundedを曖昧なく区別する
  temporal shape、`paid_leave`/`work`/`travel`/`other`のMVP vocabulary、
  creator = owner、default private、entry単位のexplicit share・
  approvalなし即時反映、owner限定のrecipient追加削除、recipientの自己
  離脱）
- occurrence-level participation / invitationのpersistence / RLS
  baseline（participationはoccurrence単位・statusは`considering`/
  `attending`のみで`not_attending`は持たない・default private
  visibility・withdrawは自分のrow削除で表現、invitationはoccurrence
  単位でinviterが対象occurrenceで`attending`の場合のみ作成でき、event
  ownershipはinvite権を与えない・invitee側3分岐（row無し→invitation+
  `considering` / `considering`→invitationのみ / `attending`→invite
  対象外）・declineはinvitation側の`declined_at`で表現し
  `not_attending` participationを作らない。invitationのcreateと
  declineはそれぞれ専用RPCのみがwrite pathで、`occurrence_invitations`
  へのINSERT/UPDATE grantもpolicyも持たない。invite結果はinviterに
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
  invitationをdeclineしたinviteeもtransfer eligibilityを維持する。
  pending中のtransfer offerは、accept前まで前ownerのassignment情報を
  recipientへ開示しない設計です）

これらは [`docs/prd.md`](./prd.md) が指す
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に従って既に実装済みです。ただし pending recipient への assignment
非開示については既知の gap があります。ticket が一度他 owner へ移った後、
再度元の acquisition owner へ pending offer される edge case では、
provenance read（元の acquisition owner がその ticket を引き続き read
できる data boundary）により、現行実装は accept 前の非開示 semantics を
満たしません。この edge case を除く通常の transfer 経路では非開示は
成立しています。gap の解消は別途 bounded implementation task で扱います。

calendar上のSaturday/Sunday/Japanese holiday presentationのsemanticsも
`docs/ux-ui.md` で承認済みですが、対応するUIはまだ実装されていません。
occurrence-level participation / invitation と ticket acquisition /
ticket / ticket transferはいずれもschema/RLS baselineのみ成立済みで、
UI journeyは未実装です。いずれも次節のMVP personal planning
capabilityの中で実装します。

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

- **occurrence-level participation / invitation** — ユーザーごとの
  occurrence参加予定管理と、そこからのinvitation（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）。persistence / RLS baselineは Completed baseline のとおり成立
  済みで、残るのはUI journeyです。
- **ticket acquisition / ticket** — チケット入手情報とticketの管理、
  ticket transferを含む（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）。persistence / RLS baselineは Completed baseline のとおり成立
  済みで、残るのはUI journeyです。
- **calendar weekday / Japanese holiday presentation** — Saturday/
  Sunday/Japanese holidayのglobal calendar presentation（詳細は
  [`docs/ux-ui.md`](./ux-ui.md) 参照）
- **expense / budget** — event単位の支出と横断的な予算管理（semanticsは
  未確定）

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
- sign-in provider / production hosting provider
- 家族・友人への本格展開時期
