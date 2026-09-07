# oracle: domain（v2 `packages/domain` 設計のための現行仕様）

本書は `docs/v2/README.md` が定める oracle documentation の一つです。対象は
`src/domain/**`・`src/infrastructure/**`・`src/pwa/**`・`scripts/**`
（このコミット時点の `main` 相当のワーキングツリー）。v2 の `packages/domain`
はここに書かれた仕様だけを見て再実装します。現行コードは移植元ではなく
「正しい振る舞いを確認する対象（oracle）」であり、本書はその読み取りです。

表記関する注意:

- 「確認できない点」は明示的に「未確認」と書きます。特に、DB migration
  そのもの（`supabase/migrations/**`）は本 Task のスコープ外として読んで
  おらず、SQLSTATE・RPC 引数名・trigger 名は `src/infrastructure/supabase/**`
  のコメントから間接的に確認したものです。migration 本体との整合は
  別途 oracle-db.md 相当のドキュメントで確認してください。
- 本書が記述する semantics の canonical source は
  `AGENTS.md`（Foundation 生成物、Consumer product rules を含む）です。
  本書はそれをコード実装のレベルまで具体化したものであり、矛盾する場合は
  `AGENTS.md` を正とします。

---

## 1. ドメインモデル

### 1.1 Event（興行）

- 定義: 公演・催しそのもの。shared catalog data（authenticated users 全員が
  read 可能）。
- 属性:
  - `id`（UUID）
  - `ownerId`: 作成者。owner だけが update/delete/cancel できる。owner
    transfer は存在しない（`owner_id` に UPDATE grant がない）。
  - `title`（必須文字列）
  - `venue`（nullable 文字列。Gate A では canonical venue master を持たず
    exact text）
  - `sourceUrl`（nullable。http/https のみ表示上リンク化可能 -
    `isRenderableHttpUrl`）
  - `memo`（nullable 自由記述）
  - `startsOn` / `endsOn`（**Event range**。Asia/Tokyo calendar date
    "YYYY-MM-DD"、両端 inclusive、必須・not null。`startsOn <= endsOn` を
    DB level でも enforce）
  - `canceledAt`（nullable timestamptz。null = active）
  - `createdAt` / `updatedAt`（system-managed）
  - `source_key`（import 冪等性キー。authenticated client に INSERT/UPDATE
    grant なし。operator import 専用）
  - classification（後述 Genre/Group、0..1 と 0..N）
- 関係:
  - 1 Event : 0..N Occurrence（0 件も正当。Event range だけ確定していて
    具体的な公演回が未発表の状態を表す）
  - 1 Event : 0..1 Genre、0..N Group
  - 1 Event : 0..N TicketOpportunity
- ライフサイクル:
  - 生成: `create_event` RPC 経由のみ（designated catalog creator のみ、
    owner_id はサーバー側で caller から導出）、または operator import
    RPC（`import_event_with_occurrences`）。
  - 更新: 記述フィールドは owner のみ通常 UPDATE。Event range の変更は
    `reschedule_event` RPC 経由（後述 3.1）。
  - Cancel/Uncancel: owner のみ、`canceled_at` の単純な列更新（RPC 不要）。
  - 削除: owner のみ、hard delete RPC（`delete_event`）。child Occurrence
    が全て削除可能な場合のみ atomic に削除。

### 1.2 Occurrence（公演回）

- 定義: Event に属する 1 回の公演。Event から独立しては存在しない。
- 属性:
  - `id`、`eventId`
  - `doorsAt`（nullable timestamptz、開場）
  - `startsAt`（必須 timestamptz、開演）
  - `endsAt`（nullable timestamptz、終演）
  - `canceledAt`（nullable。Event の cancel から独立。Event の uncancel は
    Occurrence 側を自動解除しない）
  - `createdAt` / `updatedAt`
- 不変条件:
  - 同一 Event 内で `startsAt` は一意（`(event_id, starts_at)` UNIQUE）。
    instant としての一意性であり壁時計表記の一意性ではない。
  - `doorsAt <= startsAt <= endsAt`（設定されている項のみ比較。null は
    比較対象外）。
  - `startsAt` の Asia/Tokyo calendar date は親 Event の
    `[startsOn, endsOn]` 内でなければならない（doors/ends が日付を
    またいでも range 判定には使わない）。
  - Occurrence は他 Event へ付け替えられない（`event_id` に UPDATE grant
    がない）。
  - 独立した owner 概念を持たない。管理権限は親 Event の owner から派生。
- ライフサイクル:
  - 生成: Event 作成時の初期 1 件（任意）、または `addEventOccurrence`
    （owner のみ、plain INSERT、RLS WITH CHECK）。
  - 更新: owner のみ、`updateEventOccurrence`（plain UPDATE、`event_id` は
    payload から除外）。
  - 削除: owner のみ、`delete_event_occurrence` RPC。
    `occurrence_participations` / `occurrence_invitations` が 1 件でも
    あれば拒否（SQLSTATE `90001`）。cascade delete はしない。
  - Cancel/Uncancel: owner のみ、`canceled_at` の単純な列更新。

### 1.3 Effective cancellation（実質的中止）

- Event-level と Occurrence-level の cancellation は独立した nullable
  timestamp。
- **実質的中止 = `event.canceledAt !== null OR occurrence.canceledAt !==
  null`**（OR 合成。cascade しない。値そのものの正確な時刻には意味がなく
  「null か非 null か」だけが product 上の意味）。
- Event の uncancel は個別に canceled な Occurrence を uncancel しない。

### 1.4 Genre / Group（分類）

- Genre: canonical identity を持つ lookup table（`genres`：`id` / `key` /
  `displayName` / `sortOrder`）。Event は 0..1 genre。Gate A の 3 genre
  （`takarazuka` / `kabuki` / `idol`）は seed data であり closed enum では
  ない。
- Group: 宝塚の「組」とアイドルの「グループ」を同じ generic identity
  mechanism（`groups`：`id` / `key` / `displayName`）で扱う。genre への
  hard-bind はない。Event : Group は 0..N（多対多、`event_groups`）。
- Venue: `events.venue` の exact text。canonical venue master は無い
  （Gate A では作らない）。
- Facet model: 選択中 genre ごとに有効な secondary facet が 1 つ決まる
  （宝塚→組 / 歌舞伎→会場 / アイドル→グループ）。facet の対応表は
  UI 側の設定であり domain の hard restriction ではない
  （`GENRE_FACET` 定数、`src/domain/catalogFilterIntegration.ts`）。
- Filter 意味論（`matchesCatalogFilter`, `src/domain/eventCatalog.ts`）:
  - top-level genre は single-select（`null` = すべて）。
  - 同一 facet 内の複数選択は OR。
  - 複数 facet 間は AND（Gate A では genre と 1 secondary facet のみ同時
    に有効なので実質的に 2 軸）。
  - 「未選択」と「既知の全選択肢を選択」はどちらも「この facet では
    絞り込まない」noop として扱う（`isEffectiveFacetSelection`）。
  - unclassified な Event は specific genre filter に非ヒット。group 未
    associate は group filter に非ヒット。venue が null/不一致は venue
    filter に非ヒット。推測でヒットさせない。
  - option universe（selectable な値の集合）は catalog 全体から構成し、
    表示中の月やその他の期間には依存しない。
- 分類の write path は operator-assisted import のみ（`import_event_
  classification` RPC、service_role 限定）。owner を含む通常 authenticated
  user は classification を編集できない。

### 1.5 CatalogCreator（designated catalog creator membership）

- `catalog_creators` テーブルへの membership（1 行 = 1 user）による
  allowlist。特定 UUID のハードコードでも generic role framework でもない。
- Event 作成の必要条件（`canCreateEvent`）: `actor === ownerId &&
  isDesignatedCatalogCreator`。
- 判定関数 `isDesignatedCatalogCreator`（`src/infrastructure/supabase/
  eventCatalogWrite.ts`）は「行が無い」を確定的な `false` として返し、
  read failure（`ok: false`）とは区別する。

### 1.6 Participation（参加予定）

- 定義: **occurrence 単位**の「行くかどうか」の意思表示。event 単位の
  participation は存在しない。
- 属性:
  - `id`、`occurrenceId`、`userId`
  - `status`: `'considering' | 'attending'`（MVP はこの 2 値のみ。
    `not_attending` は存在しない。行が無い = 参加していない）
  - `visibility`: `'private' | 'public'`（既定は `private`。`public` =
    authenticated users 全員に見える）
  - `createdAt` / `updatedAt`
