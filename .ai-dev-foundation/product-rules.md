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
- per-user の participation / ticket acquisition / expense は event catalog
  とは分離した personal concept として扱います。
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
- 公演回の削除は現時点では提供しません。誤登録の除去と公演の中止を同じ
  semantics で扱ってよいか、personal な participation が公演回を参照する
  場合に削除が何を意味するか、そして event 自体の deletion semantics が
  いずれも未決定であるため、子概念の deletion semantics だけを先行して
  確定しません。論理削除や中止表現のための schema も先行実装しません。

### Mutable / system-managed fields

- owner が変更できるのは event の記述情報（例: title / venue / 参照 URL /
  memo）、Event range（starts_on / ends_on）と、その event の公演回の
  日時です。
- record の識別子・作成日時・owner とレコードの更新日時は system-managed と
  し、normal な authenticated client から直接書き換えられる対象にはしません。

### Deletion

- PR B の時点では event deletion を提供しません。存在する event row は
  すべて current catalog row として扱います。
- deletion semantics（論理削除の要否を含む）は、それを扱う専用の product
  task で別途決定します。「将来 migration したくない」という理由だけで
  deletion 用の schema を先行実装しません。

## Participation

- participation の対象は **公演回（occurrence）単位** です。event 単位の
  participation は持ちません。
- MVP の participation status は `considering` / `attending` のみです。
  `not_attending` は MVP の persistence へ含めません。row が存在しないことと
  `not_attending` を別々に二重化しません。
- participation visibility の default は `private` です。
  - `private` = 本人のみ
  - `public` = authenticated users 全員
- participation の intention/planning と ticket acquisition は独立した
  concept とし、ticket の結果から participation status を自動変更しません。
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

- invitation の対象は **公演回（occurrence）単位** です。event 単位の
  invitation は持ちません。
- invite できるのは、対象 occurrence で participation status が
  `attending` の user だけです。`considering` の user は invite できません。
- event owner であることは invite eligibility を与えません。owner でも
  対象 occurrence で `attending` でなければ invite できません。
- invite 時の invitee 側 participation の扱いは、invite 対象 occurrence
  における invitee の現在状態ごとに次のとおりです。
  - participation row なし → invitation を作成し、`considering`
    participation を作成します。
  - 既に `considering` → invitation を作成し、`considering` を維持します。
  - 既に `attending` → その occurrence への invite 対象外とします。
    invitation record を新規作成せず、既存の `attending` participation
    をそのまま維持します。
- invitation operation によって、invitee 本人が確定した participation
  status（`attending`）を `considering` へ降格させることはありません。
- `considering -> attending` への確定は invitee 本人だけが行えます。
  inviter が invitee を `attending` へ確定させることはできません。
- invitation は participation とは別の、最低限の独立 record を持ちます。
  少なくとも「誰が誰をどの occurrence へ招待したか」と「invitee が辞退
  したか」を後から確認できる data boundary を持ちます。
- invitee が辞退した場合、participation 側に `not_attending` を作るのでは
  なく、invitation lifecycle 側で decline を表現します。
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

## Event-independent personal schedule

- event とは独立した personal schedule concept を持ちます。単純な
  `blocked` boolean にはしません。
- all-day / multi-day all-day / time-bounded の schedule を表現できます。
- schedule type は MVP で `paid_leave` / `work` / `travel` / `other` の
  canonical vocabulary を持ちます。
- schedule entry の作成者が owner です。
- default は private（owner 本人のみ）です。
- owner は entry 単位で authenticated user を明示指定して共有できます。
  共有は approval flow を持たず、owner が共有した時点で即時反映します。
- 共有された schedule は、共有先 user の calendar / availability も
  block します。
- 共有先 user は schedule 本体を編集できません。また、他の共有相手を
  追加・削除できません。共有相手の追加・削除は owner だけが行えます。
- 共有先 user は自分自身をその共有 schedule から外せます。
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

## Ticket acquisition / Ticket

### Concept boundary

- **ticket acquisition** と **ticket** は別 concept です。
- ticket acquisition は申込・購入 attempt を表し、user-owned かつ
  occurrence-linked です。
- 同一 user / occurrence に複数の acquisition attempt を許容します。
- acquisition lifecycle の MVP canonical status は `pending` / `secured` /
  `unsuccessful` です。即時購入等は最初から `secured` として作成できます。
- `cancelled` / `withdrawn` / `refunded` 等は、具体的な need が出るまで
  MVP status へ先行追加しません。
