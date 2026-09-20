# stage-tracker temporary static product rules

これは `reitojike/stage-tracker` の、まだ Living Spec へ移行していない domain
向けの temporary static product authority です。`reitojike/stage-tracker-old` は
historical evidence に過ぎず、この source を上書きしません。product semantics
はここで再承認したものだけを記載します。

このファイルは外部 Foundation checkout から sync / regenerate する配布物では
ありません。domain の current behavior を Living Spec へ移行した後は、対象
sectionをここへ再掲しません。

このファイルは承認済みの product semantics を記載します。記載されている
semantics が schema / RLS として実装済みであるとは限りません。実装状況は
`docs/prd.md` の Current committed scope と `docs/roadmap.md` の
Completed baseline を参照してください。

## Event / Occurrence lifecycle — CURRENT-SPEC005

Event / Occurrenceの現行product authorityは引き続き
[`specs/005-event-occurrence-lifecycle/spec.md`](../specs/005-event-occurrence-lifecycle/spec.md)
です。このファイルでは、その現行semanticsを再掲せず、必要な旧承認内容と実装判断は
下記の `HISTORICAL` / `STRUCTURE-MECHANICAL` sectionに限定して保持します。
Catalog classification / venue boundaryは別topicであり、#564完了までは
`CURRENT-OTHER-TOPIC` の専用sectionをtemporary current authorityとして参照します。

## Event / Occurrence implementation boundary — STRUCTURE-MECHANICAL

Event / Occurrenceのschema、RLS、RPC、runtime、test、migrationおよびwrite boundaryの
機械的な実現は、それぞれのsourceとarchitectureが担います。このファイルの旧実装判断は
current implementation authorityではありません。

## Event / Occurrence provenance — HISTORICAL

以下はcutover前の承認内容・実装判断を追跡するためのhistorical / supporting provenance
です。現行Event / Occurrence semanticsの正本としては使用しません。

- Event 情報は authenticated users 間の共有 catalog です。anonymous user は
  catalog を閲覧・変更できません。
- per-user の participation / expense、および TicketOpportunity の personal
  planning state は event catalog とは分離した concept として扱います。
- Event owner は情報管理者です。owner であることは participant / organizer /
  inviter であることを意味しません。

### Event と公演回

- catalog は **event**（公演・催しそのもの）と、その配下の **公演回** を別の
  概念として扱います。
- 公演回は必ずいずれかの event に属し、event から独立して存在しません。
- 単発の公演は「公演回が 1 件の event」として表します。単発のための別概念は
  設けません。
- event は 0 件の公演回を正当な状態として持てます（Issue #87）。開催期間
  だけが公表されていて具体的な公演回がまだ発表されていない event を表す
  ためです。詳細は「Event 開催期間（Event range）」節を参照してください。

### 公演日程

- 公演回の開演日時（starts_at 相当）と終演日時（ends_at 相当、nullable）に
  加えて、開場日時（doors_at 相当、nullable）を持ちます。詳細は「開場 /
  開演 / 終演」節を参照してください。
- 終演時刻は不明な場合があり、未設定を正当な状態として扱います。未設定を
  「当日中に終わる」等の既定値へ暗黙に変換しません。
- 同一日に複数回の公演がある場合は、その日に複数の公演回が存在するものとして
  表します。1 日あたりの公演回数が event 内で一定である必要はありません。
- 同一 event 内に、開始日時が同一の公演回を複数持つことはできません。公演回は
  その event の中で開始日時によって一意に識別されます（Issue #79）。これは
  壁時計表記ではなく instant（絶対時刻）の一意性です。
- 同一会場・同一時刻に並行する複数公演は、現 model では会場が event-level 情報
  であるため別 event として表現します（公演回ごとに会場が変わる興行の扱いは
  引き続き未決定です）。occurrence-level の分類（部 / room / 貸切区分等）を
  将来導入する場合、この一意性の単位を再評価します。
- 公演期間（初日〜千秋楽）は公演回から導出する派生情報ではなく、event が
  持つ独立した first-class data（Event range）です。詳細は「Event 開催期間
  （Event range）」節を参照してください（Issue #87。#13 で確定した「公演期間
  は公演回からのみ導出する」ルールを明示的に上書きします）。
- 「Event range 内で公演回が存在しない日 = 休演日」という解釈は廃止します。
  0 件の公演回を持つ event を許容したことで、未発表・貸切（意図的に
  user-actionable な公演回として取り込まない）・import 未取込等、公演回が
  存在しない理由が複数あり得るためです。休演日のための専用概念は設けません。

### Event と公演回の情報境界