- 一意性: `(occurrence_id, user_id)` に対し 1 行。
- 関係: TicketOpportunity の personal planning state
  （`planned`/`applied`）とは完全に独立。一方から他方を暗黙で作成・変更
  しない。
- ライフサイクル:
  - Set（作成 or 更新）: `setParticipation`。既存行があれば UPDATE、無け
    れば INSERT（真の `upsert()` は使わない。理由は 4.2 参照）。
  - Withdraw（削除）: `withdrawParticipation`。「参加していない」の唯一の
    表現は行の不在。
  - 実質的中止（Effective cancellation）中の occurrence への **新規**
    `attending` 遷移（行の新規作成、または `considering -> attending`）
    は DB trigger（`check_occurrence_participation_insert_not_canceled` /
    `_update_not_canceled`）が custom SQLSTATE `90002` で拒否する。
    withdraw は中止状態でも常に許可される。

### 1.7 Invitation（招待）

Issue #225/#230 で pending-only モデルへ収束済み（旧: auto-considering
作成・decline 後の re-invite 永久拒否は supersede 済み）。

- 定義: **occurrence 単位**の「未回答の招待」という一時的な coordination
  state のみを表す。durable な accepted/declined history は持たない。
  resolve（accept/decline/generic attending convergence のいずれか）
  された行は削除される。
- 属性: `id`、`occurrenceId`、`inviterId`、`inviteeId`、`declinedAt`
  （schema 互換のため残存する column だが現行の write path はどれも
  設定しない = 常に実質 pending）、`createdAt`、`updatedAt`。
- invite できる条件: 対象 occurrence で **inviter 自身が `attending`**
  であること。`considering` の user、および event owner であることは
  invite eligibility を与えない。
- invite 時の invitee 側分岐（3 分岐、**inviter からは区別不能**）:
  1. participation 行なし → pending invitation を作成。invitee の
     participation は変更しない。
  2. 既に `considering` → pending invitation を作成し `considering` を
     維持。
  3. 既に `attending` → invite 対象外。invitation 行を作らず、既存の
     `attending` をそのまま維持。
- invite は invitee の確定済み `attending` を `considering` へ降格させ
  ない。inviter は invitee を `attending` へ直接確定させることもできない。
- **Accept**（参加する）: 通常の participation write（`considering`/
  行なし → `attending`）と全く同じ operation。専用 accept RPC は無い。
  DB trigger（`occurrence_participations_resolve_invitations_on_
  attending`）が同一 occurrence/invitee の pending invitation を副作用
  として全て解消する。
- **Decline**（参加しない）: pending invitation を削除（
  `decline_occurrence_invitation` RPC）。`not_attending` は作らない。
  invitee の既存 `considering` は変更しない。
- **Re-invite**: 過去の decline は永久 opt-out にならない。invitee が
  現在 `attending` でなければ、同じ inviter が再度 invite できる。
- **Opacity（不透明性）**:
  - invite 操作の結果は inviter に対し常に同一の成功応答
    （`inviteToOccurrenceByEmail` / `inviteToOccurrence` はいずれの内部
    分岐でも `void` を返す）。
  - invitation の通常 read は invitee 本人限定。inviter は自分が送った
    invitation でも一覧・存在確認ができない（inviter 向け invitation
    history は MVP 対象外）。
  - email 指定版（`inviteToOccurrenceByEmail`）はさらに、「no such
    account」を含む invitee 依存のあらゆる分岐が同一結果を返す。
- invitee 指定は 1.10 の identity targeting boundary に従う（exact
  registered email）。

### 1.8 PersonalSchedule（Event-independent personal schedule）

- 定義: Event/Occurrence とは独立した個人予定。固定 category を持たず、
  必須の自由記述 `title` を持つ（Issue #121 で旧 `paid_leave`/`work`/
  `travel`/`other` の closed vocabulary を supersede）。
- 属性（`PersonalScheduleEntry`）:
  - `id`、`ownerId`、`title`（必須）、`memo`（nullable）
  - `blocking`（boolean。entry 本体の属性であり share 先にも同じ
    semantics で伝播。per-recipient override は無い）
  - `temporal`（discriminated union、下記のいずれか 1 つのみ）:
    - `{ kind: 'all-day', startsOn, endsOn }`（両方 calendar date、
      `startsOn <= endsOn`。単日は `startsOn === endsOn`）
    - `{ kind: 'time-bounded', startsAt, endsAt }`（`startsAt` 必須
      timestamptz、`endsAt` は nullable。未設定の終了時刻を「今日中に
      終わる」等へ暗黙変換しない）
  - `createdAt` / `updatedAt`
- 関係: `ScheduleShare`（`id`、`scheduleEntryId`、`sharedWithUserId`、
  `createdAt`）で N 人に共有可能。
- 可視性: owner は自分の全 entry。recipient は自分が共有された entry の
  みを通常表示内容そのままで見る（busy-only ではない）。SELECT policy は
  owner-or-shared として一括で許可される（RLS が union を担う。domain 側
  は「own か shared か」を `ownerId === callerId` の比較で判定するのみ）。
- ライフサイクル:
  - 生成/更新: owner のみ（`createPersonalScheduleEntry` /
    `updatePersonalScheduleEntry`）。`ownerId` は payload から除外
    （UPDATE grant なし）。
  - 削除: owner のみの hard delete（`deletePersonalScheduleEntry`）。
    soft delete/trash/restore/監査履歴は無い。`personal_schedule_shares`
    は `ON DELETE CASCADE` で自動 cleanup。
  - 共有追加: owner のみ、exact registered email 指定
    （`shareScheduleEntryByEmail` RPC）。approval flow なし、即時反映。
    未登録 email は owner 自身へその旨を知らせてよい（Invitation の
    opacity 要件とは異なる。1.10 参照）。
  - 共有解除:
    - 自己離脱（self-leave）: recipient 自身が `removeScheduleShare`。
      entry 自体は owner・他 recipient に残る。
    - owner による削除: owner が任意の recipient の share を削除。
      recipient は他の共有相手の追加・削除ができない。
  - owner 向け bounded read projection
    （`listScheduleShareRecipientEmails` / `ScheduleShareRecipient`）:
    「実際に share 済みの recipient を email で識別できる」projection。
    owner が管理する既存 share relation に限定され、global user
    directory ではない。

### 1.9 TicketOpportunity（Ticket planning MVP）

Issue #157 で確定した「いつ、何の抽選・先行・販売開始があるかを漏らさず
見る」ための shared catalog data。full ticket inventory / detailed
application tracking ではない（Ticket model 自体は Issue #234 で撤去
済み）。

- `TicketOpportunity`:
  - `id`、`eventId`（必須、1 Event に複数可）
  - `targetScope`: `'event_wide' | 'selected_occurrences'`
    - `event_wide` は Event 全体という **semantic fact** であり、その
      時点で存在する Occurrence 一覧の snapshot へ暗黙変換しない
      （後から Occurrence が増減しても re-scope しない）。
    - `selected_occurrences` の場合のみ `TicketOpportunity ↔
      Occurrence` の関連（`ticket_opportunity_target_occurrences`）を
      explicit に保持。対象は必ず同じ Event に属する Occurrence。
  - `displayName`（source 上の表示名をそのまま保持。closed enum へ
    潰さない、例:「FC先行」）
  - `sourceKey`（import 冪等性キー。Event 自身の `source_key` とは別の
    identity 空間）、`sourceUrl`（nullable）、`memo`（nullable）
  - `createdAt` / `updatedAt`
- `TicketOpportunityMilestone`（`ticket_opportunity_milestones`）:
  - `milestoneType`: `'application_open' | 'application_close' |
    'result_announcement' | 'sale_start' | 'payment_window'`
  - `temporalPrecision`: `'date' | 'datetime' | 'window'`
    - `date` → `dateValue` のみ非 null
    - `datetime` → `at` のみ非 null
    - `window` → `startsAt`/`endsAt` のみ非 null
    - source が与えていない時刻を絶対に補完しない（date-only を
      `00:00` へ fake 変換しない）。
  - source に存在しない milestone は行を作らないことで表現する
    （「不明」を表す特別な値は無い）。
- `UserTicketOpportunityState`（`user_ticket_opportunity_states`、
  personal・owner-only）:
  - `status`: `'planned' | 'applied'` の 2 値のみ。
  - 行が無い = 「personal planning 対象として登録していない」であり、
    実際の application record ではない。
  - 第 1〜第 N 希望・枚数・席種・実際の申込内容・当落詳細・acquired
    Ticket はこの record に含まれない（将来 need が出たら別 bounded
    Task で再設計）。
  - user × opportunity で一意。owner 本人のみ read/write 可能。