- acquisition 単位の personal memo を持てる方向とします。

### Ticket

- ticket は secured な acquisition の結果として表現される、個別の
  ticket です。1 acquisition から複数 ticket を持てます。secured 時の
  確保枚数に応じて複数 ticket を持てる data boundary とします。
- seat number / queue number / ticket medium は ticket 単位の情報です。
  seat / queue が未判明でも ticket は存在できます。
- MVP の ticket medium は `paper` / `electronic` 相当です。コンビニ発券 /
  郵送 / 特定アプリ等の delivery / issuance method は、MVP では別
  vocabulary として先行固定しません。
- ticket は未割当でもよく、ticket の利用者・同行者を stage-tracker
  authenticated user であることを必須の紐付け対象にはしません。
  stage-tracker を利用していない外部同行者を表現できます。
- registered user への invitation と ticket assignment は独立した
  concept です。invite したことは ticket assignment を必須にしません。
  外部同行者へ ticket を割り当てるために account 作成を要求しません。
- ticket assignment は「誰が使う予定か」を表す情報であり、ticket の
  ownership transfer を意味しません。
- Ticket は secured な acquisition の結果であるという boundary を、作成後も
  保持します。child Ticket が存在する acquisition を secured 以外の status
  へ戻すことはできません。
- Ticket の deletion / correction semantics は未決定です。誤って secured に
  した、あるいは誤って Ticket を作成した場合の owner 向け訂正手段は、現時点
  では存在しません。訂正手段の提供には Ticket deletion semantics の決定が
  必要であり、この決定を待たずに訂正用の escape hatch をここで発明しません。

### Ticket transfer

- current ticket owner が明示的に transfer を開始します。
- transfer 先は、同じ occurrence へ invitation された registered user を
  MVP の eligibility とします。invitation を decline した invitee も、この
  eligibility を維持します（decline は transfer の acceptance を免除しま
  せん。acceptance 自体が必須であるため、decline した相手へ transfer が
  強制されることはありません）。
- recipient の acceptance を必須とします。accept 前は sender が transfer
  を取り消せます。
- accept 後は ticket の current owner / edit authority が recipient へ
  移ります。accept 後、sender が一方的に ticket を取り戻すことはできません。
- transfer 後も、元の acquisition との provenance（由来）関係は保持
  されます。acquisition owner は acquisition 自体を引き続き所有し、どの
  ticket を誰へ transfer したか確認できる data boundary を持ちます。
- transfer によって participation status を自動変更しません。
- transfer の宛先が eligible かどうかの判定は、sender 側から見て「対象
  occurrence へ invitation された registered user かどうか」を 1 bit
  観測させる side channel になります。これは MVP の accepted trade-off
  とします。これを隠すために invitation の read boundary を再び緩めたり、
  fake transfer を作らせたり、invitation の opacity semantics を変更する
  ことはしません。
- pending 状態の transfer offer は、recipient が accept するまで、前
  owner が設定していた assignment 情報（registered user assignee か
  外部同行者名かを含む）を recipient へ開示しません。

## Catalog classification / venue boundary

### Classification

- classification は event-level の情報です。公演回ごとに異なる
  classification を持ちません。
- 宝塚の「組」とアイドルの「グループ」を将来同じ classification
  mechanism へ載せられる方向とします。`troupe` / `idol_group` 等の
  domain-specific column を個別追加する方針にはしません。
- classification は filter key として使うため canonical identity を
  持てる方向とします。generic free-form tag だけを canonical filter
  identity にしません。
- 1 event に複数 classification value を許容できる方向とします
  （合同 event 等を阻害しません）。
- 組 color 等の visual cue は classification から UI role へ mapping する
  方向とし、raw color code を domain data として先行固定しません。
- classification の exact taxonomy・persistence・filter UI は Post-MVP
  early として扱います。

### Venue

- MVP では現行の `events.venue` text を維持します。
- canonical venue identity / venue master / venue filter UI は Post-MVP
  early として扱います。将来 migration を避けたいという理由だけで venue
  master を MVP へ先行実装しません。

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
- 分類 taxonomy の具体形（canonical identity の exact 語彙・単一選択か
  複数選択かの UI 表現等）
- canonical venue identity の具体形
- 「関心のある分類」を persistent な personal preference にするか、その場の
  filter に留めるか
- 公演回ごとに会場が異なる興行の扱い
- 公演回の deletion / 公演中止の表現
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