- event が持つのは、興行そのものの識別情報（title / 会場 / 参照 URL /
  memo）、owner、および必須（not null）の Event range（starts_on / ends_on）
  です。
- 公演回が持つのは、その回の開場日時・開演日時・終演日時です。
- 会場は event の情報として扱います。公演回ごとに会場が変わる興行の扱いは、
  その need が出た時点で再評価します。

### Event 開催期間（Event range）

- Event は `starts_on` / `ends_on` 相当の calendar date range を
  first-class data として持ちます（Issue #87）。公式に公表された「初日〜
  千秋楽 / 開催期間」という product fact を表し、公演回集合から自動導出
  しません。
- starts_on / ends_on は必須（not null）です。event は Event range が
  確定して初めて catalog へ登録できます。開催期間そのものが未公表の
  event を表現する手段は、この need が出た時点で別途評価します（現時点は
  「まだ決めていないもの」に残る未決事項です）。
- starts_on / ends_on は `Asia/Tokyo` の calendar date で、両端 inclusive
  です。single-day event は starts_on = ends_on とします。`starts_on <=
ends_on` は application-side validation だけでなく DB level でも
  enforce する product invariant とします（enforcement mechanism は
  実装 Task で選定します）。
- Event range 内に公演回が存在しない日があっても構いません（前節のとおり、
  これを休演日とは解釈しません）。
- 公演回の日付は、それが属する event の Event range 内に収まっていなければ
  ならない product invariant とします。この invariant は公演回の開演日時
  （starts_at）の `Asia/Tokyo` calendar date を基準とします。開場日時
  （doors 相当）や終演日時（ends_at）が日付をまたいでも、それらは range
  判定の対象に含めません。この整合性は application-side validation だけ
  でなく DB level でも enforce します。具体的な enforcement mechanism
  （CHECK constraint / trigger 等）は、現行 schema に適した方法を実装
  Task で選定します。
- event は 0 件の公演回を持てます（「event は少なくとも 1 件の公演回を持つ」
  という既存 invariant を緩和します）。開催期間（Event range）は判明して
  いるが具体的な公演回がまだ発表されていない event を表すためです。
- 0 件の公演回を持つ event の作成は、designated catalog creator による
  通常の event 作成経路と、operator による catalog import 経路の両方で
  許可します（Issue #87）。公式スケジュールでも、開催期間だけが先に発表され
  具体的な公演回情報が後から追加されるケースは import 対象の興行でも
  起こり得るため、import 経路だけ occurrence 必須のままにする理由が
  ないと判断します。
- 0 件の公演回を持つ event は catalog へ即座に可視化します。「この期間に
  この公演があるので予定を空けておきたい」という日程確保情報として、
  shared planning surface 上で positive な価値を持つと位置づけます。
- catalog へ既に登録済みの（import 済みを含む）既存 event の Event range
  は、その event が持つ既存公演回の min/max から機械的に backfill して
  よい方向とします。ただし機械的 backfill 値を常に公式 Event range と
  同一とはみなしません。現行 import では貸切等を公演回として取り込まない
  ケースがあるため、必要な event については公式情報と照合して starts_on /
  ends_on を補正します。destructive reset は不要です。

### 開場 / 開演 / 終演

- 公演回の開演日時は明確に「開演時刻」を意味します（starts_at 相当）。
- 開場日時（doors_at 相当。column 名は実装 Task で選定）は nullable です。
  開場時刻が未公表の場合を正当な null として扱います。値が設定されている
  場合、`doors_at <= starts_at` は application-side validation だけでなく
  DB level でも enforce する product invariant とします（enforcement
  mechanism は実装 Task で選定します）。
- 終演日時（ends_at 相当）は引き続き nullable です。既存 semantics を
  維持します。値が設定されている場合、`starts_at <= ends_at` は
  application-side validation だけでなく DB level でも enforce する
  product invariant とします（Issue #46。enforcement mechanism は実装
  Task で選定します）。
- 以上により、値が設定されている日時の間には `doors_at <= starts_at <=
ends_at` という順序 invariant が成立します。doors_at / ends_at はいずれも
  独立に null になり得るため、null な項は比較の対象外です。

### Catalog の日程参照要件

- 指定した期間（例: ある月）に公演回が存在する event を引けます。
- ある日を指定して、その日に公演回がある event と、その日の公演回の時刻を
  引けます。
- ある event について、その公演回を日時順に引けます。
- 期間内であっても公演回が存在しない日は、その日の結果に現れません。
- 指定した期間と Event range が重なる event は、公演回の有無にかかわらず
  引けます。これは公演回ベースの上記参照要件とは独立した、Event range
  ベースの参照要件です。0 件の公演回を持つ event の日程確保情報としての
  可視化（前節参照）は、この参照要件によって成立します。