- Shared/personal authority boundary:
  - `TicketOpportunity` / target scope / milestone は shared catalog
    data で read-only（authenticated 全員 read 可）。write path は
    operator-assisted import（`import_ticket_opportunity` RPC、
    service_role 限定）のみ。
  - `UserTicketOpportunityState` の write は owner 本人のみ、通常の
    テーブル write（RPC 不要）。
- Participation・PersonalSchedule とは完全に独立（一方から他方を暗黙で
  作成・変更しない）。

### 1.10 Authenticated-user targeting（identity boundary）

- MVP で他 user を明示指定する operation（Invitation の invitee 指定、
  PersonalSchedule share の recipient 指定）は **相手の登録済み email
  address の exact input** で行う。raw internal user UUID は要求しない。
- generic user directory / user list / autocomplete / partial-match /
  fuzzy search は提供しない。client-readable な generic
  `email -> user_id` lookup API は提供しない。
- email → internal user id の resolution は trusted server 境界内
  （`security definer` RPC）でのみ operation-specific に行う。
- opacity 要件は operation ごとに異なる:
  - Invitation: invitee の private participation state を inviter へ
    開示しない（1.7 参照）。未登録 email かどうかも開示しない。
  - PersonalSchedule share: 対象 email が未登録であることを owner
    本人（呼び出し元）へ知らせて構わない（第三者の private state が
    存在しないため opacity 要件が異なる）。
- reusable な profiles/people/social subsystem は先行構築しない。

### 1.11 Identity / Auth（Supabase Auth に委譲する部分）

- ユーザー識別子は Supabase Auth の `auth.users.id`（UUID）。この
  リポジトリのドメイン層はこれを不透明な `userId`/`ownerId` として
  扱うのみで、profile テーブルは持たない（`profiles.is_admin` 等は
  先行実装しない）。
- サインイン方式:
  - Magic link（email OTP、`shouldCreateUser: false` で public signup
    無効化を backstop）。
  - Passkey（WebAuthn。register/sign-in はブラウザ限定のセレモニー、
    list/delete は session-scoped なサーバー操作）。
- avatar 用の identity 表示（AppBar 用）は email の先頭 1 文字
  （surrogate pair を壊さないよう `Array.from` で取得）のみを扱う
  独立した純粋関数（`resolveMyPageInitial`）。

---

## 2. ビジネスルール

日時・タイムゾーンの取り扱いを含め、コードに実装されている判定ロジックを
ルールとして列挙する。

### 2.1 タイムゾーン / 日時

- product 上の日付境界は **Asia/Tokyo**（固定 UTC+9、DST なし）。
- 永続化される timestamp は PostgreSQL `timestamptz`（ワイヤ上は UTC
  instant）。
- Asia/Tokyo への変換は「UTC instant に固定 9 時間を加算し、UTC field を
  Tokyo local field として読む」という純粋な定数演算であり、JS ランタイム
  や DB セッションのローカルタイムゾーンには一切依存しない
  （`tokyoLocalInstant` / `TOKYO_OFFSET_MS = 9h`）。
- "YYYY-MM-DD" の calendar date 検証は `Date.UTC` の round-trip で行う
  （shape だけでなく実在する日付かも検証。例: `2026-02-30` や
  `2026-13-01` は拒否。2 桁年による JS レガシー remap も拒否）。
- Tokyo calendar day の UTC 範囲は半開区間 `[start, start+24h)` として
  計算する（`tokyoCalendarDayRangeUtc`）。
- `<input type="datetime-local">` の値は「Asia/Tokyo の壁時計表記」として
  読み、UTC instant へ変換する（`tokyoDateTimeLocalToInstant`）。時刻
  overflow（25:00 等）は明示的に range check して拒否する（`Date.UTC` の
  自動繰り上げに任せない）。

### 2.2 Event / Occurrence 整合性

- `startsOn <= endsOn`（Event range）、`doorsAt <= startsAt <= endsAt`
  （Occurrence、設定されている項のみ）は application-side validation と
  DB level 制約の両方で enforce する。
- Occurrence の `startsAt` の Tokyo calendar date は親 Event の
  `[startsOn, endsOn]` 内でなければならない。doors/ends の日またぎは
  この判定に影響しない。
- 同一 Event 内で Occurrence の `startsAt` instant は一意（壁時計表記の
  一意性ではない）。
- 0 件の Occurrence を持つ Event は正当な状態（Event range だけ確定し
  公演回が未発表）。「Event range 内で Occurrence が無い日 = 休演日」
  という解釈はしない。
- 興行の延期・会期変更等、Event range と Occurrence の日付を同時に
  新しい期間へ移す owner 操作は、immediate な DB 制約だけでは一時的に
  invariant 違反になり得るため、`reschedule_event` のような単一
  transaction 一括更新 RPC を経由する（2.6 参照）。

### 2.3 Cancellation（中止）

- 実質的中止 = `event.canceledAt !== null OR occurrence.canceledAt !==
  null`（1.3 参照）。
- 実質的中止状態にある Event/Occurrence への **新規の active action**
  （新規 participation の `considering/なし -> attending`、新規
  invitation）は拒否する（custom SQLSTATE `90002`）。
- 既存 participation の withdraw、および invitation の decline は中止
  状態でも常に許可する。
- Deletion（誤登録の削除）と Cancellation（公演の中止）は明確に別概念。
  削除は downstream data が無いことを要求し cascade しない。中止は
  downstream data（participation/invitation）を保持したまま状態だけを
  変える。

### 2.4 Participation / Invitation

- MVP participation status は `considering`/`attending` のみ。
  `not_attending` は persist しない。
- invite できるのは対象 occurrence で `attending` の user のみ
  （owner であっても `attending` でなければ invite 不可）。
- invite/decline/accept の 3 分岐 dispatch とその opacity 要件は 1.7 の
  とおり。accept は「通常の participation write と同一の operation」
  であり、専用の accept 状態を持たない。

### 2.5 Deletion（誤登録削除）

- Event/Occurrence の hard delete は owner-only。soft delete は無い。
- Occurrence 削除: `occurrence_participations` / `occurrence_
  invitations` のいずれか 1 件でも存在すれば拒否（cascade しない）。
- Event 削除: 0-occurrence Event は削除可能。child Occurrence がある
  場合、**全 child** が削除条件を満たす場合のみ Event + 全 child が
  atomic に削除される。1 件でも削除不可な child があれば全体を拒否
  （部分削除なし）。

### 2.6 Mutable / system-managed fields

- owner が変更できるのは記述情報（title/venue/参照URL/memo）、Event
  range、その Event の Occurrence の日時のみ。
- id・作成日時・owner・レコード更新日時は system-managed（通常の
  authenticated client からは直接書き換え不可）。
- Event range の変更は「既存の全 Occurrence を現状のまま payload に
  含めて丸ごと送る」atomic RPC（`reschedule_event`）を経由する。これに
  より「range を先に狭めると既存 occurrence が out-of-range になる」
  ような一時的 invariant 違反を避ける。genuine reschedule（range と
  occurrence を両方動かす）は「range を広げる → 個々の occurrence を
  編集 → range を狭める」という 3 ステップに分解でき、各ステップは
  単独で invariant を満たす。

### 2.7 Ticket Opportunity 集約ルール

- **Opportunity-scope の実質的中止判定**（`isTicketOpportunityRow
  EffectivelyCanceled`）:
  1. 親 Event が中止 → targetScope に関わらず Opportunity 全体が
     terminal。
  2. `event_wide` かつ Event が中止でない → Occurrence 側の状態だけで
     terminal にはならない（`event_wide` は Occurrence 集合の
     snapshot ではなく semantic fact のため）。
  3. `selected_occurrences` かつ Event が中止でない → 対象 Occurrence
     が **完全に解決**（`targetOccurrences.length ===
     targetOccurrenceIdCount`）かつ非空、かつ解決済み対象の **全て**
     が中止の場合のみ terminal。部分的にしか解決できていない場合や、
     一部だけ中止の場合は terminal と判定しない（取りこぼしを
     「全部中止」と誤読しない）。
