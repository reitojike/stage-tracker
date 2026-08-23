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

calendar上のSaturday/Sunday/Japanese holiday presentationのsemanticsも
`docs/ux-ui.md` で承認済みですが、対応するUIはまだ実装されていません。
occurrence-level participation / invitationはschema/RLS baseline・typed
read/write boundaryに加え、MVP user-facing UI journeyも実装済みです
（Issue #36。event詳細画面からのconsidering/attending登録・切替・
participation解除、attending occurrenceからのinvite-by-email、
`/catalog/invitations`でのinvitee側一覧・decline）。招待の宛先選択は
上記「Authenticated-user targeting」節のとおり登録済みemail address
のexact inputで、`invite_to_occurrence_by_email`で解決します。

event-independent personal scheduleも同様に、schema/RLS baseline・typed
read/write boundaryに加え、MVP user-facing UI journeyが実装済みです
（Issue #37。`/schedule`での一覧、all-day・multi-day all-day・
time-boundedの作成/編集、owner向けrecipient追加/一覧/削除、shared user
自身によるself-remove）。recipient追加は上記「Authenticated-user
targeting」節のとおり登録済みemail addressのexact inputで、
`share_schedule_entry_by_email`で解決します。owner向けrecipient一覧は
`list_schedule_share_recipient_emails`が返す、そのentryに実際にshare
済みのrecipientのみのbounded projectionです。

ticket acquisition / ticket / ticket transferはschema/RLS baselineとtyped
read/write boundaryのみ成立済みで、user-facing UI journeyは次節のMVP
personal planning capabilityの中で実装します。

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

- **ticket acquisition / ticket** — チケット入手情報とticketの管理、
  ticket transferを含む（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）。persistence / RLS baselineとtyped read/write boundaryは
  Completed baseline のとおり成立済みで、残るのはuser-facing UI
  journeyです。
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