### 分類

- catalog を関心のある分類で絞り込みたいという requirement があります。
- 分類の boundary（event-level であること、複数 event へまたがる
  classification mechanism の方向性、persistence/filter UI の扱い）は
  下記「Catalog classification / venue boundary」を正本とします。

### Ownership

- event を作成した authenticated user がその event の owner になります。
- owner だけが event 情報を更新できます。non-owner は更新できません。
- owner transfer は product operation として提供しません。owner 自身であっても
  owner を別 user へ変更することはできません。
- event の作成者と、最終的に persist される owner は一致していなければ
  なりません（owner spoofing は不可）。

### 公演回の管理権限

- 公演回に独立した owner の概念は設けません。公演回の管理権限は、その
  公演回が属する event の owner から派生します。
- authenticated users は、shared event catalog の一部として公演回を閲覧
  できます。
- 公演回を作成できるのは、その公演回が属する event の owner だけです。
- 公演回を更新できるのは、その公演回が属する event の owner だけです。
- 公演回を別の event へ付け替える operation は提供しません。公演回がどの
  event に属するかを、通常の更新操作で変更できるようにはしません。
- 公演回の削除は owner-only の hard delete として提供します（Issue #124）。
  削除は誤登録の除去を対象とし、公演の中止（cancellation）とは区別されます
  （Issue #123 で decision 済み、Issue #125 で実装済み）。詳細は下記
  「Deletion」と「Cancellation」セクションを参照してください。

### Mutable / system-managed fields

- owner が変更できるのは event の記述情報（例: title / venue / 参照 URL /
  memo）、Event range（starts_on / ends_on）と、その event の公演回の
  日時です。
- record の識別子・作成日時・owner とレコードの更新日時は system-managed と
  し、normal な authenticated client から直接書き換えられる対象にはしません。
- 興行の延期・会期変更等、Event range と公演回の日付を両方とも新しい期間へ
  移す正当な owner 操作を、範囲外整合性 invariant が恒久的に妨げてはなり
  ません。immediate な DB level enforcement のみを採用すると、range・
  公演回のどちらを先に更新しても一時的に invariant 違反になり得るため、
  こうした操作を実現できる write boundary（deferred constraint / 単一
  transaction での一括更新 RPC 等）を実装 Task で選定します。

### Deletion

- Event と Occurrence の hard delete は owner-only の操作として実装されます
  （Issue #124）。soft delete / trash / restore / 監査履歴は提供しません。
- Deletion は誤登録の除去を対象とし、公演の中止（cancellation）とは
  区別されます（詳細は下記「Cancellation」セクション参照）。
- **Occurrence 削除**:
  - owner のみが削除可能です。
  - `occurrence_participations` / `occurrence_invitations` のいずれか 1 件
    でも存在する場合は拒否されます。
    これらテーブルへの cascade は行いません。
  - 最後の Occurrence が削除された場合でも Event が 0-occurrence 状態に
    なることは valid です。
- **Event 削除**:
  - owner のみが削除可能です。
  - 0-occurrence Event は削除可能です。
  - child Occurrence が存在する場合、全 child が Occurrence 削除条件を
    満たす場合に限り、Event + 全 child が atomic に削除されます。
  - 1 件でも削除不可の child が存在する場合、Event 削除全体が拒否されます
    （部分削除は発生しません）。
  - user / cross-user downstream data（participation / invitation）への
    cascade delete は行いません。

### Cancellation

- 公演の中止（cancellation）は Deletion（誤登録削除）とは明確に区別された
  operation です。Issue #123 で semantics 決定済み、Issue #125 で実装済みです。
- cancellation state は **Event-level** と **Occurrence-level** の両方に
  独立して持たせます。
  - Event-level cancellation: その Event 全体を中止扱いにします。
  - Occurrence-level cancellation: 個々の Occurrence を中止扱いにします。
- **effective cancellation**（実質的に中止扱いとなる条件）は、Event が
  canceled、または当該 Occurrence 自体が canceled のいずれか（OR）です。
- Event の uncancel（中止解除）は、個別に canceled 状態の Occurrence の
  cancellation を解除しません。Occurrence-level の cancellation は Event
  の cancel/uncancel から独立して維持されます。
- owner が cancel / uncancel の両方を行えます。
- 中止によって既存の downstream data（participation / invitation）は保持
  されます。deletion のような cascade は
  行いません。
- effective cancellation 状態にある Event/Occurrence に対しては、新規の
  active action（新規 participation の attending 化、新規 invitation、
  新規 invitation 等）を拒否します。