- Deadline urgency の分類（`ticketOpportunityDeadlineBadge`）は次の
  条件を満たす milestone にのみ適用する: 自分の state が `planned`、
  milestone type が `application_close`、Opportunity が実質的中止で
  ない。該当しない milestone は絶対に赤色/terminal 表示に昇格しない。
  - 経過日数（Asia/Tokyo calendar day 差、milestone の締切日
    `ticketOpportunityMilestoneTokyoCalendarDate` を基準）としきい値:

    | 日数差 | variant | label |
    |---|---|---|
    | 既に過ぎている | `terminal` | 受付終了 |
    | 0（当日） | `deadline` | 本日 HH:MM まで（時刻不明なら「本日締切」）|
    | 1〜3 | `deadline` | 残りN日 |
    | 4〜13 | `outline` | 残りN日 |
    | 14 以上 | なし | null |
  - 締切日は `at`（datetime）> `endsAt`（window の終わり）>
    `startsAt`（window の開始、endsAt が無い場合）> `dateValue`
    の優先順で解決する。window の締切は開始日ではなく終了日。
- 「post-final retention」: Opportunity の最後の milestone が過ぎても、
  その最終日から `TICKET_POST_FINAL_RETENTION_DAYS = 7` 日以内
  （当日含む）は履歴として一覧に残す。7 日を過ぎたら一覧から落とす。
  cancellation とは独立（中止でも 7 日残す。中止 vs 受付終了の表示は
  中止が優先）。

### 2.8 Home（直近の予定 / 申し込み期限）

- `HOME_WINDOW_DAYS = 14`（今日から 14 Asia/Tokyo calendar day、
  inclusive）。
- 直近の予定（`selectHomeUpcomingItems`）: window 内の candidate を
  最大 `HOME_UPCOMING_LIMIT = 5` 件、近い順に返す。window 内が 0 件の
  場合に限り、window 外の最も近い 1 件を代わりに返す（空セクションを
  作らない）。
- Occurrence の candidacy: 開始日が今日の Tokyo calendar date なら
  その日一杯 candidate（開始時刻を過ぎても）。未来の日付なら開始
  instant を過ぎるまでのみ candidate。
- PersonalSchedule の candidacy: all-day は `endsOn >= today`。
  time-bounded で終了時刻ありは `終了日の Tokyo date >= today`。
  終了時刻なしは開始日が today 以降のみ（無期限に候補化しない）。
- 申し込み期限（`selectHomeDeadlineRows`）は 2.7 の
  `isActionableTicketOpportunityDeadline` をそのまま再利用し、window
  内のみ・件数上限なしで日付昇順に並べる。

### 2.9 Personal schedule / My Calendar

- 予定の日付範囲を跨いだ marker（band/dot）計算は表示グリッドの範囲に
  clip するが、entry 自身の未確定な終了（`endsAt === null`）を無期限
  延長として扱わない（開始日のみを active とする）。
- 月表示の dot 状態は `filled`（`attending` の active occurrence、また
  は blocking な単日 schedule のいずれかがある）/ `outline`（
  `considering` または non-blocking な単日 schedule のみ）/ `none` の
  3 値。実質的中止の occurrence は dot/count の集計から除外するが、
  選択日の detail 一覧には引き続き表示する。
- 月表示の band（複数日にまたがる帯）は、Event Catalog では
  **multi-day Event のみ**が対象（single-day Event は day-number count
  にのみ寄与し、band 化しない）。My Calendar では **multi-day
  PersonalSchedule のみ**が band、Participation は常に日単位の dot。
  1 週あたり同時表示できる band は最大 `MAX_BAND_LANES = 2`（超過分は
  overflow としてカウント・リンクのみ提供）。

### 2.10 Catalog navigation

- 月・選択日を表す query param（`month`/`date`）は
  `isValidYearMonth`/`isValidCalendarDate` で検証し、不正・欠落時は
  エラーにせず「無視して呼び出し元の既定へフォールバック」する
  （client 由来の navigation state であり domain data ではないため）。
- `occurrence` query param は「そのイベントに実在する occurrence id
  一覧に含まれるか」で再検証し、一致しない場合は `null`（=
  focus なし）に倒す。誤った occurrence へ解決することは絶対にしない。

### 2.11 Calendar day role（曜日・祝日表示）

- 土曜日 = `saturday`、日曜日 = `sunday`、祝日 = `holiday`。祝日と
  土曜が重なる場合は `holiday` が優先。
- 祝日データは内閣府 CSV のスナップショットのみを canonical source と
  し、equinox 計算等のルールベース推測は一切行わない。
  スナップショットの coverage 範囲外の日付は「不明」であり、
  「祝日ではない」と断定しない（`isWithinJapaneseHolidayDataCoverage`
  で区別）。
- 色は意味の唯一の伝達手段にしない（accessibility baseline）。祝日名や
  曜日グリフを非色チャネルとして必ず提供する。

### 2.12 Redirect safety（magic link 後の遷移先）

- サインイン後の redirect 先はメールのクエリ文字列由来であり
  attacker-influenceable。同一オリジンかつ単一スラッシュの絶対パスの
  みを許可し、それ以外は `/` にフォールバックする。制御文字（CR/LF 等）
  やバックスラッシュ経由の scheme-relative URL は明示的に拒否する。

### 2.13 認証エラーの分類

- `unauthenticated`（セッションなし/期限切れ）と、5xx・レート制限・
  ネットワーク断等の一時的な `failure` は明確に区別する。前者だけが
  サインインへの誘導対象であり、後者を `unauthenticated` に誤分類する
  と一時障害中の正規ユーザーをサインインへ迷い込ませる。

---

## 3. Server Action / mutation の入出力契約

現行実装は Next.js の Server Action（`'use server'`、`useActionState`
または imperative 呼び出し）と、その下の
`src/infrastructure/supabase/**` 型付き read/write boundary、さらにその
下の PostgREST 直接操作 / RPC の 3 層構造。v2 は
「Zod schema（入力）+ next-safe-action（実行）+ 現行と同じ RPC/RLS
契約（DB 層）」に置き換える想定なので、ここでは **入力スキーマとして
再定義できる粒度**で記載する。

各 action は権限判定を一切行わない。権限は常に DB（RLS / RPC 内の
membership check）が enforce し、action はその結果を UI 向けの状態
（`{ok, error.kind}` → feedback）へ変換するだけ、という構造は v2 でも
維持すべき設計判断。

### 3.1 Event catalog write（`src/app/catalog/_actions/eventWrite.ts`）

| action | 入力（FormData キー） | 型/必須性/検証 | 成功時 | 権限（DB 側） |
|---|---|---|---|---|
| `createEventAction` | `title`(必須) `venue`(任意) `sourceUrl`(任意, http/https) `memo`(任意) `startsOn`(必須, calendar date) `endsOn`(任意→空なら startsOn) `doorsAt`/`startsAt`/`endsAt`(3 つとも空なら「初期 occurrence なし」、`startsAt` だけ入力必須で他は任意) `month`/`date`(navigation context) | `parseEventCreate` | `create_event` RPC 呼び出し→ 新規 Event id へ `redirect` | designated catalog creator であること。owner は caller 自身固定 |
| `updateEventDetailsAction` | `eventId`(必須) `title`(必須) `venue`/`sourceUrl`/`memo`(任意) | `parseEventDetails` | `events` UPDATE（`owner_id` は payload に含めない）→ state に notice | owner-only（RLS）。0 行更新は `permission-denied` |
| `updateEventRangeAction` | `eventId`(必須) `startsOn`(必須) `endsOn`(必須、この action は blank 許可なし) | `parseEventRange({allowBlankEndsOn:false})` | 既存 occurrence 全件を現状のまま添えて `reschedule_event` RPC | owner-only |
| `addOccurrenceAction` | `eventId`(必須) `doorsAt`/`startsAt`(必須)/`endsAt` | `parseOccurrence` + `validateOccurrenceWithinRange`（事前に `getEventRange` で range 取得） | `event_occurrences` INSERT | owner-only。`(event_id, starts_at)` 重複は `duplicate-occurrence`（`startsAt` field error として提示） |
| `updateOccurrenceAction` | `eventId`(必須, revalidate 用) `occurrenceId`(必須) `doorsAt`/`startsAt`(必須)/`endsAt` | 同上 | `event_occurrences` UPDATE（`event_id` は payload から除外） | owner-only。重複は同上 |
| `deleteEventOccurrenceAction` | `eventId`(必須) `occurrenceId`(必須) | フィールドなし | `delete_event_occurrence` RPC | owner-only。downstream data ありなら `delete-blocked` |
| `deleteEventAction` | `eventId`(必須) | フィールドなし | `delete_event` RPC → `/catalog` へ redirect | owner-only。1 件でも child が blocked なら全体拒否 |
| `cancelEventAction` / `uncancelEventAction` | `eventId`(必須) | フィールドなし | `events.canceled_at` を now()/null に更新 | owner-only |
| `cancelEventOccurrenceAction` / `uncancelEventOccurrenceAction` | `eventId`(必須, revalidate 用) `occurrenceId`(必須) | フィールドなし | `event_occurrences.canceled_at` を now()/null に更新 | owner-only |

