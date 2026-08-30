# stage-tracker product rules

これは `reitojike/stage-tracker` の canonical product rule source です。
`reitojike/stage-tracker-old` は historical evidence に過ぎず、この source を
上書きしません。product semantics はここで再承認したものだけを記載します。

このファイルは承認済みの product semantics を記載します。記載されている
semantics が schema / RLS として実装済みであるとは限りません。実装状況は
`docs/prd.md` の Current committed scope と `docs/roadmap.md` の
Completed baseline を参照してください。

## Event catalog

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
  します。
- UI では中止状態が「中止」として表示されます。
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

- participation の対象は **公演回（occurrence）単位** です。event 単位の
  participation は持ちません。
- MVP の participation status は `considering` / `attending` のみです。
  `not_attending` は MVP の persistence へ含めません。row が存在しないことと
  `not_attending` を別々に二重化しません。
- participation visibility の default は `private` です。
  - `private` = 本人のみ
  - `public` = authenticated users 全員
- participation と TicketOpportunity の personal planning state
  (`planned`/`applied`) は独立した concept とし、一方から他方の status を
  自動変更しません。
- event-level の「興味がある / 行きたいが回未定」という intention は
  participation へ混ぜず、扱う場合は別途評価します（現時点は Deferred）。

## Authenticated-user targeting（identity boundary）

- MVP で他の authenticated user を明示指定する operation（Invitation の
  invitee 指定、personal schedule sharing の recipient 指定）は、相手の
  **Stage Tracker 登録 email address の exact input** で行います。
- raw internal user UUID を user-facing input として要求しません。
- generic user directory / user list は提供しません。autocomplete /
  partial-match search / fuzzy search も提供しません。
- client-readable な generic `email -> user_id` lookup API は提供しません。
  `auth.users` 等の privileged identity data を normal client から broad
  read 可能にはしません。
- email → internal user id の resolution は、trusted DB/server boundary
  内で operation-specific に行います（例: `security definer` な RPC が
  当該 operation の権限確認を行った後にのみ resolve する）。generic な
  reusable lookup surface は作りません。
- 未登録 email への external email delivery / pending account invitation /
  contact system は MVP scope に含めません。
- この identity boundary は operation ごとに opacity 要件が異なり得ます。
  Invitation は invitee の private participation state を inviter へ
  開示しないための opacity を維持します（下記 Invitation 節）。personal
  schedule sharing にはそれに相当する第三者 private state がないため、
  対象 email が未登録であることをその operation の呼び出し元（= owner
  本人）へ知らせて構いません（下記 Event-independent personal schedule
  節）。
- reusable な profiles / people / social subsystem は先行構築しません。

## Invitation

Issue #225/#230 で pending-only coordination へ収束しました。以下が現行の
canonical semantics です（#30 時点の旧 semantics — auto-considering の作成、
decline 後の re-invite 恒久拒否 — は supersede 済みです）。

- invitation の対象は **公演回（occurrence）単位** です。event 単位の
  invitation は持ちません。
- Invitation は **未回答の招待という temporary coordination state だけ** を
  表します。durable な accepted/declined history は保持しません。
- invite できるのは、対象 occurrence で participation status が
  `attending` の user だけです。`considering` の user は invite できません。
- event owner であることは invite eligibility を与えません。owner でも
  対象 occurrence で `attending` でなければ invite できません。
- invite 時の invitee 側 participation の扱いは、invite 対象 occurrence
  における invitee の現在状態ごとに次のとおりです。
  - participation row なし → pending invitation を作成します。invitee の
    participation は作成・変更しません（旧 `considering` 自動作成は廃止）。
  - 既に `considering` → pending invitation を作成し、`considering` を
    維持します。participation は変更しません。
  - 既に `attending` → その occurrence への invite 対象外とします。
    invitation record を新規作成せず、既存の `attending` participation
    をそのまま維持します（current opacity boundary を維持）。
- invitation operation によって、invitee 本人が確定した participation
  status（`attending`）を `considering` へ降格させることはありません。
- inviter が invitee を `attending` へ確定させることはできません。
- **Accept（参加する）**: invitee が pending invitation に対して「参加する」
  を選択した場合、通常の participation write（`considering`/rowなし →
  `attending`）と全く同じ operation を行います。専用の accept RPC は
  持ちません。結果として成立する `attending` Participation は
  self-created attending とデータ上区別しません。`participation_source` /
  `invited_by_user_id` / `accepted_at` / invited 専用 status 等の
  origin/history field を Participation へ追加しません。
- **Generic attending convergence**: invitee が Invitation UI 以外の通常
  participation UI から `attending` になった場合も、同一 occurrence /
  invitee に残る pending invitation はすべて解消します。同一 occurrence /
  invitee に複数 inviter からの pending invitation が存在できる現行
  schema では、attending 成立時に未解決 pending invitation を全て解消
  する方向を default とします。