- 既存 participation の withdraw（辞退）は、中止状態でも引き続き許可
  します。既存 `attending` participation の `considering` への降格も同様に、
  中止状態でも引き続き許可します（PO 判断、2026-09-10）。いずれも既存
  commitment を弱める・訂正する操作であり、新規の active action ではない
  ためです。
- UI では中止状態が「中止」として表示されます。上記の降格・withdraw は、
  write boundary の許可と一致させ、中止状態でも UI から常に到達可能に
  します（UI だけが write boundary の許可を隠す状態にはしません。PO 判断、
  2026-09-10）。
- 実装（Issue #125）は次のとおりです。
  - `events.canceled_at` / `event_occurrences.canceled_at`（nullable
    `timestamptz`、null = active）を cancellation state として持ちます。
    値の有無だけが product 上の意味を持ち、格納された正確な時刻自体には
    意味を持たせません。
  - owner-only の write boundary は、既存の owner-only RLS（`events_
update_own` / `event_occurrences_update_own`）に乗る通常の column-level
    UPDATE grant として実装します。cancel/uncancel 専用の RPC は設けません
    （downstream cascade を伴わない単一 column の可逆な書き込みのため）。
  - new active action の拒否は、`event_occurrences.canceled_at` と親
    `events.canceled_at` を読む共有 SQL 関数
    (`event_occurrence_is_effectively_canceled`) と、
    `occurrence_participations` の INSERT/UPDATE (`considering -> attending`
    のみ) trigger、`invite_to_occurrence` /
    `invite_to_occurrence_by_email` RPC 内の
    明示チェックとして DB level で強制します。拒否は application-defined
    custom SQLSTATE `90002` として表現します。

## Participation

Occurrence Participation の current product behavior は Spec Kit Living Specへ
cut overしました。canonical current contractは
[`specs/001-occurrence-participation/spec.md`](../specs/001-occurrence-participation/spec.md)
です。legacy domain authorityとして本ファイルに詳細 semanticsを再掲せず、
未移行domainの product rulesだけをここに保持します。

## Authenticated-user targeting（identity boundary）

Invitation の current product behavior、exact-address targeting、opacity、
pending list は [`specs/006-invitation-coordination-opacity/spec.md`](../specs/006-invitation-coordination-opacity/spec.md)
へ cut over しました。本ファイルは Invitation の current normative authority
ではなく、同Specを発見するための pointer と migration provenance だけを残します。

Personal Schedule sharing の recipient targeting は #565 のcutoverまで未移行
domain の責務として残ります。そこでも raw internal user UUID、generic user
directory、client-readable な generic email-to-user lookup surface、外部 email
delivery は提供しません。operation-specific な trusted boundary 内の resolution
と、Invitation とは異なる sharing-specific な未登録 email の扱いは、Schedule
sharing の bounded authority cutover で再確認します。
Personal Schedule sharing では第三者の private Participation state を扱わないため、
既存の owner 向け未登録 email の扱いは Invitation の opacity と同一視しません。
reusable な profiles / people / social subsystem は先行構築しません。

## Invitation（current authority retired）

Invitation の pending-only lifecycle、eligibility、receive / accept / decline、
re-invite、targeting、privacy / opacity は上記の Invitation Living Spec を参照して
ください。ここに旧semanticsを再掲せず、Issue #560 以前の設計・migration は
historical evidence として Git と既存の implementation artifacts に残します。

## Historical Personal Schedule lifecycle notes (not current authority)

Personal Schedule lifecycleの現行正本は
[`Personal Schedule lifecycle Living Spec`](../specs/007-personal-schedule-lifecycle/spec.md)
です。以下はcutover前の承認内容と実装判断を追跡するためのhistorical / supporting
provenanceであり、現行lifecycle semanticsの正本としては解決しません。

- eventとは独立したPersonal Schedule conceptです。
- all-day / multi-day all-day / time-boundedのscheduleを表現できます。
- schedule entryは固定categoryではなく、required free-form `title`を持ちます。
  旧来の固定種別vocabularyはhistorical evidenceとしてのみ扱います。
- entryは独立した`blocking` booleanを持ち、trueは空き時間として扱わず、falseは表示
  してもavailabilityをblockしない意味です。
- schedule entryの作成者がownerです。

### Historical Entry deletion notes (not current authority)

- Personal Schedule entry は、owner による hard delete を正式 operation
  として提供します（Issue #121）。soft delete / trash / restore /
  deletion history は導入しません。
- delete できるのは entry の owner だけです。shared recipient / それ以外
  の authenticated user / anonymous user は delete できません。