エラーケースと表示文言は `src/domain/eventWriteFeedback.ts` に
`operation × EventCatalogWriteErrorKind`（`permission-denied` /
`validation` / `duplicate-occurrence` / `delete-blocked` / `failure`）
の直積として全パターン定義されている。v2 では
`next-safe-action` の `ActionError` にこの直積をそのまま持ち込むのが
最小変更。

### 3.2 Participation / Invitation write
（`src/app/catalog/_actions/participationWrite.ts`）

| action | 入力 | 効果 | 権限 |
|---|---|---|---|
| `inviteToOccurrenceAction`（`useActionState` 形式） | `eventId`(必須) `occurrenceId`(必須) `email`(必須, exact email format) | `parseInviteeEmail` → `invite_to_occurrence_by_email` RPC。成功文言は分岐に関わらず常に同一「招待を送信しました。」 | inviter が対象 occurrence で `attending` であること |
| `setParticipationChoiceAction`（imperative, `QuickActionResult` 返却） | `eventId`, `occurrenceId`, `choice: 'considering'\|'attending'\|'withdraw'`, `participationId: string\|null` | `withdraw` → `withdrawParticipation`。それ以外 → `setParticipation`。`attending` への遷移は pending invitation を解消（trigger 副作用） | 自分自身の participation のみ |
| `acceptInvitationAction`（imperative） | `occurrenceId`, `eventId: string\|null` | `setParticipation(status:'attending')` と同一操作（invitation 専用 RPC は存在しない） | 自分自身の participation のみ |
| `finalizeDeclineInvitationAction`（imperative） | `invitationId` | `decline_occurrence_invitation` RPC。既に resolve 済みでもエラーにしない（`data:null` を benign no-op として扱う） | invitee 本人のみ |

`inviteToOccurrenceAction` 以外は `<form>`/`useActionState` を使わず、
component のローカル state から plain function として呼ばれる
（`QuickActionResult = { ok: boolean; feedback: OperationFeedback|null
}`）。v2 で `next-safe-action` に統一する場合、この imperative 呼び出し
パターン（instant accept、8 秒 undo window 付き decline、行クリックで
即保存する participation sheet）をどう表現するかが設計判断点になる
（7 章参照）。

### 3.3 Personal schedule write（`src/app/schedule/_actions/scheduleWrite.ts`）

| action | 入力 | 検証 | 効果 | 権限 |
|---|---|---|---|---|
| `createScheduleEntryAction` | `title`(必須) `blocking`(checkbox, 'true'/'false' 2 entry trick) `temporalMode: 'all-day'\|'time-bounded'` + それぞれの日時フィールド `memo`(任意) | `parsePersonalScheduleEntry` | INSERT → `/calendar` へ redirect | 認証済みであれば誰でも自分の entry として作成可 |
| `updateScheduleEntryAction` | `entryId`(必須) + 上記と同じ | 同上 | UPDATE → `/calendar` へ redirect | owner-only（0 行更新は `permission-denied`。SELECT は owner-or-shared のため「見えるが書けない」が起こり得る） |
| `deleteScheduleEntryAction` | `entryId`(必須) | なし | hard DELETE（share は `ON DELETE CASCADE`）→ `/calendar` へ redirect | owner-only |
| `removeScheduleShareAction`（self-leave） | `shareId`(必須) | なし | `personal_schedule_shares` DELETE → `/calendar` へ redirect | recipient 自身 or owner（同一 DELETE policy）。0 行は `not-found` |
| `addScheduleShareByEmailAction` | `entryId`(必須) `email`(必須) | RPC 側の `raise exception` メッセージで分類（未登録・不正形式・自己共有・空欄の 4 種） | `share_schedule_entry_by_email` RPC | owner-only |
| `removeScheduleShareAsOwnerAction` | `shareId`(必須) `entryId`(必須, revalidate 用) | なし | 同上 DELETE、ただし redirect せずページに留まる | owner-only（他人の share を削除する操作） |

### 3.4 Ticket opportunity write（`src/app/tickets/_actions/ticketOpportunityWrite.ts`）

| action | 入力 | 効果 | 権限 |
|---|---|---|---|
| `updateTicketOpportunityStateAction` | `opportunityId`(必須) `intent: 'planned'\|'applied'\|'remove'` | `remove` → DELETE。それ以外 → upsert-pattern で `status` を設定 | 自分自身の state のみ |

このアクションは `/tickets` が行う唯一の write（shared
TicketOpportunity/milestone データ自体は read-only）。

### 3.5 Passkey management（`src/app/mypage/_actions/passkeyActions.ts`）

| action | 入力 | 効果 | 権限 |
|---|---|---|---|
| `deletePasskeyAction` | `passkeyId`(必須) | Supabase Auth `auth.passkey.delete()`（session-scoped、`service_role`/admin API は不使用） | 自分自身のセッションに紐づく passkey のみ |

register/sign-in（ceremony）は Server Action ではなく、ブラウザ client
から直接 `auth.registerPasskey()`/`auth.signInWithPasskey()` を呼ぶ
（WebAuthn ceremony はブラウザ限定のため）。

### 3.6 入出力契約の横断的な設計判断

- 全 action は「まず parse（純粋関数、`ParseResult<T> = {ok:true,
  value}|{ok:false,fieldErrors}`）→ 次に DB 呼び出し→ `PlanningResult`/
  `EventCatalogWriteResult` を feedback へ変換」という 3 段の構造を
  例外なく踏む。v2 では 1 段目を Zod schema（`safeParse`）へ、3 段目を
  `next-safe-action` の `ActionError` へ、それぞれ機械的に置き換え
  られる形。
- 成功時のリダイレクト有無は「他に行く場所があるか」で決まる
  （create 系は新規リソースへ redirect、update 系はページに留まり
  notice を返す、delete 系は一覧へ redirect）。
- `revalidatePath` の呼び先は「この write が影響する可能性のある
  read 済みキャッシュ全て」を明示列挙している（例:
  invitation の accept は `/catalog/invitations`・`/mypage`・
  event detail の 3 箇所を revalidate）。v2 で cache 戦略を変える場合
  もこの依存グラフ自体は仕様として引き継ぐ必要がある。
- FormData の手続き的パース（`readFormValues`/`readField`/`readId`/
  `optionalText`）は feature ごとに意図的に重複させている（7 章で
  v2 の解消方針を後述）。

---

## 4. Supabase client の使い分け

### 4.1 Client 生成の 3 系統

| client | 生成場所 | 鍵 | 用途 | Cookie 戦略 |
|---|---|---|---|---|
| Browser client | `src/infrastructure/supabase/browserClient.ts`（`createSupabaseBrowserClient`） | anon key | Client Component から直接呼ぶ操作。現状唯一の用途は passkey の WebAuthn ceremony（`registerPasskey`/`signInWithPasskey`。`auth.experimental.passkey: true`） | `@supabase/ssr` の browser 既定（ブラウザの cookie storage） |
| Server client | `src/infrastructure/supabase/serverClient.ts`（`createSupabaseServerClient`） | anon key | Server Component / Route Handler / Server Action からの通常の read/write 全般。`auth.experimental.passkey: true`（list/delete 用） | `next/headers` の `cookies()` から読み取り、書き込みも試行。Server Component render 中の書き込み失敗（read-only cookie store）は握りつぶす（`proxy.ts` が毎リクエストでセッションを refresh するため安全） |
| Cookieless server client | `src/infrastructure/supabase/serverClient.ts`（`createSupabaseCookielessServerClient`） | anon key | magic link 送信（`signInWithOtp`）専用 | cookie を読むが **書き込みを一切しない**（`setAll` が no-op）。理由: PKCE code verifier の cookie 有無が「そのメールアドレスのアカウントが存在するかどうか」のオラクルになるため、sign-in request では応答側に一切の cookie 差分を残さない。実際のサインイン完了は magic link 自体の `verifyOtp({token_hash})` 経由で、code verifier を使わない |
| Service-role client | アプリ本体には存在しない。`scripts/lib/adminTarget.mjs`（`resolveAdminTarget`）が `@supabase/supabase-js` の `createClient` を service_role key で直接生成 | service_role key | operator 実行の import/provision スクリプトのみ | 該当なし（サーバーレス実行の使い捨てプロセス） |