- **Decline（参加しない）**: invitee が「参加しない」を選択した場合、
  pending invitation を解消（削除）します。`not_attending` Participation は
  作りません。invitee に既存の self-created `considering` がある場合は
  変更しません。decline は invitation へのresponseであり、invitee 自身の
  別途存在する participation intention を勝手に変更しません。
- **Re-invite**: 過去の decline を永久 opt-out として扱いません。invitee が
  現在 `attending` でなければ、後日同じ inviter が再度 invite でき、新しい
  pending invitation を作成できます。accept 後に invitee 本人が withdraw
  した場合も、将来の re-invite を永久に block しません。
- invitation は participation とは別の、最低限の独立 record です。resolve
  （accept/decline/generic attending convergence のいずれか）された
  invitation row は削除され、durable な accepted/declined history として
  保持しません。「誰が誰をどの occurrence へ招待したか」は resolve される
  までの pending 期間中のみ確認できる data boundary です。
- invite 操作の結果は inviter に対して不透明です。対象 occurrence における
  invitee の現在状態（上記 3 分岐のどれが実行されたか）を inviter へ開示
  しません。invitee の private な participation status を、invite 操作の
  結果から間接的に推測できる経路を新たに開かないためです。
- invitation record の通常 read は invitee 本人に限定します。inviter は、
  自分が作成した invitation であっても、通常 read で対象 invitee 向けの
  invitation row の有無を確認できません。row の有無が観測できると、上記の
  opacity と同じ情報が別経路から復元できるためです。
- inviter 向けの invitation history 表示は MVP committed scope に含みません。
  必要になった時点で、上記の opacity / read boundary を壊さない形で別途
  設計します。
- invitee 指定は「Authenticated-user targeting」節のとおり exact 登録
  email input です。email から invitee を resolve した後の 3 分岐
  dispatch・opacity 要件は上記と同一で、resolution を追加したことを
  理由に緩めません。「no such account」を含む invitee-dependent な分岐は
  すべて同一の結果を返し、inviter からは区別できません。
- Invitation semantics（pending-only への収束を含む）は、他の ticket
  planning state や将来の詳細な application tracking とは独立して決定
  します。

## Event-independent personal schedule

- event とは独立した personal schedule concept を持ちます。単純な
  `blocked` boolean にはしません。
- all-day / multi-day all-day / time-bounded の schedule を表現できます。
- schedule entry は固定 category を持たず、required free-form `title`
  （件名）を持ちます（Issue #121。旧 `paid_leave` / `work` / `travel` /
  `other` の closed schedule type vocabulary を supersede）。
- 各 entry は独立した `blocking` boolean を持ちます。
  - `blocking = true`: この時間には event 予定を入れたくない/availability
    上予定ありとして扱います。
  - `blocking = false`: schedule/calendar には表示しますが availability
    を block しません。
  - `blocking` は entry 本体の属性であり、share 先にも同じ semantics で
    伝播します。per-recipient の blocking override は設けません。
- schedule entry の作成者が owner です。
- default は private（owner 本人のみ）です。
- owner は entry 単位で authenticated user を明示指定して共有できます。
  共有は approval flow を持たず、owner が共有した時点で即時反映します。
- 共有された schedule は、その entry の `blocking` 値どおりに共有先 user
  の calendar / availability へ反映されます（blocking entry は共有先でも
  block 対象、non-blocking entry は共有先でも表示のみで block 対象には
  なりません）。
- 共有先 user は schedule 本体を編集できません。また、他の共有相手を
  追加・削除できません。共有相手の追加・削除は owner だけが行えます。
- 共有先 user は自分自身をその共有 schedule から外せます（entry 全体の
  削除とは独立した operation - 「Entry deletion semantics」参照）。
- MVP では共有先 user に busy-only ではなく、schedule の通常表示内容を
  見せます。
- collaborative editing、field 単位の privacy、共有相手ごとの権限差は
  Post-MVP です。
- recipient 指定は「Authenticated-user targeting」節のとおり exact 登録
  email input です。未登録 email への pending/external share は作成せず、
  この operation は対象 email が未登録であることを owner へ知らせて
  構いません（Invitation の opacity 要件とは異なります。理由は
  「Authenticated-user targeting」節を参照）。
- owner は、自分が recipient 管理権限を持つ schedule entry について、
  実際に share 済みの recipient を email で識別できる bounded read
  projection を持ちます。これは global user directory ではなく、その
  owner が管理する既存 share relation に限定されます。non-owner /
  unrelated user はこの projection を読めません。

### Entry deletion semantics

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

## Ticket model removal

従来の acquired-ticket inventory / assignment / ownership transfer model は、
Issue #225 の product simplification を受けた Issue #234 で current schema と
runtime から撤去しました。これは現行の product concept ではありません。