- entry 削除後は、owner・recipients 双方を含む全 user surface からその
  予定が消えます。
- entry に従属する `personal_schedule_shares` row は、entry 削除時に
  安全に cleanup され、orphan として残りません（DB level の
  `ON DELETE CASCADE`）。
- recipient の self-leave（自分自身をその共有 schedule から外す）は
  entry 削除とは独立した既存 operation であり、「そのrecipientからだけ
  消える」既存 semantics を引き続き維持します（entry 自体は owner・他の
  recipient に残ります）。
- Event / Event Occurrence の deletion/cancellation semantics とは性質が
  異なるため、この決定はそちらの scope へ影響しません。

## Personal Schedule sharing / recipient privacy (temporary authority until #565)

Personal Scheduleのsharing / recipient privacyは#565で専用Living Specへcut overするまで、
この節をtemporary product authorityとして扱います。#561のlifecycle Living Specは、この
sharing semanticsを吸収しません。

- entryはprivate by defaultであり、shareはentry単位かつrecipient単位のvisibility grantです。
- ownerだけがrecipientを追加・revokeできます。approval flowはなく、share成功後は即時に
  recipientのvisibilityが成立します。
- ownerは既存recipientをrevokeできます。revokeは対象recipientだけのvisibilityを失わせ、
  entry自体とowner・他のrecipientは維持します。これはentry deletionではありません。
- 共有先userはschedule本体を編集できず、他のrecipientを追加・削除できません。recipientは
  自分自身のshare relationだけをself-leaveのために扱えます。
- recipientのself-leaveは自分だけのshare relationとvisibilityを外すoperationであり、entry
  deletionではありません。durableなopt-out / decline historyは作らず、後から同じentryを
  再共有できます。
- ownerによるentry hard deleteはentry自体を削除し、全recipientからも消えます。
- recipient指定はAuthenticated-user targeting節に従うexact登録email inputです。raw internal
  UUIDをuser-facing inputにせず、generic user directory、generic autocomplete / fuzzy /
  partial search、generic client-readable email-to-user lookupは提供しません。resolutionは
  operation-specificなtrusted boundaryで行います。
- 未登録emailへのpending / external shareとexternal email deliveryは作成しません。ただし
  ownerへ対象emailが未登録であることを知らせるcurrent behaviorは許容します。これは
  Invitationのopacityとは異なり、Invitationのprivate Participation stateを開示するもの
  ではありません。既存のgeneric identity boundaryはAuthenticated-user targeting節を
  参照します。
- self-shareは作成しません。active shareはentry + recipient単位でset-likeに扱い、既に
  share済みのrecipientへのsupportedなshare operationはduplicate grantを作らずidempotentです。
- 共有されたscheduleはrecipientにもentry自身の通常表示内容を見せ、busy-only projectionには
  しません。entryのblocking semanticsはそのまま適用し、per-recipientのblocking overrideは
  設けません。
- ownerは自分が管理するentryについて、既存share済みrecipientをemailで識別できるbounded
  read projectionを持ちます。このprojectionはそのentryの既存share relationに限定され、
  global user directoryではありません。
- recipientはself-leaveに必要な範囲で自分のshare relationを扱えますが、他のrecipientを
  enumerateできません。unrelated / non-owner userもrecipient relationやownerのemail
  projectionをenumerateできません。
- normal detail readでは、existing-but-non-visible entryとnonexistent entryを区別させません。
  screen上の同一のempty outcome / copyはこのtemporary sharing/privacy authorityの表現です。

## Ticket model removal

従来の acquired-ticket inventory / assignment / ownership transfer model は、
Issue #225 の product simplification を受けた Issue #234 で current schema と
runtime から撤去しました。これは現行の product concept ではありません。

将来、詳細な申込管理や inventory が必要になった場合は、TicketOpportunity
を前提に新しい bounded product Task として再設計します。この文書は旧モデルの
status、assignment、provenance、transfer lifecycle を current behavior として
再承認しません。

## Ticket Opportunity（Ticket planning MVP）— CURRENT-PLANNING pointer

TicketOpportunity の current product behavior は、Issue #562 で作成した
[TicketOpportunity planning model Living Spec](../specs/008-ticket-opportunity-planning/spec.md)
が唯一のnormative authorityです。この文書の旧Ticket Opportunity節は、
inventory reportと実装へ辿るための historical / supporting provenance に
de-authorizeされ、current semanticsを定義しません。

timelineのrelevant date、cross-month window、ordering、month labelは
[Spec 003](../specs/003-ticket-opportunity-timeline/spec.md)のbounded authority、
Participationのlifecycleと直接の境界は
[Spec 001](../specs/001-occurrence-participation/spec.md)のauthorityです。
この文書はそれらのplanning semanticsを再掲しません。