**確認できた事実として重要な点**: service role client を返す共通
infra モジュールは `src/infrastructure/supabase/**` の中には存在しない
（意図的な設計。product-rules.md 「service role / provider 資格情報を
client へ露出しない」の帰結）。service role が必要な操作
（operator import、designated creator への membership 付与、DB を
経由しないユーザー作成）は全て `scripts/**` の Node スクリプトに閉じて
おり、Next.js アプリのランタイム（Server Action / Route Handler 含む）
からは一切呼ばれない。v2 でもこの境界（app runtime は anon key のみ、
service role は CI/operator/Trigger.dev job 内に限定）を維持すべき。

### 4.2 認証セッションの解決

- `getAuthenticatedUser()`（`src/infrastructure/supabase/session.ts`）:
  `createSupabaseServerClient()` を内部生成し `auth.getUser()` を呼ぶ。
  React の `cache()` でラップされており、1 リクエスト内の複数呼び出し
  （layout の AppBar identity + page 本体等）が Auth server への
  round trip を共有する。
- `requireAuthenticatedUserId()`（`src/infrastructure/supabase/
  planningAuth.ts`）: 型付き read/write boundary（participation /
  personal schedule / ticket opportunity 等）が「自分自身の user_id」を
  必要とする箇所で使う。**caller から渡された id を信用せず、常に
  client 自身のセッションから解決する**。これにより「セッション切れ」
  は infra 層自身が `unauthenticated` として検出できる（DB まで到達
  してから 42501 を受け取るのではなく）。RLS は独立に再検証するため、
  これは代替ではなく先回りの分類。
- エラー分類（`classifyGetUserError`）は `AuthSessionMissingError` /
  401・403 の `AuthApiError` を `unauthenticated` とし、それ以外の
  `AuthApiError`（5xx 等）・`AuthRetryableFetchError`・
  `AuthUnknownError` は `failure` として区別する（2.13 参照）。

### 4.3 ゲート層（`src/proxy.ts`）

- Next.js Middleware（`proxy` export）が default-deny の認証境界を
  持つ: `PUBLIC_PATHS = {'/sign-in', '/auth/confirm'}` の exact match
  以外は未認証アクセスを `/sign-in` へ redirect。
- PWA の public resource（manifest・icon 4 種）は `config.matcher` で
  明示的に除外される exact-path 例外（`src/pwa/appIdentity.ts` の
  `PWA_PUBLIC_ASSET_PATHS` とテストで同期を保証）。file 拡張子ベースの
  一般ルールは意図的に採用していない（拡張子ルールは無関係な
  application route を誤って公開し得るため）。
- 認証済みで `/sign-in` にアクセスした場合は `/` へ redirect。
- middleware 自身が `createServerClient`（`@supabase/ssr`）を生成し、
  cookie の読み書き（トークン refresh）をレスポンスへ反映する。
  Server Component 内の `createSupabaseServerClient` が cookie 書き込み
  に失敗しても安全なのは、この層が毎リクエストで refresh を担保して
  いるため。

### 4.4 `database.types.ts` の位置づけ

- Supabase 生成 TypeScript 型（`src/infrastructure/supabase/
  database.types.ts`）を database schema の source of truth として
  扱う（`AGENTS.md` Technology profile の明文規定）。
- domain 層（`src/domain/**`）はこの生成型を **import しない**。
  かわりに `RawEventRow` 等、必要な列だけを持つ最小限の interface を
  独自定義し、`mapXRow` 関数で domain 型へ変換する（アーキテクチャ上の
  import 境界、`eslint.config.mjs` で強制）。infra 層
  （`src/infrastructure/supabase/**`）だけが `Database` 型を直接使う。

---

## 5. PWA

対象: `src/pwa/appIdentity.ts` / `src/pwa/manifest.ts`（Issue #304 で
確定した scope）。

### 5.1 確定した scope

- **installable な standalone Web App として起動できること**が
  supported な利用形態。Android/iOS のホーム画面追加を想定。
- installability と offline 動作は別概念として扱われ、offline 対応は
  この scope に含まれない（Service Worker・offline cache・Web Push・
  background sync はいずれも現状未実装、意図的に「用途が確定していない
  段階で空の Service Worker を先行導入しない」）。
- native 配布（TWA/Google Play/Capacitor/React Native）は scope 外。

### 5.2 Manifest の内容（`buildPwaManifest`）

| field | 値 | 安定性 |
|---|---|---|
| `id` | `/` | **不変**。変更すると既に install 済みの app が別 app として扱われ孤立する |
| `start_url` | `/` | 同上 |
| `scope` | `/` | 同上 |
| `name` / `short_name` | `stage-tracker` / `stage-tracker`（同一文字列。短縮は意図的なブランディング判断が必要なため作らない） | - |
| `display` | `standalone` | - |
| `theme_color` | `#2f4a7a`（`--color-accent` と同値を manifest 生成時にリテラル複製。CSS custom property は server-side manifest から解決できないため） | tokens.css との一致をテストで担保 |
| `background_color` | `#eef0f1`（`--color-canvas` と同値） | 同上 |
| `icons` | `PWA_ICON_ASSETS` のうち `role: 'manifest'` の 4 種中 3 種（192/512 の `any` purpose、512 の `maskable` purpose） | maskable art は 80% safe-zone 内に収める別レンダリング |

### 5.3 公開リソースの扱い

- `PWA_PUBLIC_ASSET_PATHS`（manifest 本体 + 4 アイコンパス）は
  **未認証でも取得できる exact path** の唯一の許可リスト。install
  prompt はサインインより前に評価されるため。
- この公開は当該パスに厳密に閉じ、authenticated route の default-deny
  境界（4.3 参照）を一切緩めない。`src/proxy.ts` の `config.matcher`
  にリテラル複製されており、2 つのリストが乖離した場合はテスト
  （`src/pwa/__tests__/appIdentity.test.ts`）が検出する。
- `apple-touch-icon`（180px）は manifest エントリではなく root
  metadata の `icons.apple` からのみ参照される（iOS Home Screen は
  manifest ではなくこのリンクからアイコンを取る）。
- アイコン画像は生成物ではなく供給されたアート素材（`public/pwa/`）。
  サイズ変更時は宣言サイズと実ファイルの PNG ヘッダが一致するかを
  テストで検証している。

### 5.4 v2 への申し送り

- 5.1〜5.3 の内容は v2 でもそのまま踏襲可能（技術非依存の product
  decision）。Next.js のバージョンが変わっても manifest route の実装
  詳細（App Router metadata route）は差し替え可能だが、`id`/
  `start_url`/`scope` の値と「未認証公開パスの exact-path 限定」という
  contract 自体は不変として扱うこと。
- offline/Web Push は「まだ決めていないもの」（`AGENTS.md`）に残る
  未決事項であり、v2 でも先行実装しない。

---

## 6. バッチ / import script

対象: `scripts/import-catalog-events.mjs`、
`scripts/import-ticket-opportunities.mjs`（+ `scripts/lib/
ticketOpportunityImport.mjs` / `ticketOpportunitySeed.mjs`）、
`scripts/update-japanese-holidays.mjs`。付随して
`scripts/provision-user.mjs` / `scripts/grant-catalog-creator.mjs`
（admin 系、未詳読だが `adminTarget.mjs` を共有）。

共通する設計原則: **これらのスクリプトは何も fetch しない**（祝日
スクリプトを除く）。公式ソースの読解・書式化は人間または agent が
リポジトリ外で行い、レビュー済みの seed JSON をこのリポジトリが
「読んで適用する」。seed ファイル自体はリポジトリに含めない
（`.gitignore` 対象、取引データに近い性質のため）。

### 6.1 `catalog:import`（`import-catalog-events.mjs`）