将来、詳細な申込管理や inventory が必要になった場合は、TicketOpportunity
を前提に新しい bounded product Task として再設計します。この文書は旧モデルの
status、assignment、provenance、transfer lifecycle を current behavior として
再承認しません。

## Ticket Opportunity（Ticket planning MVP）

Issue #157 で確定した、現行 MVP の canonical ticket journey です。目的は
「いつ、何の抽選・先行・販売開始があるのかを漏らさず見られる」ことに
限定され、full Ticket inventory / detailed application tracking では
ありません。これは現行の Ticket planning における唯一の canonical model
であり、詳細な申込管理や inventory はこの scope に含めません（Issue #162）。

### TicketOpportunity — shared

- 抽選・先行・一般発売等、Event に対する 1 つの販売機会を
  `TicketOpportunity` として扱います。
- 必ず 1 つの Event に属し、1 Event に複数 Opportunity を許容します。
- source 上の display name をそのまま保持し、`FC先行` 等の source 固有
  名称を premature な closed enum へ潰しません。
- Event 自身の source とは独立した source provenance（source key /
  source URL）を持てます。source URL 単体を identity にしません
  （1 ページに複数 Opportunity が掲載される source が実在するため）。

### Target scope — shared

- Opportunity の対象は次のどちらかを曖昧なく表現します。
  - Event 全体（`event_wide`）
  - selected Occurrences
- `event_wide` は Event 全体という semantic fact であり、その時点で
  存在する Occurrence 一覧の snapshot へ暗黙変換しません。
- selected Occurrences の場合のみ、Opportunity ↔ Occurrence の関連を
  explicit に保持します。1 Opportunity は複数 Occurrence を target
  できます。
- selected target の Occurrence は、必ずその Opportunity の Event に
  属していなければなりません。

### Milestone — shared

- Opportunity について、少なくとも次の semantics を扱います:
  application open / application close（deadline）/ result announcement /
  sale start / payment・settlement window。
- date-only（時刻不明）/ exact datetime / window の 3 種類の precision を
  区別して保持し、source が与えていない時刻を補完しません
  （例: date-only を `00:00` timestamp へ fake 変換しない）。
- source に存在しない milestone（未公表の result date、実施されない
  conditional phase 等）は、行を作らないことでそのまま表現します。
  「不明」を表す特別な値は持ちません。

### UserTicketOpportunityState — personal

- personal planning state の MVP status vocabulary は exactly
  `planned`（申し込む予定）と `applied`（申し込み済み）です。
- row が存在しない = その Opportunity を personal planning 対象として
  登録していない、という意味です。actual application record では
  ありません。
- 第 1〜第 N 希望・枚数・席種・実際の申込内容・当落詳細・acquired
  Ticket は、この record に含めません。
- owner 本人だけが read/write できます。user × opportunity の state は
  一意です。

### Shared / personal authority boundary

- TicketOpportunity / target scope / milestone は shared catalog data
  です。authenticated user は read できますが、ordinary authenticated
  user 向けの shared schedule 直接 mutation UI/API は現行 MVP に
  ありません。
- shared data の write path は、operator-assisted import が consume
  する service/operator boundary（`import_ticket_opportunity`）だけです
  （import 実装自体は Issue #163 の scope）。
- official/shared data の create/update は `planned`/`applied` を勝手に
  作成・変更・削除しません。

### Participation independence

- Ticket planning state（`planned`/`applied`）と participation
  （considering/attending）は完全に独立です。一方から他方を暗黙で
  作成・変更しません。

### Scope boundary

- TicketOpportunity と UserTicketOpportunityState は、販売機会の発見と
  personal planning state（`planned`/`applied`）だけを表します。
- 実際の申込内容、希望順位、枚数、当落、seat、inventory、ownership
  transfer はこの model に追加しません。必要になった場合は、別の bounded
  product Task で TicketOpportunity を前提に設計します。

## Catalog classification / venue boundary

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

## MVP Event catalog write boundary

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

### Post-MVP governance gate

- Administrator 以外へ Event create 権限を広げる場合、作成された Event が
  実在する shared catalog entry として妥当か確認する verification /
  moderation mechanism を、権限拡大の prerequisite として同時に設計します。
- 一般 user への create 権限だけを verification なしで先行開放しません。
- Administrator approval・公式/販売元 source 確認・trusted creator 等の
  exact workflow は、その拡大を扱う Post-MVP product checkpoint で決めます。
- 上記 verification status 等の schema を、将来可能性だけを理由に MVP へ
  先行追加しません。

## 時刻・タイムゾーン

- product 上の日付境界は `Asia/Tokyo` です。
- persisted timestamp は PostgreSQL `timestamptz` です。

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
- PWA scope
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