旧acquired-ticket inventory / assignment / ownership transfer modelがcurrent
modelではないことは、上の「Ticket model removal」に残るhistoryです。将来の
詳細な申込管理をcurrent behaviorとして扱う場合は、TicketOpportunityを前提に
別のbounded product Taskで新たに定義します。

## Catalog classification / venue boundary — CURRENT-OTHER-TOPIC

このsectionはEvent / Occurrence lifecycleから分離されたCatalog classification / filter
topicのtemporary current authorityです。#564が完了するまでは、このsectionがgenre、group、
venue、facet、filter composition、option universe、filter persistenceのcurrent product
semanticsを保持します。

Issue #158（PO decision）により、Event Catalog classification / filter は
Post-MVP early から **Gate A pre-dogfood** へ promote 済みです。Issue #167
で persistence / operator import / typed read boundary を materialize
しました。このセクションは #158 の確定 semantics を canonical 化します。

### Genre

- genre は Event-level の情報です。公演回ごとに異なる genre を持ちません。
- Event の genre は Gate A では **0..1** です。classified な Event は 1 つの
  primary genre だけを持ちます。
- unclassified Event（genre なし）は valid です。「すべて」表示では見え、
  specific genre filter にはヒットしません。「その他 / 未分類」という
  fabricated classification は作りません。
- Gate A の canonical genre identity は次の 3 つです。
  - 宝塚（`takarazuka`）
  - 歌舞伎（`kabuki`）
  - アイドル（`idol`）
- 上記 3 genre を永久 closed world として固定しません。genre は
  canonical identity を持つ lookup data（UI string や DB enum ではなく、
  行として追加可能な table）として持続し、将来の genre 追加や
  cross-genre Event の具体的 need が出た場合の multi-genre 化を妨げません。
  ただし future-only な理由で multi-genre 用 many-to-many machinery を
  先行実装しません。

### Group

- 宝塚の「組」とアイドルの「グループ」は、同じ generic canonical group
  identity mechanism で扱います。`troupe` / `idol_group` 等の
  domain-specific column や、genre ごとの別 group table は作りません。
- group の identity は stable canonical identity + display name +
  Event association 程度に bounded です。alias / hierarchy /
  recommendation / social-follow 等の generic group platform は作りません。
  raw group color / visual cue の domain data も先行追加しません。
- Event と group の関連は **0..N** です。1 Event が複数 group と関連付け
  られ、合同 event / festival Event を複数 group association で表現
  できます。selected group が Event の groups のいずれか 1 つと一致すれば
  その group facet にヒットします（OR）。
- group は特定 genre へ hard-bind されません。canonical identity 自体は
  genre と無関係に持続し、「この genre に関連する group」は、その genre の
  Event に実際に associate されている group から動的に導出します。

### Venue

- 現行の `events.venue`（nullable text）を維持します。canonical venue
  identity / venue master は Gate A では作りません（Post-MVP early に
  据え置き）。将来 migration を避けたいという理由だけで venue master を
  先行実装しません。
- venue filter は `events.venue` の exact text match です。
- venue は歌舞伎専用の domain concept ではありません。Gate A の UI では
  歌舞伎だけが venue facet を有効にしますが、これは UI 上の構成であり、
  将来他の genre（例: 宝塚）で venue facet を有効にすることを domain は
  妨げません。

### Facet model（genre ごとに有効な secondary facet）

- genre / group / venue は独立した semantic dimension です。共通の
  filter model の中で、選択中の genre ごとに「現在有効な facet」を
  切り替えます。これは domain 上の hard restriction ではありません。
- Gate A の facet 構成:
  | genre    | active facet | UI label |
  | -------- | ------------ | -------- |
  | 宝塚     | group        | 組       |
  | 歌舞伎   | venue        | 会場     |
  | アイドル | group        | グループ |
- 将来、宝塚に venue facet を追加して `genre = 宝塚 AND group IN (星組)
AND venue IN (東京宝塚劇場)` のように拡張することを、この facet model は
  妨げません。

### Filter semantics

- top-level genre は single-select です（「すべて」を含む）。
- 同一 facet 内の複数 selection は OR です（例: `group IN (月組, 星組)`）。
- 複数 facet が active な場合は AND です（例:
  `genre = 宝塚 AND group IN (星組)`）。
- facet について、何も選択していない場合と、catalog 全体の known option
  を全選択している場合は、どちらも「その facet では絞り込まない」と
  解釈します。