- **入力データ形式**: 1 ファイル 1 entry または entry 配列の JSON
  （ディレクトリ指定時は `*.json` を辞書順に読み込み）。1 entry の shape:
  - `sourceKey`(必須, Event 冪等性キー) `title`(必須) `venue`/`memo`/
    `sourceUrl`(任意, http/https 必須)
  - `startsOn`/`endsOn`(必須, "YYYY-MM-DD"、`startsOn <= endsOn`)
  - `occurrences`(必須, 配列。空配列可): 各要素
    `startsAt`(必須, 明示的な UTC offset 付き ISO8601 必須。offset
    省略は拒否 — Asia/Tokyo 前提の手書き/agent 生成データが UTC と
    誤読されるのを防ぐ) `endsAt`/`doorsAt`(任意, 同じく offset 必須、
    `doorsAt <= startsAt <= endsAt` を検証)
  - `genre`(任意, string|null): **省略時は既存 classification に触れない**、
    `null` は明示的な解除、string は genre key
  - `groups`(任意, `{key, displayName}[]`): 省略/`null`/`[]` の 3 状態
    が同様に区別される
- **変換ルール**:
  - `startsAt` から Tokyo calendar date を算出し、`[startsOn, endsOn]`
    containment を DB 適用前に検証（DB 制約と同じ判定をレビュー時点で
    先取り）。
  - 同一 entry 内で `startsAt` instant の重複は拒否（`(event_id,
    starts_at)` の一意性を壊すため）。
  - 実行全体（複数ファイル）で `sourceKey` の重複、および `groups`
    の `key` に対する `displayName` の矛盾（同一 run 内で同じ group
    key に異なる表示名を与える）を拒否。
- **冪等性の担保方法**: `events.source_key`（Event の同一性）と
  `(event_id, starts_at)`（Occurrence の同一性）による upsert 相当の
  diff。既存 Event は `owner_id` 一致を確認した上でのみ更新対象にし、
  所有者が異なる場合は実行全体を fail（owner 上書きは絶対にしない）。
  既存だが seed に無い Occurrence は「関知しない」（削除もしない）
  ため、貸切公演のように手動追加した Occurrence が再 import で消える
  ことはない。end/doors 時刻は「null → 値」の補完は常に適用するが、
  「値 → 値」の上書きは値ごと dry-run レポートに明示して可視化する
  （拒否はしない。seed が catalog より authoritative という前提）。
- **副作用**: `--apply` 無しでは何も書き込まない（既定は dry-run）。
  `--apply` 時、新規 Event は `import_event_with_occurrences` RPC、
  既存 Event の更新は `import_update_event` RPC（Event 情報 + range +
  occurrence 追加/補正を単一トランザクションで実行、range/containment
  invariant の一時的違反を避けるため commit 直前まで検証を遅延させる
  設計）。classification（genre/group）は変更がある場合のみ別 RPC
  （`import_event_classification`）で独立に適用する（無関係な facet
  の churn を避ける）。
  - 実行前に owner の designated catalog creator membership を
    `catalog_creators` テーブルに対し明示チェックする。service_role
    実行は RLS と create RPC の membership check を bypass するため、
    このチェックを怠ると「UI からは作れない権限のない owner の Event」
    を作れてしまう抜け道になる。
- **失敗時の挙動**: 単一 entry の validation 失敗は非 0 終了で即座に
  停止し、他の entry も一切適用しない（「全 validation を write 前に
  完了する」という不変条件。部分適用は許容するが「部分検証」は許容
  しない）。apply フェーズはトランザクション横断ではなく plan 単位の
  RPC 呼び出しごとに fail するが、スクリプト自体が冪等なため、途中
  失敗後の再実行は安全（再開であり重複ではない）。

### 6.2 `tickets:import`（`import-ticket-opportunities.mjs`）

- 設計原則は 6.1 と同一（fetch しない、owner 概念が無い点のみ異なる
  ため `--owner` 引数は無い）。
- **入力**: seed entry は Opportunity 単位。`eventSourceKey`（対象
  Event の `source_key`）、Opportunity 自身の `sourceKey`（冪等性
  キー、Event の source_key とは別の identity 空間）、
  `displayName`、`targetScope`、（`selected_occurrences` の場合のみ）
  対象 Occurrence を `(event source_key, startsAt instant)` で指す
  locator、milestone 配列（`milestoneType`/`temporalPrecision`/該当
  する時刻フィールド）。
- **変換ルール**: locator（Event source_key、Occurrence startsAt
  instant）を現在の catalog に対して解決し、既存 Opportunity
  （同一 `sourceKey`）との diff を milestone 単位で比較
  （`temporal_precision` と該当時刻フィールドが instant 比較で一致
  するかを見る `milestonesEqual`）。全 entry を解決してから初めて
  RPC を呼ぶ（1 件でも locator 解決に失敗したら何も適用しない）。
- **冪等性**: Opportunity の `sourceKey`。
- **副作用**: 唯一の write path は service_role 限定 RPC
  `import_ticket_opportunity`。`ticket_opportunities` /
  `ticket_opportunity_target_occurrences` /
  `ticket_opportunity_milestones` への raw INSERT/UPDATE/DELETE は
  スクリプトのどこからも発行しない。`user_ticket_opportunity_states`
  （personal state）には一切触れない。
- **削除の非対応**: このスクリプト（および付随 lib）に delete path は
  存在しない。seed に無い既存 Opportunity は完全に無視される
  （1 回の seed run が catalog 全体を代表しないため、「seed に無い
  ものを削除する」ような directory-level の stale-removal は意図的に
  スコープ外）。

### 6.3 `holidays:update`（`update-japanese-holidays.mjs`）

- **入力データ**: 内閣府「国民の祝日について」CSV
  （`https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`、
  Shift_JIS、ヘッダ行 + `YYYY/M/D,名称` 行）。この CSV が **唯一の
  canonical source**。
- **変換ルール**: 日付を `YYYY-MM-DD` へ正規化し、日付昇順にソート。
  ヘッダ形状（`月日` を含むか）が想定と異なる場合、行のカンマ区切りが
  想定と異なる場合、名称が空の場合はいずれも即座に例外で停止する
  （フォーマット変化を静かに飲み込まない）。0 行パースされた場合は
  「既存スナップショットを保護するため」書き込みを拒否する。
- **冪等性 / 副作用**: 冪等性の概念は無く、実行するたびに
  `src/domain/japaneseHolidaysData.ts`（生成ファイル、"GENERATED FILE
  - do not hand-edit" 注記付き）を完全上書きする。祝日を演算で
  「補完」することは一切なく、fetch 時点で CSV が公表している範囲
  （`JAPANESE_HOLIDAY_DATA_COVERAGE_START/END`）がそのままコード上の
  coverage になる。未来の祝日を推測しない。
- **実行タイミング**: 固定スケジュールのジョブではなく、内閣府が
  新しい年の祝日を公表するたびに手動実行する運用（`AGENTS.md` は
  この手動運用を明示的に是とする）。
- コミット後、生成ファイルの diff（特に coverage end の前進）を
  レビューしてから通常のソース変更として commit する。

### 6.4 admin scripts（`provision-user.mjs` / `grant-catalog-creator.mjs`、未詳読）

- `scripts/lib/adminTarget.mjs`（`resolveAdminTarget`）を共有し、
  `--remote` フラグの有無で local Supabase CLI（`supabase status -o
  json` から URL/service role key を取得）か、環境変数
  （`STAGE_TRACKER_REMOTE_SUPABASE_URL` /
  `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY`）で指定した remote
  プロジェクトかを選ぶ。remote は明示指定しない限り既定にならない。
- `scripts/lib/findUserByEmail.mjs` を通じて email → user 解決を行う
  （import スクリプトの owner 解決にも共用）。
- 「Administrator 1 名だけ」という運用を理由に特定 UUID を
  application code/migration へハードコードしない、という product
  rule の実装がこの membership 付与スクリプト（`catalog_creators`
  テーブルへの行追加）。

### 6.5 v2（Trigger.dev）への移行方針

現行スクリプトは「validation（純粋関数）→ 現行 catalog に対する
resolve/diff（DB 読み取りが必要）→ dry-run report → apply（RPC 呼び
出し）」という 4 段が 1 プロセスに同居している。v2 で Trigger.dev へ
移す際は、この構造をロジックと実行基盤に分離するのが良い:

- **ロジック**（`packages/domain` へ）: 6.1/6.2 の shape validation
  （`validateEntry` 相当、`validateClassificationShape`、
  `findConflictingGroupDefinitions`、`validateSeedEntryShape`）は
  すでに DB 非依存の純粋関数として切り出されている
  （`scripts/lib/eventClassificationSeed.mjs` /
  `scripts/lib/ticketOpportunitySeed.mjs`）。これらは Zod schema へ
  1:1 で機械的に置き換え可能。