- explicit な classification が無い Event を推測で hit させません
  （unclassified Event は specific genre filter に非ヒット、group 未
  associate の Event は group filter に非ヒット、venue が null または
  不一致の Event は venue filter に非ヒット）。

### Filter option universe

- secondary filter option は、表示中の月やその他の期間に限定されず、
  **catalog 全体で known な values** から構成します。月を移動しただけで
  option universe が変わることはありません。
- 件数表示は Gate A では不要です。

### Filter persistence

- Gate A では filter 選択状態を server-side user preference として
  persist しません。browser-local persistence で十分とし、その具体的な
  実装（localStorage key / versioning 等）は #147（Filter Sheet）の
  ownership とします。

### Import / write authority

- classification（genre 関連付け・group 関連付け）は shared Event
  catalog data です。authenticated user は read 可能ですが、ordinary
  authenticated user 向けの classification 編集 UI/API は Gate A に
  ありません。
- classification の write path は、既存の operator-assisted Event
  import flow（`docs/runbooks/catalog-import.md`）に統合された経路のみ
  です。Event owner を含む ordinary authenticated user は、通常の
  owner-authenticated write path からも classification を変更できません
  （classification 導入を理由に既存の shared catalog write authority を
  広げません）。
- 既存 Event への classification 付与は、machine heuristic（title や
  venue からの推測）による一括 backfill を行いません。genre / group が
  不明な既存 Event は unclassified のまま valid とし、必要な
  classification は operator-reviewed import seed から個別に追加します。

### Gate A から明示的に defer するもの

- ★ favorites（classification / group / venue に対する）
- Calendar Event range band への category / group short-label 表示
- classification-derived な color cue、raw color code の domain data
  persistence
- canonical venue master / venue alias 正規化
- multi-genre Event support（cross-genre Event の具体的 need が出るまで）
- occurrence-level classification
- group hierarchy / alias platform
- classification に対する recommendation / ranking

## Event write boundary provenance — HISTORICAL

Event作成・owner・Occurrence管理の現行capabilityは
[`specs/005-event-occurrence-lifecycle/spec.md`](../specs/005-event-occurrence-lifecycle/spec.md)
で定義します。以下はcutover前のMVP write boundaryに関するhistorical / supporting
materialです。ここを現行Event / Occurrence authorityとして使用しません。

- minimal な Event + occurrence の create/update UI を MVP へ含めます。
- shared catalog の read は引き続き authenticated users 全員へ維持します。
- MVP では Event の新規作成を一般 authenticated user へ開放せず、
  **designated catalog creator（Administrator）** だけに許可します。
  初期運用は Administrator 1 名で構いません。
- designated catalog creator が Event を作成した場合、そのユーザーが既存
  ownership semantics どおり event owner になります。
- Event update / occurrence create・update は引き続き event owner だけが
  行えます。
- deletion / cancellation は、この MVP write slice の対象外です。
- classification 入力・venue master をこの write UI と同時に追加しません。
- 「Administrator 1 名だけ」という運用を理由に、特定 user UUID を
  application code / migration へ場当たり的に hard-code しません。
  permission mechanism は、特定 UUID の hard-code でも generic な
  admin/role framework でもない、membership 単位の allowlist として
  確定しています。

## Post-MVP catalog governance — FUTURE-PLANNING