- **diff/resolve ロジック**（`planGenre`/`planGroups`/
  `milestonesEqual` 等）は DB 読み取り結果を受け取って純粋に diff
  するだけなので、これも `packages/domain` の純粋関数として保てる
  （DB 呼び出し自体だけを外側に残す）。
- **実行基盤**（Trigger.dev job へ）: dry-run report の出力
  （console.log 主体）、`--apply`/`--remote` フラグ制御、実際の RPC
  呼び出しと admin client 生成はジョブ側の責務として再実装する。
  Trigger.dev の job payload を Zod schema（seed entry の shape）で
  検証すれば、現行の「validation してから 1 件も書かない dry-run
  モード」を「job の dry-run 実行 or `--apply` 相当の実行モード
  フラグ」として素直に持ち込める。
- **冪等性キー（`source_key`）は DB 契約であり実行基盤に依存しない**
  ため、Trigger.dev 化しても Event/Occurrence/Opportunity の同一性
  判定ルール自体（6.1/6.2）はそのまま踏襲する。
- 「seed ファイルはリポジトリに含めない」という運用は Trigger.dev
  移行後も維持する必要がある（job のトリガー方法・入力受け渡し方法は
  設計対象だが、機密/取引データをリポジトリへ持ち込まないという制約
  自体は変わらない）。

---

## 7. v2 で見直すべき点（提案）

以下はすべて「今のままでも壊れてはいない」が、v2 の設計判断として
再検討する価値がある点。優先度づけや採否は v2 実装 Task 側で判断する。

1. **FormData 手続き的パースの重複は Zod + next-safe-action で自然に
   消える。** `readFormValues`/`readField`/`readId`/`optionalText`は
   feature ごとに意図的に重複しているが（コード上「他 feature の
   `_actions` からは import しない」という明示的な convention）、
   これは「Server Action の入力が型を持たない FormData である」こと
   自体が原因。Zod schema を入力契約にすれば、この層はまるごと
   不要になる。v2 で `_actions` ごとの手書き reader を残す理由はない。

2. **エラー分類の語彙が 2 系統に分裂している。** 現行は
   `EventCatalogWriteErrorKind`（3 種:
   `permission-denied`/`validation`/`failure` + delete 系 2 種
   `duplicate-occurrence`/`delete-blocked`、計 5 種だが Event
   catalog write boundary 専用）と、`PlanningErrorKind`（5 種:
   `unauthenticated`/`not-found`/`permission-denied`/`validation`/
   `failure`、participation/invitation/personal schedule/ticket
   opportunity 共通）という、由来の異なる 2 つの Result 型が並存
   している（Issue #29 の Event catalog boundary が Issue #33 の
   統一 boundary より前に存在したことに由来すると推測される。
   **未確認**: 明示的な統合断念の decision comment は見ていない）。
   v2 では 1 つの共通 error kind 語彙に統一し、feature 固有の追加
   kind（`duplicate-occurrence`/`delete-blocked` 相当）は
   discriminated union の拡張として表現する方が一貫性が高い。

3. **`classifyRpcError` のメッセージ文字列マッチングは脆い契約。**
   `invite_to_occurrence` 等の RPC はすべて Postgres 既定の `P0001`
   SQLSTATE で `raise exception` しており、呼び出し側は
   `error.message.includes('...')` で意味を復元している
   （`INVITE_ERROR_RULES` 等）。migration のメッセージ文言を変更した
   だけでこの分類が静かに壊れる risk がある。実際、cancellation
   関連は既に custom SQLSTATE（`90001`/`90002`）を割り当てて構造化
   されており、v2 では invite/decline/share 系の RPC 例外も同様に
   custom SQLSTATE か構造化 error code へ移行するのが望ましい
   （message-matching を撤去できる）。

4. **`mapXRow` 系関数が pure boundary の中で `throw` する。**
   `mapTicketOpportunityRow`/`mapPersonalScheduleEntryRow` 等は
   不正な enum 値や欠損フィールドに対し例外を投げる設計だが、周囲の
   read/write boundary はことごとく `Result<T, Error>` を返す規約に
   統一されている。DB が本当に不正な行を返した場合、この 1 点だけが
   例外で boundary を突き破る非対称性になっている。v2 では
   「読み取り不能な行はスキップして正常系として扱う」か
   「`Result` に倒す」かを明示的に決めるべき（現状は「DB 制約が
   守っているので起きないはず」という暗黙の前提に依存している）。

5. **ページネーションヘルパーが実質同一実装で 2 箇所に存在する。**
   `src/infrastructure/supabase/pagedFetch.ts`（`fetchAllRows`）と
   `src/infrastructure/supabase/eventCatalogRead.ts` 内の private
   `fetchAllRows` は、コメントが明言する通り「意図的に共有していない
   ほぼ同一実装」。Issue のスコープ都合による意図的重複だが、v2 では
   1 つの共有ユーティリティに統合できる（`count:'exact'` 前提の
   `.range()` ページネーションという契約自体は両者で完全に同一）。

6. **imperative action と `useActionState` action で戻り値の形が違う。**
   `QuickActionResult`（`{ok, feedback}`）と `OperationState`
   （`{attempt, feedback, fieldError, values, notice}`）は同じ
   participation/invitation ドメインに対する 2 つの異なる呼び出し
   規約。理由（instant accept、8 秒 undo window、行クリックで
   即保存する sheet）は正当だが、v2 で `next-safe-action` を採用する
   場合、hook 経由の呼び出し（`useAction`）に両方を統一できる
   可能性がある。強制的に 1 つの形へ寄せることは提案しない
   （imperative UI パターン自体は残る可能性が高い）が、戻り値の shape
   だけは検討の余地がある。

7. **Ticket Opportunity のタイムライン計算は正しさに比して複雑度が
   高い。** `ticketOpportunityTimeline.ts`/`ticketOpportunityFormatting.ts`
   の「1 milestone = 1 row へ flatten → primary row 選択（非過去優先、
   post-final retention の 2nd pass）→ 月グループ化」という 3 段の
   純粋関数群は、個々の判定ルール（2.7 参照）はどれも正当な product
   decision の積み重ねだが、実装が「同じ配列を複数回スキャンしながら
   Map を作る」形で書かれており、読みやすさより歴史的な差分の積層が
   優先されている印象がある。v2 では 2.7 に列挙したルール自体は
   忠実に再現しつつ、実装は最初から 1 つの設計として書き直すべき
   （移植ではなく再実装という docs/v2/README.md の方針どおり）。

8. **Invitation の opacity 境界は「バグらせやすい」領域として v2 実装
   者が特に注意すべき。** 1.7 の 3 分岐・inviter への不透明性・
   invitation 通常 read の invitee 限定は、セキュリティというより
   プライバシー（他人の participation state の間接的推測経路を
   作らない）の要件であり、機能的には「動いているように見える」
   実装でも要件を静かに破りうる（例: エラーメッセージや revalidate
   タイミングの違いから間接的に invitee の状態が漏れる、等）。v2 実装
   時はこの節をレビューのチェックリストとして明示的に使うことを
   推奨する。

9. **filter state の localStorage シリアライズは Zod で自明に置き
   換えられる。** `parseCatalogFilterState`/`serializeCatalogFilterState`
   （`src/domain/catalogFilterIntegration.ts` 内、実体は
   `catalogFilterSheet.ts`）は手書きの type guard
   （`isStringArray`/`isRecordOfStringArrays`）で untrusted JSON を
   narrow しているが、v2 は Zod をすでに採用するため
   `z.object({...}).safeParse()` に置き換えれば同じ「壊れたら
   `EMPTY_CATALOG_FILTER_STATE` にフォールバックする」契約を保ったまま
   コード量を削減できる。

10. **未確認・要検証事項（v2 着手前に確認すべき open item）**:
    - magic link 送信・invite-by-email・schedule share-by-email の
      いずれについても、rate limiting/abuse 対策の有無をこのコード
      範囲内では確認できなかった（Supabase Auth 側のレート制限に
      依存している可能性があるが、application 層に明示的な
      throttle は見当たらない）。
    - `import_ticket_opportunity` RPC 自体の引数・trigger・SQLSTATE
      は `scripts/lib/ticketOpportunityImport.mjs` からの呼び出し
      箇所までしか確認しておらず、migration 本体は未読。
    - `supabase/migrations/**` 側の RLS ポリシー名・列 grant・
      trigger 名は、すべて `src/infrastructure/supabase/**` の
      コメントに書かれた名称からの間接引用であり、migration ファイル
      自体との突合はしていない。

以上。