Post-MVPのbroader Event create permission、registration verification、moderationの
planning authorityは [Issue #232](https://github.com/reitojike/stage-tracker/issues/232)
です。以下は将来のproduct checkpointで扱う候補であり、current Living Spec behaviorや
現行のcreate capabilityには昇格しません。

- Administrator 以外へ Event create 権限を広げる場合、作成された Event が
  実在する shared catalog entry として妥当か確認する verification /
  moderation mechanism を、権限拡大の prerequisite として同時に設計します。
- 一般 user への create 権限だけを verification なしで先行開放しません。
- Administrator approval・公式/販売元 source 確認・trusted creator 等の
  exact workflow は、その拡大を扱う Post-MVP product checkpoint で決めます。
- 上記 verification status 等の schema を、将来可能性だけを理由に MVP へ
  先行追加しません。

## 認証: サインイン redirect の query string 境界（historical / supporting）

Authentication / account-access の現行 user/security semantics は
[`specs/009-authentication-account-access/spec.md`](../specs/009-authentication-account-access/spec.md)
が正本です。以下はcutover前の redirect boundary の判断と provenance を追跡する
ための historical / supporting materialであり、現行の認証・account-access
authorityとしては解決しません。provider / runtime mechanismは
[`docs/architecture/authentication.md`](../docs/architecture/authentication.md)を
参照します。

- 未認証 user を protected route から `/sign-in` へ default-deny redirect
  する際、元 URL の query string を無条件に転送しません（PO 判断、
  2026-09-10）。
- `error` / `requested` 等の Auth UI state は、それを発生させた Auth flow
  自身だけが明示的に付与します（例: 無効な magic link を検出した
  `/auth/confirm` 自身がその redirect で `error=link_expired` を付与する）。
  default-deny redirect が任意の外部 query を無条件で透過させる経路は
  持ちません。
- 将来 return-to（サインイン後に元のページへ戻す）を実装する場合も、
  「元 URL の query を丸ごとコピーする」実装は禁止します。導入するなら、
  許可された内部パスのみを受理する allowlist 検証付きの専用 parameter
  （例: 検証済み `return_to`）として個別に設計します。
- この境界が対象とするのは「protected route 経由の default-deny redirect
  が任意の query を forward すること」だけです。`/sign-in` 自体は未認証
  到達可能な public path であり、`/sign-in?error=...` を外部から直接
  踏ませるケースまでは対象にしません（`/sign-in` を到達不能にはできない
  ため、この経路は別の課題として残ります）。

## 時刻・タイムゾーン

- product 上の日付境界は `Asia/Tokyo` です。
- persisted timestamp は PostgreSQL `timestamptz` です。

## App delivery surface（installable standalone Web App）

Issue #304 で確定した、product が supported と認める起動経路です。ここで
決めたのは installability と standalone 起動までで、offline 動作は含み
ません。

- stage-tracker は browser で開く Web App であることに加えて、Android /
  iOS のホーム画面へ追加して **standalone Web App として起動できる**こと
  を supported な利用形態とします。
- installable であることと offline で動作することは別の概念として扱い、
  offline 対応を installable PWA の必須条件にしません。current scope で
  offline 動作は提供しません。
- installed app の identity（manifest の `id` / `start_url` / `scope`）は
  stable に扱います。route 変更等の実装都合でこれらを動かすと、既に
  install 済みの app が別 app として扱われ orphan になるためです。
- PWA の public resource（manifest / application icon）は未認証でも取得
  できます。install prompt は sign-in より前に評価されるためです。この
  公開は当該 resource の exact path に閉じ、authenticated application
  route の default-deny boundary を緩めません（実装詳細は
  `docs/architecture/authentication.md`）。
- Service Worker / offline cache / Web Push / background sync は current
  scope に含みません。用途が確定していない段階で空の Service Worker や
  cache strategy を先行導入しません。
- native 配布（TWA / Google Play / Capacitor / React Native）は current
  scope に含みません。

## 先行実装しないもの

- 将来用の invite approval states / `profiles.is_admin` 等を、「後で
  migration したくない」という理由だけで先行実装しません。
- 「Administrator 1 名だけ」という運用を理由に、特定 user UUID を
  application code / migration へ hard-code しません。
- classification / venue の verification status 等、Post-MVP でしか
  必要にならない schema を将来可能性だけを理由に先行実装しません。
- MVP 後の変更を不必要に阻害する不可逆 coupling は避けますが、将来可能性
  だけを理由にした speculative machinery も作りません。

## まだ決めていないもの

以下は関連する product task が起票されるまで、このファイルへ追記しません。

- Ticket の deletion / correction semantics
- Post-MVP の Event create 権限拡大に伴う verification / moderation の
  exact workflow
- budget 集計の期間基準
- canonical venue identity の具体形（Gate A では venue master を作らず
  exact text match のまま - 「Catalog classification / venue boundary」
  参照）
- 公演回ごとに会場が異なる興行の扱い
- 開催期間（Event range）そのものが未公表の event を表現する手段（Issue
  #87 では Event range を必須データとして確定したのみで、この状態は
  scope 外のまま）
- PWA の offline scope（offline read / offline write / page・data cache）。
  installability と standalone 起動は Issue #304 で確定済みのため、
  「App delivery surface」を参照してください。ここに残っているのは
  offline 側だけです
- Web Push notification の product scope（通知する対象・タイミング・
  subscription lifecycle）。Issue #304 の follow-up として別途扱います
- MCP product scope

## Supabase

- database development の source of truth は repository migrations です。
- development / schema / RLS / generated types / DB tests は local-first
  Supabase を使います。
- local で成立した後に新しい Supabase remote project を作成します。
- 旧 Supabase project は historical evidence / data reference に限り、新
  schema の authority にはしません。
- PR B の時点で、local Supabase 上の `events` migration / RLS / generated
  TypeScript database types / DB・RLS test が実際に導入済みです。
- remote Supabase project の provisioning は、local schema/RLS/types/test が
  成立した後の別 operational step として扱い、product task の merge gate には
  しません。
