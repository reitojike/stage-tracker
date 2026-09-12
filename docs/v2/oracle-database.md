# oracle: 現行データベース仕様（最終状態）

このドキュメントは `supabase/migrations/**`（57本、`20260820000000` 〜
`20260913000000`）と `test/rls/**` を読み、57本を1本に畳んだ **今の DB の姿**を
記述したものです。v2 実装者はこのドキュメントだけを見て再実装します。差分の
歴史（どの Issue でどう変わったか）は意図的に省き、最終的に成立している
schema / RLS / function / invariant だけを記載します。

途中で導入され、後続の migration で drop / 置換された内容（例:
`events.starts_at`/`ends_at` 列、`create_event_with_occurrence`、Ticket 精算
モデル全体）は、最終状態に存在しないため本文には含めません。v2 で「なぜ
無いのか」を誤解しないよう、該当箇所には「(historical, 現在は存在しない)」
と明記します。

確認できていない点（アプリケーション側コードや実運用データまで見ないと
わからない事項）は「未確認」と明記します。

---

## 0. 全体アーキテクチャの前提

- RLS はほぼ全テーブルで有効。`anon` ロールはどのテーブルにも一切の権限を
  持ちません（`revoke all on ... from public, anon, authenticated` を明示し
  てから必要な grant だけを積み戻す、という一貫した書式が全 migration で
  踏襲されています）。
- Supabase のデフォルト権限は新規 `public` テーブルに対して
  `anon`/`authenticated` へ `TRUNCATE + REFERENCES + TRIGGER + MAINTAIN`
  を自動付与してしまう（`TRUNCATE` は RLS を一切迂回する）。そのため
  ほぼ全テーブルの migration が `revoke all ... from public, anon,
authenticated` を明示してからテーブル/列単位で必要な権限だけを再付与
  している。v2 でも同じ罠がある前提で設計すること。
- `service_role` は Postgres の `BYPASSRLS` 属性を持つが、PostgREST は
  RLS とは別にテーブルレベル権限も見るため、`service_role` にも明示的な
  `grant select, insert, update, delete` が必要（RLS バイパス =
  権限不要、ではない）。
- 列レベル grant が「system-managed field」境界として多用されている。
  `id` / `created_at` / `updated_at` はどのテーブルでも authenticated へ
  一切 grant されない。`owner_id` は INSERT のみ許可（WITH CHECK で
  caller 自身に固定）、UPDATE 権限自体を握らせないことで「所有権移転
  不可」を RLS 評価より前の grant レベルで止めている。
- ほとんどの書き込み系 RPC は `set search_path = ''` を明示している
  （function search path が可変だと解決先スキーマを乗っ取られ得る、という
  Postgres のハードニング対策）。v2 でも新規 SECURITY DEFINER 関数には
  必ず同じ指定をすること。
- SECURITY DEFINER と SECURITY INVOKER の使い分けは明確な規則がある:
  - **一般 authenticated ユーザーが直接 grant を持たない操作**
    （event 作成、invitation 作成・decline、personal schedule の
    email 共有、occurrence/event 削除など）は SECURITY DEFINER。
    呼び出し元の RLS では本来できないことを、関数所有者(postgres)権限で
    実行する。
  - **service_role からしか呼ばれない import/operator 系 RPC**
    （`import_event_with_occurrences` / `import_update_event` /
    `import_ticket_opportunity` / `import_event_classification`）は
    SECURITY INVOKER（デフォルト）。呼び出し元(service_role)が既に
    テーブル権限と BYPASSRLS を持つため、DEFINER にすると不要な権限昇格
    経路を作ってしまうという理由で意図的に INVOKER。
- カスタム SQLSTATE の慣習（アプリ側 `classifyWriteError` 等がこれで分岐
  する前提）:
  - `42501`（insufficient_privilege）: 権限がない、または「存在しない/
    所有していない」を意図的に区別しないケース（non-owner が存在を
    推測できないようにするため）。
  - `90001`（application-defined）: 削除がダウンストリームデータ
    （participation / invitation）の存在によりブロックされた。
  - `90002`（application-defined）: 対象 occurrence/event が
    effectively canceled のため、新規の active action が拒否された。
  - `22004` / `22023` / `23514` / `23505` / `23503`: それぞれ標準
    Postgres 分類（必須値欠落 / 不正な値 / CHECK違反 / 一意制約違反 /
    外部キー違反）をそのまま使い、独自コードを起こしていない。

---

## 1. テーブル一覧

### 1.1 `events` — 興行（公演そのもの）の shared catalog エントリ

| column      | type        | nullable | default             | 意味                                                                               |
| ----------- | ----------- | -------- | ------------------- | ---------------------------------------------------------------------------------- |
| id          | uuid        | NOT NULL | `gen_random_uuid()` | PK                                                                                 |
| owner_id    | uuid        | NOT NULL | —                   | 作成者=情報管理者。FK → `auth.users(id)`（ON DELETE 指定なし = NO ACTION）         |
| title       | text        | NOT NULL | —                   | 興行名                                                                             |
| venue       | text        | NULL     | —                   | 会場（exact text。venue master は無い）                                            |
| source_url  | text        | NULL     | —                   | 参照 URL                                                                           |
| memo        | text        | NULL     | —                   | メモ                                                                               |
| created_at  | timestamptz | NOT NULL | `now()`             |                                                                                    |
| updated_at  | timestamptz | NOT NULL | `now()`             | トリガーで実更新時のみ更新                                                         |
| source_key  | text        | NULL     | —                   | import 由来の冪等性キー。手動作成イベントは null のまま                            |
| starts_on   | date        | NOT NULL | —                   | Event range 開始日（Asia/Tokyo calendar date）                                     |
| ends_on     | date        | NOT NULL | —                   | Event range 終了日（両端 inclusive）                                               |
| genre_id    | uuid        | NULL     | —                   | FK → `genres(id)`（ON DELETE 指定なし = NO ACTION）。0..1                          |
| canceled_at | timestamptz | NULL     | —                   | Event-level cancellation。null=active、not null=canceled（値そのものに意味はない） |

(historical, 現在は存在しない): `starts_at` / `ends_at`。PR B 時点では
event が直接この2列を持っていたが、`event_occurrences` 導入時に全行を
occurrence へ backfill した上で drop 済み。

PK/UK/FK:

- PK: `id`
- FK: `owner_id → auth.users(id)`（NO ACTION）
- FK: `genre_id → genres(id)`（NO ACTION／実質 RESTRICT。genre 削除経路が
  存在しないため未検証）
- UK: `events_source_key_key` — `(source_key)` の **部分**一意インデックス
  （`WHERE source_key IS NOT NULL`）。手動作成イベント（source_key が
  すべて null）同士は衝突しない。

CHECK:

- `events_starts_on_le_ends_on`: `starts_on <= ends_on`
  → invariant: 「Event range の開始日は終了日以前でなければならない」

Constraint trigger（詳細は §3）:

- `events_range_contains_occurrences`（AFTER UPDATE OF `starts_on`,
  `ends_on`, DEFERRABLE INITIALLY IMMEDIATE）
  → invariant: 「Event range を狭める更新は、既存の全 occurrence の
  開演日を引き続き含んでいなければ拒否される」

Index:

- `events_owner_id_idx (owner_id)`
- `events_source_key_key`（上記 UK と同一）
- `events_genre_id_idx (genre_id)`

### 1.2 `event_occurrences` — 公演回

| column      | type        | nullable | default             | 意味                           |
| ----------- | ----------- | -------- | ------------------- | ------------------------------ |
| id          | uuid        | NOT NULL | `gen_random_uuid()` | PK                             |
| event_id    | uuid        | NOT NULL | —                   | FK → `events(id)`（NO ACTION） |
| starts_at   | timestamptz | NOT NULL | —                   | 開演日時                       |
| ends_at     | timestamptz | NULL     | —                   | 終演日時（不明可）             |
| created_at  | timestamptz | NOT NULL | `now()`             |                                |
| updated_at  | timestamptz | NOT NULL | `now()`             |                                |
| doors_at    | timestamptz | NULL     | —                   | 開場日時（不明可）             |
| canceled_at | timestamptz | NULL     | —                   | Occurrence-level cancellation  |

PK/UK/FK:

- PK: `id`
- FK: `event_id → events(id)`（NO ACTION）
- UK: `event_occurrences_event_id_starts_at_key` — `(event_id, starts_at)`
  一意。「同一 event 内で occurrence は開始 instant で一意に識別される」を
  DB level で強制する制約。

CHECK:

- `event_occurrences_doors_at_le_starts_at`:
  `doors_at IS NULL OR doors_at <= starts_at`
- `event_occurrences_starts_at_le_ends_at`:
  `ends_at IS NULL OR starts_at <= ends_at`
  → 合わせて invariant: 値が設定されている日時の間には
  `doors_at <= starts_at <= ends_at` の順序が成立する。null な項は
  比較対象外。

Constraint trigger:

- `event_occurrences_within_event_range`（AFTER INSERT OR UPDATE OF
  `starts_at`, `event_id`, DEFERRABLE INITIALLY IMMEDIATE）
  → invariant: 「occurrence の `starts_at` を Asia/Tokyo calendar date に
  変換した値は、親 event の `[starts_on, ends_on]` に収まらなければ
  ならない」

Index:

- `event_occurrences_event_id_idx (event_id)`（UK のインデックスと重複
  気味だが drop されず残存）

### 1.3 `catalog_creators` — Event 作成権限の allowlist

| column     | type        | nullable      | default | 意味                                        |
| ---------- | ----------- | ------------- | ------- | ------------------------------------------- |
| user_id    | uuid        | NOT NULL (PK) | —       | FK → `auth.users(id)` **ON DELETE CASCADE** |
| created_at | timestamptz | NOT NULL      | `now()` |                                             |

- 特定 role/permission framework ではなく、「Event 作成」という一機能
  だけに紐づいた membership allowlist。
- 書き込みは `service_role` のみ（運用スクリプト経由）。UPDATE 列は無い
  （行の有無だけが意味を持つ）。

### 1.4 `personal_schedule_entries` — event 非依存の個人予定

| column     | type        | nullable | default             | 意味                                                |
| ---------- | ----------- | -------- | ------------------- | --------------------------------------------------- |
| id         | uuid        | NOT NULL | `gen_random_uuid()` | PK                                                  |
| owner_id   | uuid        | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）                  |
| memo       | text        | NULL     | —                   |                                                     |
| is_all_day | boolean     | NOT NULL | —                   | 終日 or 時刻指定の判別                              |
| starts_on  | date        | NULL     | —                   | 終日エントリの開始日                                |
| ends_on    | date        | NULL     | —                   | 終日エントリの終了日                                |
| starts_at  | timestamptz | NULL     | —                   | 時刻指定エントリの開始                              |
| ends_at    | timestamptz | NULL     | —                   | 時刻指定エントリの終了（不明可）                    |
| created_at | timestamptz | NOT NULL | `now()`             |                                                     |
| updated_at | timestamptz | NOT NULL | `now()`             |                                                     |
| title      | text        | NOT NULL | —                   | 自由記述の件名（旧 `schedule_type` 固定語彙を置換） |
| blocking   | boolean     | NOT NULL | —                   | true=availability を占有、false=表示のみ            |

(historical, 現在は存在しない): `schedule_type text CHECK IN
('paid_leave','work','travel','other')`。`title`/`blocking` 導入時に
drop 済み。

CHECK:

- `personal_schedule_entries_temporal_shape`:
  ```
  (is_all_day AND starts_on/ends_on NOT NULL AND ends_on >= starts_on
   AND starts_at/ends_at IS NULL)
  OR
  (NOT is_all_day AND starts_at NOT NULL AND starts_on/ends_on IS NULL
   AND (ends_at IS NULL OR ends_at >= starts_at))
  ```
  → invariant: 「エントリは終日型か時刻指定型のどちらか一方の形を厳密に
  持ち、混在した行は存在し得ない」

Index: `personal_schedule_entries_owner_id_idx (owner_id)`

### 1.5 `personal_schedule_shares` — 個人予定の共有先

| column              | type        | nullable | default             | 意味                                                       |
| ------------------- | ----------- | -------- | ------------------- | ---------------------------------------------------------- |
| id                  | uuid        | NOT NULL | `gen_random_uuid()` | PK                                                         |
| schedule_entry_id   | uuid        | NOT NULL | —                   | FK → `personal_schedule_entries(id)` **ON DELETE CASCADE** |
| shared_with_user_id | uuid        | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）                         |
| created_at          | timestamptz | NOT NULL | `now()`             |                                                            |

- UK: `(schedule_entry_id, shared_with_user_id)` — 同一エントリを同一
  recipient へ重複共有できない。
- 可変列なし（add/remove のみ。UPDATE grant/policy が存在しない）。

Index: `personal_schedule_shares_schedule_entry_id_idx`,
`personal_schedule_shares_shared_with_user_id_idx`

### 1.6 `occurrence_participations` — 公演回への参加意思

| column        | type                            | nullable | default             | 意味                                      |
| ------------- | ------------------------------- | -------- | ------------------- | ----------------------------------------- |
| id            | uuid                            | NOT NULL | `gen_random_uuid()` | PK                                        |
| occurrence_id | uuid                            | NOT NULL | —                   | FK → `event_occurrences(id)`（NO ACTION） |
| user_id       | uuid                            | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）        |
| status        | `participation_status` enum     | NOT NULL | —                   | `considering` / `attending`               |
| visibility    | `participation_visibility` enum | NOT NULL | `'private'`         | `private` / `public`                      |
| created_at    | timestamptz                     | NOT NULL | `now()`             |                                           |
| updated_at    | timestamptz                     | NOT NULL | `now()`             |                                           |

- UK: `(occurrence_id, user_id)` — 1 occurrence につき 1 user 1 行。
  `not_attending` は永久に非永続（行が無い＝not attending）。

Index: `occurrence_participations_user_id_idx (user_id)`

### 1.7 `occurrence_invitations` — 公演回への未回答招待（pending のみ）

| column        | type        | nullable | default             | 意味                                      |
| ------------- | ----------- | -------- | ------------------- | ----------------------------------------- |
| id            | uuid        | NOT NULL | `gen_random_uuid()` | PK                                        |
| occurrence_id | uuid        | NOT NULL | —                   | FK → `event_occurrences(id)`（NO ACTION） |
| inviter_id    | uuid        | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）        |
| invitee_id    | uuid        | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）        |
| created_at    | timestamptz | NOT NULL | `now()`             |                                           |
| updated_at    | timestamptz | NOT NULL | `now()`             | 実質発火機会が無い（後述）                |

CHECK:

- `occurrence_invitations_not_self`: `inviter_id <> invitee_id`

UK:

- `occurrence_invitations_occurrence_inviter_invitee_key`:
  `(occurrence_id, inviter_id, invitee_id)`

現行意味論（Issue #225/#230 で確定した pending-only モデル、旧
accepted/declined history モデルは supersede 済み）:

- 行の存在 = 「その occurrence へその招待が pending 中」を意味する
  唯一の表現。resolve（decline / invitee が attending に到達）される
  と行ごと削除される。durable な履歴は一切残らない。
- `declined_at` は元々「辞退した事実のスタンプ」用だったが、pending-only
  移行後は `decline_occurrence_invitation` が行を DELETE する。legacy app
  削除後の contract cleanup で column 自体も削除済み（§7参照）。

### 1.8 `ticket_opportunities` — 販売機会（TicketOpportunity, shared）

| column       | type        | nullable | default             | 意味                                             |
| ------------ | ----------- | -------- | ------------------- | ------------------------------------------------ |
| id           | uuid        | NOT NULL | `gen_random_uuid()` | PK                                               |
| event_id     | uuid        | NOT NULL | —                   | FK → `events(id)` **ON DELETE CASCADE**          |
| target_scope | text        | NOT NULL | —                   | CHECK IN `('event_wide','selected_occurrences')` |
| display_name | text        | NOT NULL | —                   | source 上の表示名をそのまま保持                  |
| source_key   | text        | NOT NULL | —                   | UNIQUE。import の冪等キー                        |
| source_url   | text        | NULL     | —                   |                                                  |
| memo         | text        | NULL     | —                   |                                                  |
| created_at   | timestamptz | NOT NULL | `now()`             |                                                  |
| updated_at   | timestamptz | NOT NULL | `now()`             |                                                  |

Index: `ticket_opportunities_event_id_idx`,
`ticket_opportunities_source_key_key`（UNIQUE）

### 1.9 `ticket_opportunity_target_occurrences` — Opportunity ↔ Occurrence（selected_occurrences 用）

| column         | type        | nullable | default | 意味                                                  |
| -------------- | ----------- | -------- | ------- | ----------------------------------------------------- |
| opportunity_id | uuid        | NOT NULL | —       | FK → `ticket_opportunities(id)` **ON DELETE CASCADE** |
| occurrence_id  | uuid        | NOT NULL | —       | FK → `event_occurrences(id)` **ON DELETE CASCADE**    |
| created_at     | timestamptz | NOT NULL | `now()` |                                                       |

PK: `(opportunity_id, occurrence_id)`

Trigger（§3）:

- `ticket_opportunity_target_occurrences_check`（BEFORE INSERT）
  → invariant: 「行は親 Opportunity の `target_scope` が
  `selected_occurrences` の場合のみ存在でき、`occurrence` は必ず親
  Opportunity と同じ event に属する」

Index: `ticket_opportunity_target_occurrences_occurrence_id_idx
(occurrence_id)`

### 1.10 `ticket_opportunity_milestones` — 開催前後のマイルストーン

| column             | type        | nullable | default             | 意味                                                                                                    |
| ------------------ | ----------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| id                 | uuid        | NOT NULL | `gen_random_uuid()` | PK                                                                                                      |
| opportunity_id     | uuid        | NOT NULL | —                   | FK → `ticket_opportunities(id)` **ON DELETE CASCADE**                                                   |
| milestone_type     | text        | NOT NULL | —                   | CHECK IN `('application_open','application_close','result_announcement','sale_start','payment_window')` |
| temporal_precision | text        | NOT NULL | —                   | CHECK IN `('date','datetime','window')`                                                                 |
| date_value         | date        | NULL     | —                   | `temporal_precision='date'` のときのみ非null                                                            |
| at                 | timestamptz | NULL     | —                   | `temporal_precision='datetime'` のときのみ非null                                                        |
| starts_at          | timestamptz | NULL     | —                   | `temporal_precision='window'` のときのみ非null                                                          |
| ends_at            | timestamptz | NULL     | —                   | 同上                                                                                                    |
| created_at         | timestamptz | NOT NULL | `now()`             |                                                                                                         |
| updated_at         | timestamptz | NOT NULL | `now()`             |                                                                                                         |

UK: `(opportunity_id, milestone_type)` — 同一 Opportunity に同種
milestone は最大1件。

CHECK:

- 精度に対応する列グループだけが非null（他は全て null）
  → invariant: 「date-only の情報を datetime/window として偽装しない」
- `temporal_precision <> 'window' OR ends_at >= starts_at`

Index: `ticket_opportunity_milestones_opportunity_id_idx`

### 1.11 `user_ticket_opportunity_states` — 個人の申込予定状態

| column         | type        | nullable | default             | 意味                                                  |
| -------------- | ----------- | -------- | ------------------- | ----------------------------------------------------- |
| id             | uuid        | NOT NULL | `gen_random_uuid()` | PK                                                    |
| user_id        | uuid        | NOT NULL | —                   | FK → `auth.users(id)`（NO ACTION）                    |
| opportunity_id | uuid        | NOT NULL | —                   | FK → `ticket_opportunities(id)` **ON DELETE CASCADE** |
| status         | text        | NOT NULL | —                   | CHECK IN `('planned','applied')`                      |
| created_at     | timestamptz | NOT NULL | `now()`             |                                                       |
| updated_at     | timestamptz | NOT NULL | `now()`             |                                                       |

UK: `(user_id, opportunity_id)` — 行なし＝未登録（実際の申込記録ではない）。

Index: `user_ticket_opportunity_states_opportunity_id_idx`（`user_id` 単独
index は無い。UK のインデックスが `user_id` 先頭の複合btreeなのでそれで
兼用）

### 1.12 `genres` — ジャンルの canonical lookup

| column       | type        | nullable | default             | 意味                               |
| ------------ | ----------- | -------- | ------------------- | ---------------------------------- |
| id           | uuid        | NOT NULL | `gen_random_uuid()` | PK                                 |
| key          | text        | NOT NULL | —                   | UNIQUE。安定識別子（英語スラッグ） |
| display_name | text        | NOT NULL | —                   | 表示名（日本語）                   |
| sort_order   | smallint    | NOT NULL | —                   | UI 表示順                          |
| created_at   | timestamptz | NOT NULL | `now()`             |                                    |
| updated_at   | timestamptz | NOT NULL | `now()`             |                                    |

シード行（3件、Gate A canonical set）: 詳細は §4。

### 1.13 `groups` — 組・グループの canonical lookup

| column       | type        | nullable | default             | 意味               |
| ------------ | ----------- | -------- | ------------------- | ------------------ |
| id           | uuid        | NOT NULL | `gen_random_uuid()` | PK                 |
| key          | text        | NOT NULL | —                   | UNIQUE。安定識別子 |
| display_name | text        | NOT NULL | —                   | 表示名             |
| created_at   | timestamptz | NOT NULL | `now()`             |                    |
| updated_at   | timestamptz | NOT NULL | `now()`             |                    |

genre に紐づかない汎用 identity。宝塚の「組」とアイドルの「グループ」を
同一機構で扱う。

### 1.14 `event_groups` — Event ↔ group（0..N）

| column     | type        | nullable | default | 意味                                    |
| ---------- | ----------- | -------- | ------- | --------------------------------------- |
| event_id   | uuid        | NOT NULL | —       | FK → `events(id)` **ON DELETE CASCADE** |
| group_id   | uuid        | NOT NULL | —       | FK → `groups(id)`（NO ACTION）          |
| created_at | timestamptz | NOT NULL | `now()` |                                         |

PK: `(event_id, group_id)` — 重複関連付けを構造的に防止。

Index: `event_groups_group_id_idx (group_id)`

### 1.15 (historical, 現在は存在しない) `ticket_acquisitions` / `tickets` / `ticket_transfers`

旧「取得済みチケットの在庫・割当・譲渡」モデル。Issue #234
（`20260830010000_remove_legacy_ticket_schema.sql`）で完全に drop 済み
（テーブル・関連トリガー・関連ポリシー・関連 RPC 一式）。現行 product
scope ではない（product-rules.md「Ticket model removal」）。v2 で
再設計する場合は、この oracle が記述する `TicketOpportunity` /
`UserTicketOpportunityState` を前提に、新しい bounded Task として
ゼロから設計すること。この文書の旧構造の記述は「二度と同じ形にしない」
ための参考情報であり、移植対象ではない。

---

## 2. RLS policy（判定ルール）

共通事項: `anon` はどのテーブルにも grant が無いため、以下のテーブルすべて
について SELECT/INSERT/UPDATE/DELETE いずれも不可（policy 云々の前に
権限が無い）。`service_role` は BYPASSRLS を持つため以下の policy は
一切適用されない（`service_role` は運用/import 専用に限定して使う前提）。

### `events`

- **SELECT**: `authenticated` 全員が全行を読める（`events_select_authenticated`,
  `using (true)`）。shared catalog なので owner に限定しない。
- **INSERT**: policy `events_insert_own` は
  `owner_id = auth.uid() AND catalog_creators に自分の行がある` を要求
  するが、`authenticated` への INSERT 列 grant が一切無いため、通常の
  テーブル API から到達不能（defense-in-depth として維持されているだけ）。
  実際の作成経路は RPC `create_event` のみ。
- **UPDATE**: owner のみ (`events_update_own`,
  `using/with check (owner_id = auth.uid())`)。列 grant は
  `title, venue, source_url, memo, starts_on, ends_on, canceled_at` の
  みで、`owner_id` / `source_key` / `genre_id` は owner であっても直接
  書き換え不可（owner 移転不可、import 由来の識別子は operator 経路
  限定、classification は import 経路限定）。
- **DELETE**: policy 自体が存在しない。削除は RPC `delete_event` のみ
  （SECURITY DEFINER）。

### `event_occurrences`

- **SELECT**: `authenticated` 全員（`event_occurrences_select_authenticated`,
  `using (true)`）。
- **INSERT**: 親 event の owner のみ (`event_occurrences_insert_own`)。
  列 grant は `event_id, starts_at, ends_at, doors_at`。
- **UPDATE**: 親 event の owner のみ (`event_occurrences_update_own`)。
  列 grant は `starts_at, ends_at, doors_at, canceled_at`。`event_id`
  は UPDATE 不可＝別 event への付け替え不可。
- **DELETE**: policy 無し。削除は RPC `delete_event_occurrence` のみ。

### `catalog_creators`

- **SELECT**: 自分自身の行のみ (`catalog_creators_select_own`,
  `user_id = auth.uid()`)。全体一覧は authenticated には見えない。
- **INSERT/UPDATE/DELETE**: `authenticated` への grant が一切無い
  （table-level で `revoke all`）。付与・剥奪は `service_role`
  （運用スクリプト）のみ。designated creator 自身であっても自分の
  membership 行を変更できない。

### `personal_schedule_entries`

- **SELECT**: owner本人、または `personal_schedule_shares` に自分宛の
  行がある場合のみ (`personal_schedule_entries_select_owner_or_shared`)。
  デフォルト private。
- **INSERT**: `owner_id = auth.uid()` のみ (`..._insert_own`)。
- **UPDATE**: owner のみ (`..._update_own`)。共有先 recipient は編集不可。
- **DELETE**: owner のみ (`..._delete_own`)。hard delete。共有先/他人は
  不可。

### `personal_schedule_shares`

- **SELECT**: recipient本人、またはそのエントリの owner
  (`..._select_owner_or_recipient`、owner 判定は SECURITY DEFINER 関数
  `is_personal_schedule_entry_owner` 経由でRLS再帰を回避)。
- **INSERT**: エントリの owner のみ (`..._insert_owner`)。recipient は
  自分に共有されたエントリへ他の recipient を追加できない。
- **UPDATE**: policy 無し（share 行に可変フィールドは無い設計）。
- **DELETE**: recipient本人（自己離脱）、またはエントリの owner
  (`..._delete_owner_or_self`)。recipient は他の recipient の共有を
  削除できない。

### `occurrence_participations`

- **SELECT**: 本人の行、または `visibility='public'` の行
  (`..._select_visible`)。event owner であっても他人の private
  participation は読めない。
- **INSERT**: `user_id = auth.uid()` のみ (`..._insert_own`)。他人の
  代理作成不可（invitation RPC は SECURITY DEFINER で例外的にこの
  policy をバイパスする）。
- **UPDATE**: 本人の行のみ (`..._update_own`)。inviter は invitee の
  `considering→attending` を進めることも、`attending→considering` へ
  戻すこともできない。
- **DELETE**: 本人の行のみ (`..._delete_own`)。辞退は削除で表現。

### `occurrence_invitations`

- **SELECT**: invitee 本人のみ (`occurrence_invitations_select_invitee`)。
  inviter は自分が送った invitation さえ読めない（意図的な opacity。
  §3 の `invite_to_occurrence` 参照）。
- **INSERT/UPDATE/DELETE**: policy も grant も一切存在しない。
  `authenticated` はこのテーブルに書き込む手段を一切持たない。全ての
  変化は SECURITY DEFINER 関数（`invite_to_occurrence(_by_email)`,
  `decline_occurrence_invitation`, トリガー
  `resolve_pending_invitations_on_attending`）経由でのみ発生する。

### `ticket_opportunities` / `ticket_opportunity_target_occurrences` / `ticket_opportunity_milestones` / `genres` / `groups` / `event_groups`

- **SELECT**: `authenticated` 全員 (`..._select_authenticated`,
  `using (true)`)。shared read-only catalog data。
- **INSERT/UPDATE/DELETE**: `authenticated` への grant が一切無い。
  唯一の書き込み経路は `service_role` が呼ぶ import RPC
  （`import_ticket_opportunity` / `import_event_classification`）。
  Event owner であっても classification や Opportunity を直接編集
  できない。

### `user_ticket_opportunity_states`

- **SELECT**: 本人の行のみ (`..._select_own`)。shared read は無い。
- **INSERT**: `user_id = auth.uid()` のみ (`..._insert_own`)。
- **UPDATE**: 本人の行のみ (`..._update_own`)。列 grant は `status` の
  み（`opportunity_id` 付け替え不可）。
- **DELETE**: 本人の行のみ (`..._delete_own`)。

---

## 3. Function / RPC / Trigger

### 3.1 Event catalog 書き込み系

- **`create_event(p_title, p_starts_on, p_ends_on, p_venue default null,
p_source_url default null, p_memo default null, p_starts_at default
null, p_ends_at default null, p_doors_at default null) returns
events`** — SECURITY DEFINER, `authenticated` のみ EXECUTE。
  - 未認証は拒否。呼び出し者が `catalog_creators` に居なければ `42501`。
  - `p_starts_at` が null なのに `p_ends_at`/`p_doors_at` が非null なら
    `22004`（0-occurrence 作成の意図を曖昧にしない）。
  - `owner_id` は常に `auth.uid()`（spoofing不可）。event 行 + （与え
    られていれば）初期 occurrence 1件を同一トランザクションで作成。
    occurrence が Event range 外なら containment トリガーがロール
    バックする。
  - (historical) 旧名 `create_event_with_occurrence` は drop 済み。
- **`import_event_with_occurrences(p_owner_id, p_source_key, p_title,
p_starts_on, p_ends_on, p_occurrences jsonb, p_venue default null,
p_source_url default null, p_memo default null) returns events`** —
  SECURITY INVOKER, `service_role` のみ EXECUTE。
  - owner/source_key/starts_on・ends_on/occurrences配列 いずれか欠落で
    `22004`。owner が `catalog_creators` 非会員なら `42501`。
  - 0件を含む任意件数の occurrence を event と同一トランザクションで
    作成。挿入件数が payload 件数と一致しなければ `23514`
    （malformed 要素の握りつぶし防止）。
- **`import_update_event(p_event_id, p_title, p_starts_on, p_ends_on,
p_venue default null, p_source_url default null, p_memo default
null, p_new_occurrences default '[]', p_occurrence_fixes default
'[]') returns events`** — SECURITY INVOKER, `service_role` のみ。
  - Event range containment の2つの constraint trigger を呼び出し内で
    `SET CONSTRAINTS ... DEFERRED` し、range 変更と occurrence 変更を
    任意の順で適用できるようにする。
  - 実質的な変更が無ければ `events.updated_at` を更新しない（再import
    が無意味に updated_at を進めない）。
  - `p_occurrence_fixes` は `COALESCE` で「既存値を埋める」だけで、
    既にある値をクリアしない。
- **`reschedule_event(p_event_id, p_starts_on, p_ends_on, p_occurrences
default '[]') returns setof event_occurrences`** — SECURITY INVOKER
  （owner 本人が持つ既存の UPDATE 権限をまとめて原子化するだけなので
  DEFINER 昇格が不要）、`authenticated` のみ。
  - owner 本人でなければ `42501`。containment 2トリガーを呼び出し内で
    deferred にし、Event range と、payload に列挙された occurrence の
    時刻を同一トランザクションで一括更新（延期・会期変更を実現する
    唯一の経路）。列挙されなかった occurrence は時刻据え置きのまま新
    range に含まれているか検証される。件数不一致は `23514`。
- **`delete_event_occurrence(p_occurrence_id) returns void`** —
  SECURITY DEFINER, `authenticated`（`anon` は明示 revoke）。
  - 存在しない/所有していない occurrence は区別せず `42501`。
  - `occurrence_participations` または `occurrence_invitations` が
    1件でも存在すれば `90001`（削除拒否）。行ロック
    (`for update`) で並行 INSERT との競合を閉じる。
  - (historical) 旧版は `ticket_acquisitions` の存在もチェックして
    いたが、Ticket モデル撤去に伴い最終 migration でチェック対象から
    除去済み。
- **`delete_event(p_event_id) returns void`** — SECURITY DEFINER,
  `authenticated`。
  - owner でなければ `42501`。全 child occurrence を1つずつロックし、
    いずれか1つでも downstream データがあれば全体を `90001` で拒否
    （部分削除なし、all-or-nothing）。安全なら全 occurrence → event の
    順に削除。
  - (historical) 同上、`ticket_acquisitions` チェックは除去済み。

### 3.2 Cancellation

- **`event_occurrence_is_effectively_canceled(p_occurrence_id) returns
boolean`** — SECURITY DEFINER（`for share` ロック読み取りが
  UPDATE policy の USING も評価されてしまうため、呼び出し者が owner
  でなくても正しく読めるように DEFINER が必須）。`authenticated` と
  `service_role` に EXECUTE。
  - `events.canceled_at OR event_occurrences.canceled_at` の OR。
    両テーブルの当該行を `for share` でロックしてから読み、
    キャンセル操作とのレースを閉じる。
- **`check_occurrence_participation_insert_not_canceled()`**
  （トリガー関数）— 新規 participation の INSERT を、対象 occurrence が
  effectively canceled なら `90002` で拒否。トリガー
  `occurrence_participations_reject_insert_when_canceled`
  （BEFORE INSERT）。
- **`check_occurrence_participation_update_not_canceled()`**
  （トリガー関数）— `considering→attending` への遷移のみを対象に、
  effectively canceled なら `90002` で拒否。トリガー
  `occurrence_participations_reject_attending_when_canceled`
  （BEFORE UPDATE）。同一 status への保存や `attending→considering`
  への降格、DELETE（辞退）は影響を受けない。

### 3.3 Invitation（pending-only, 現行仕様）

- **`invite_to_occurrence(p_occurrence_id, p_invitee_id) returns
void`** — SECURITY DEFINER, `authenticated`。
  - 未認証/自己招待/canceled occurrence はそれぞれ例外
    （自己招待・未認証は generic exception、canceled は `90002`）。
  - inviter が対象 occurrence で `attending` でなければ拒否
    （event owner であることは資格にならない）。
  - 既に pending な invitation があれば冪等 no-op。
  - `pg_advisory_xact_lock((occurrence_id, invitee_id) のハッシュ)` で
    invitee の attending 化との競合を閉じる（invitee の participation
    行が無い場合は行ロックが取れないため）。
  - invitee が既に `attending` なら pending invitation を作らず
    無言で return（opaque）。
  - それ以外は `occurrence_invitations` へ `(occurrence_id, inviter_id,
invitee_id)` を `on conflict do nothing` で挿入するのみ。
  - **現行仕様（Issue #225/#230 以降）**: 招待は invitee の
    participation を一切作成・変更しない。行が無い invitee に対する
    「`considering` を自動作成する」旧挙動は廃止済み。
  - 戻り値は常に `void`。3つの分岐（行なし/considering/attending）は
    呼び出し元から一切区別できない（invitee の private な
    participation 状態を漏らさないための意図的な opacity）。
- **`invite_to_occurrence_by_email(p_occurrence_id, p_invitee_email)
returns void`** — SECURITY DEFINER, `authenticated`。
  - `p_invitee_email` を正規化（trim + lower）し、簡易フォーマット検証
    後、`auth.users`（`deleted_at is null`）を大文字小文字無視で照合。
  - 「該当アカウントなし」を含む invitee 依存の全分岐が同一の `void`
    を返す（`invite_to_occurrence` の opacity をメール解決後も維持）。
  - それ以外のロジックは `invite_to_occurrence` と同一
    （advisory lock、pending 重複の no-op、canceled チェック等）。
- **`decline_occurrence_invitation(p_invitation_id) returns
occurrence_invitations`** — SECURITY DEFINER, `authenticated`。
  - invitee 本人の行のみ `DELETE ... RETURNING`。見つからなければ
    （invitee でない、id が違う、既に resolved 済み）例外を投げず
    `null` を返す（idempotent、二重呼び出しも安全）。
  - **現行仕様**: `declined_at` へのスタンプではなく行そのものの
    DELETE。よって decline された invitation の履歴は一切残らない。
- **`resolve_pending_invitations_on_attending()`**（トリガー関数）—
  SECURITY DEFINER。
  - `occurrence_participations` への INSERT（`status='attending'`時）
    または UPDATE（`old.status IS DISTINCT FROM new.status AND
new.status='attending'`時）で発火。
  - `(occurrence_id, user_id)` に対する advisory lock を取ってから、
    その occurrence/invitee の組に対する **全ての** pending invitation
    （inviter を問わず）を削除する。
  - これが「invitation の accept」の実体そのもの：専用の accept RPC は
    存在せず、通常の participation 書き込み経路（自己作成 attending
    でも invitation 経由でも）が同じトリガーを通る
    （"generic attending convergence"）。
  - 2つのトリガーに分割: `..._ins`（AFTER INSERT, `new.status=
'attending'`）と `..._upd`（AFTER UPDATE, 同条件 + status 遷移
    条件）。Postgres は INSERT トリガーの WHEN 句で `OLD` を参照
    できないための分割。

(historical, 現在は存在しない) 旧 `invite_to_occurrence(_by_email)` /
`decline_occurrence_invitation` は「行なし invitee に `considering` を
自動作成」「decline は `declined_at` スタンプで再招待を永久ブロック」と
いう別モデルだったが、Issue #225/#230 で完全に上書き（`create or
replace`）されている。旧モデルの記述は再実装対象ではない。

### 3.4 Personal schedule

- **`is_personal_schedule_entry_owner(p_entry_id) returns boolean`** —
  SECURITY DEFINER STABLE, `authenticated`。
  - `personal_schedule_shares` 側の policy が
    `personal_schedule_entries` を素朴に相関サブクエリで参照すると
    RLS の相互再帰（"infinite recursion detected in policy"）を起こす
    ため、それを避けるための SECURITY DEFINER ヘルパー。答える内容は
    「caller は指定エントリの owner か」だけで、caller が既に知り得る
    情報しか開示しない。
- **`share_schedule_entry_by_email(p_schedule_entry_id,
p_recipient_email) returns personal_schedule_shares`** — SECURITY
  DEFINER, `authenticated`。
  - owner 本人でなければ拒否。email フォーマット検証、自分自身との
    共有は拒否。
  - 未登録 email は **明示的に例外**（invitation の opacity とは違い、
    共有には invitee 側の private state という隠すべき情報が無いため
    opaque にする理由が無い、という設計判断）。
  - 既存共有への再共有は `on conflict do update`（no-op 相当）で
    idempotent に同じ行を返す。
- **`list_schedule_share_recipient_emails(p_schedule_entry_id) returns
table(share_id, recipient_email, shared_at)`** — SECURITY DEFINER
  STABLE, `authenticated`。
  - owner 本人でなければ拒否。汎用 user directory ではなく、その
    エントリに既に共有済みの recipient の email だけを投影する
    bounded read。

### 3.5 Ticket Opportunity / Classification（import 系、`service_role` 専用）

- **`import_ticket_opportunity(p_event_id, p_source_key,
p_display_name, p_target_scope, p_occurrence_ids default null,
p_source_url default null, p_memo default null, p_milestones
default '[]') returns ticket_opportunities`** — SECURITY INVOKER,
  `service_role` のみ。
  - `target_scope='event_wide'` なのに occurrence 指定があれば拒否、
    `'selected_occurrences'` なのに1件も無ければ拒否、指定
    occurrence が全て `p_event_id` に属していなければ拒否（`23514`）。
  - `source_key` で upsert。既存 Opportunity の target occurrences /
    milestones は **毎回全削除してから payload の内容で作り直す**
    （replace-all。マージしない＝source から消えた項目は次回 import
    で消える）。
- **`import_event_classification(p_event_id, p_set_genre default
false, p_genre_key default null, p_set_groups default false,
p_groups default '[]') returns events`** — SECURITY INVOKER,
  `service_role` のみ。
  - `p_set_genre` / `p_set_groups` は独立した「この facet に触るか」
    フラグ。触らない facet は既存値を一切変更しない（旧 seed が
    classification フィールドを持たなくても安全）。
  - genre: `p_set_genre=true` かつ `p_genre_key=null` は明示的な
    「genre 解除」。未知の key は `22023`。
  - groups: `key` を canonical identity として upsert（`display_name`
    の訂正は同じ key の行を更新するだけで別行を作らない）。この
    event の `event_groups` は replace-all。
  - どちらの facet も「触られなかった event」には一切副作用がない
    （ヒューリスティックな一括分類は行わない）。

### 3.6 Range containment（横断的 invariant）

- **`check_occurrence_within_event_range()`**（constraint trigger 関数）
  — トリガー `event_occurrences_within_event_range`。occurrence の
  INSERT/UPDATE(starts_at, event_id) で発火し、親 event の行を
  `for share` でロックしてから range 内かを検証（`23503`: 親 event
  無し、`23514`: range 外）。
- **`check_event_range_contains_occurrences()`**（constraint trigger
  関数）— トリガー `events_range_contains_occurrences`。event の
  UPDATE(starts_on, ends_on) で発火し、その event の全 occurrence が
  新 range に収まっているか検証（`23514`）。
  - 両トリガーとも `DEFERRABLE INITIALLY IMMEDIATE`。通常の単発更新は
    文末チェック（普通の CHECK と同じ体感）。`reschedule_event` /
    `import_update_event` だけが `SET CONSTRAINTS ... DEFERRED` で
    トランザクション末までチェックを遅延させ、range と occurrence を
    任意の順で書き換えられるようにしている。
  - 両者とも `for share` ロックで読むことで、range 更新と occurrence
    更新が並行しても片方が確実にもう片方の確定後の値を見るように
    直列化している（READ COMMITTED 下でのダブルコミット防止）。

### 3.7 汎用 `updated_at` トリガー

各テーブルごとに専用の1関数（1つの汎用関数を共有しない設計。命名は
`set_<table>_updated_at()`）: `set_events_updated_at`,
`set_event_occurrences_updated_at`,
`set_personal_schedule_entries_updated_at`,
`set_occurrence_participations_updated_at`,
`set_occurrence_invitations_updated_at`（※実質発火機会が乏しい、
§7参照）, `set_ticket_opportunities_updated_at`,
`set_ticket_opportunity_milestones_updated_at`,
`set_user_ticket_opportunity_states_updated_at`,
`set_genres_updated_at`, `set_groups_updated_at`。全て
`BEFORE UPDATE ... FOR EACH ROW` で `new.updated_at := now()` するだけの
同一パターン、`search_path = ''`。

### 3.8 (historical, 現在は存在しない) Ticket 精算モデルの RPC / トリガー

`request_ticket_transfer` / `accept_ticket_transfer` /
`cancel_ticket_transfer` / `pending_ticket_transfer_offer` /
`can_view_ticket_provenance` / `ticket_transfer_recipient_is_eligible`
/ `enforce_secured_acquisition_keeps_tickets` /
`check_ticket_acquisition_insert_not_canceled` /
`set_tickets_updated_at` / `set_ticket_acquisitions_updated_at` /
`set_ticket_transfers_updated_at` は Issue #234 で全て drop 済み。

---

## 4. Enum / lookup table

### Postgres native enum

- **`participation_status`**: `considering`（興味あり/検討中） /
  `attending`（参加確定）。MVP はこの2値のみ。`not_attending` は
  存在しない（行が無いことがその意味）。
- **`participation_visibility`**: `private`（本人のみ、デフォルト） /
  `public`（authenticated 全員に公開）。

### text + CHECK による閉じた語彙（Postgres enum を意図的に避けている）

- `events.genre_id` は enum ではなく `genres` テーブルへの FK
  （理由は下記 lookup table 参照）。
- `ticket_opportunities.target_scope`: `event_wide` /
  `selected_occurrences`
- `ticket_opportunity_milestones.milestone_type`: `application_open` /
  `application_close` / `result_announcement` / `sale_start` /
  `payment_window`
- `ticket_opportunity_milestones.temporal_precision`: `date` /
  `datetime` / `window`
- `user_ticket_opportunity_states.status`: `planned` / `applied`
- (historical) `ticket_acquisitions.status`:
  `pending`/`secured`/`unsuccessful`、`tickets.medium`:
  `paper`/`electronic`、`ticket_transfers.status`:
  `pending`/`accepted`/`cancelled` — いずれも削除済みテーブルの列。

### Lookup table（行として追加可能、DB enum ではない）

- **`genres`**（`key`, `display_name`, `sort_order`）— シード3行:

  | key          | display_name | sort_order |
  | ------------ | ------------ | ---------- |
  | `takarazuka` | 宝塚         | 1          |
  | `kabuki`     | 歌舞伎       | 2          |
  | `idol`       | アイドル     | 3          |

  永久固定の3値ではなく、将来行を追加するだけで genre を増やせる設計
  （enum 拡張のような破壊的マイグレーションを避けるため）。

- **`groups`**（`key`, `display_name`）— 宝塚の「組」とアイドルの
  「グループ」を同一機構で扱う汎用 lookup。genre に紐づかない
  （genre との関連は `event_groups` を介して動的に導出する）。

---

## 5. Product invariant の一覧（DB level で強制）

1. Event range は `starts_on <= ends_on`（`events_starts_on_le_ends_on`）。
2. 同一 event 内で occurrence は開始 instant（`starts_at`）によって一意に
   識別される。2つの occurrence が同一 event 内で同じ開始 instant を
   持つことはできない（`event_occurrences_event_id_starts_at_key`）。
3. occurrence の開場・開演・終演には、値が設定されている限り
   `doors_at <= starts_at <= ends_at` の順序がある。未設定の項は
   比較対象から除外される。
4. occurrence の `starts_at` を Asia/Tokyo calendar date に変換した日付は、
   常に親 event の `[starts_on, ends_on]` に収まっていなければならない
   （新規挿入・時刻変更・親 event の range 変更のいずれの方向からの
   違反も constraint trigger で拒否される）。
5. Event の Event range を狭める更新は、既存の全 occurrence がその新しい
   range に収まっている場合にのみ成立する。
6. personal schedule entry は「終日型」か「時刻指定型」のどちらか一方の
   形を厳密に持つ。両者が混在した行、どちらの形にも当てはまらない行は
   存在し得ない。
7. `occurrence_participations` は 1 occurrence につき 1 user 1 行のみ
   （`considering`/`attending` の重複行は作れない）。`not_attending` を
   表す永続化された値は存在しない。
8. `occurrence_invitations` は自己招待できない（`inviter_id <>
invitee_id`）。同一 `(occurrence, inviter, invitee)` の組につき
   pending invitation は最大1件。
9. invitation は inviter からは自身が送った招待の存在すら読み取れず
   （opacity）、招待操作は invitee の participation を
   `attending→considering` へ降格させることも、`considering/なし
→attending` へ昇格させることもできない。invitee 自身の書き込みだけが
   `attending` を成立させられる。
10. invitee の participation が（どの経路であれ）`attending` に到達した
    瞬間、その occurrence に対する invitee 宛の pending invitation は
    inviter を問わず全て消える。
11. 「effective cancellation」は Event-level `canceled_at` と
    Occurrence-level `canceled_at` の OR。Event の uncancel は個別に
    canceled な Occurrence の cancellation を自動解除しない。
12. effective cancellation 状態の occurrence には、新規 participation の
    作成、`considering→attending` への遷移、新規 invitation の作成が
    いずれも拒否される。既存データの withdraw（削除）や
    `attending→considering` への降格、無関係な列の更新は影響を受けない。
13. Event/Occurrence の hard delete は、`occurrence_participations` /
    `occurrence_invitations` が1件でも存在する occurrence を含む限り
    拒否される（部分削除なし。Event 削除は全 child が安全な場合のみ
    atomic に成立する）。
14. Event の owner、Occurrence の管理権限は常に親 Event の owner から
    導出される（Occurrence 自体に独立した owner 概念は無い）。
15. `events.owner_id` / `personal_schedule_entries.owner_id` は
    INSERT 時にのみ書き込め、UPDATE では書き込めない
    （所有権の移転が構造的に不可能）。
16. Event 作成は `catalog_creators` に登録された designated creator の
    みが行える。
17. `ticket_opportunities.target_scope = 'event_wide'` の Opportunity は
    `ticket_opportunity_target_occurrences` に一切行を持たない
    （"whole event" をその時点の occurrence 集合のスナップショットとして
    保持しない）。`selected_occurrences` の Opportunity が指す
    occurrence は必ず同じ event に属する。
18. `ticket_opportunity_milestones` は精度（date/datetime/window）に
    対応する列グループだけが埋まる。ソースが与えていない時刻を
    偽装しない。
19. Event の genre は 0..1（単一の nullable FK）。Event と group の
    関連は 0..N（`event_groups` 経由）。この非対称は意図的
    （group は将来の合同興行のため最初から多対多、genre は将来の
    複数ジャンル対応が具体化するまで単一のまま）。
20. classification（genre/group 付与）は import RPC 経由でのみ変更でき、
    Event owner を含むどの authenticated ユーザーも直接編集できない。

---

## 6. RLS test で検証されている観点

`test/rls/**` のテスト名（node:test、実 local Supabase/Postgres に対して
実行）から抽出した、検証されている**性質**の一覧（テストコードの構造は
省く）。

### Event catalog 全般

- shared read: authenticated は誰の event/occurrence も読める。anon は
  event/occurrence/catalog_creators/participation/invitation/personal
  schedule/ticket opportunity/classification のいずれも読めない
  （全テーブルで anon 拒否が個別に検証されている）。
- owner-only write: 非owner は event/occurrence を更新・削除できず、
  行は変化しない。owner 自身も `id`/`created_at`/`updated_at`/`owner_id`
  を直接書き換えられない。`updated_at` は実更新時のみ DB が自動更新する。
- create は `create_event` RPC 経由のみ: 直接 INSERT は列 grant が
  完全に無いため失敗する（残存 grant が無いことも直接検証）。owner
  spoofing の入力面が無いこと、`p_starts_on` 欠落は RPC 実行前に
  PostgREST 段階で弾かれること、0-occurrence 作成が成功すること、
  Event range 外の初期 occurrence は event 行ごとロールバックされる
  ことを検証。
- `catalog_creators` membership の grant/revoke がそのユーザーの
  create 可否を即座に切り替えること、revoke 後も既存 event の owner
  としての update/occurrence 追加は継続できること、membership が
  他人の event への write 権限を一切広げないこと。
- occurrence 識別一意性: 同一 event 内で同一 `starts_at` の2件目
  INSERT/UPDATE は拒否、異なる event 間や同一 event 内の異なる instant
  は許可、同時挿入レースでは1件のみ確定すること（同時実行テストあり）。
- Event range containment: range 外の occurrence 挿入/更新の拒否、
  range を狭める更新が既存 occurrence を締め出す場合の拒否、挿入と
  range 更新のどちらが先行しても正しく片方が拒否される並行性テスト
  （2方向×2順序の計4パターン）。
- `doors_at <= starts_at <= ends_at` の順序違反がそれぞれ DB level で
  拒否されること。
- `source_key` の部分一意性（import event 間では一意、manual event
  同士の null は衝突しない）、authenticated からは書き込めず read の
  みできること。
- `import_event_with_occurrences` / `import_update_event` は
  service_role 以外（anon、catalog creator を含む authenticated）から
  実行不可、非 catalog-creator owner を拒否、0件 occurrence の許可、
  range 外 occurrence での全体ロールバック、occurrence-only な再
  import が `events.updated_at` を進めないこと、既存値を上書きしない
  fill-blank-only の fix 適用、他 event に属する occurrence fix id の
  拒否。
- `reschedule_event`: range と occurrence の一括原子的移動、payload に
  含まれない occurrence も新 range との整合性が引き続き検証される
  こと、non-owner 拒否、anon 拒否、他 event に属する occurrence id の
  拒否。
- Event/Occurrence delete: 安全な delete の成功、downstream
  （participation/invitation）存在時の拒否、0-occurrence への遷移が
  有効な状態であること、1件でも unsafe な child があれば event
  全体の delete が全体拒否されること（部分削除が起きないこと）、
  無関係な event/occurrence への副作用が無いこと、削除操作と並行する
  participation insert のレース双方向の安全性。
- 大量データ/ページング境界（PostgREST `api.max_rows`=1000超）でも
  取りこぼしが無いこと、id バッチ処理の欠落が無いこと。カタログの
  期間検索（月次一覧、日次一覧、Event range 重複検索）が
  occurrence-based/range-based それぞれの境界条件（空期間、範囲外、
  重複検出、0-occurrence event の可視化、重複時の去重）を満たすこと。

### Cancellation

- owner による cancel/uncancel の往復、non-owner・anon の拒否。
- Event uncancel が既に canceled な子 Occurrence を自動解除しないこと。
- effective cancellation 下での新規 participation 拒否
  （event-level/occurrence-level 双方の原因で）、`considering→
attending` の拒否、`attending→considering`・visibility のみの更新・
  withdraw(削除) は引き続き許可されること。
- invitation の新規作成（uuid版/email版とも）が cancel 下で拒否される
  こと。cancel 操作自体は既存 participation を変更しないこと。
- `service_role` はガード関数を経由しても insert できること（fixture
  経路の生存確認）。
- cancel と participation insert が競合するレースの両方向
  （cancel が先/insert が先）の安全性。

### Participation

- 本人のみが自分の participation を書ける（他人代理不可、他人の行の
  更新・削除も不可、reassignできない、occurrence 付け替え不可）。
- visibility の既定値が `private` であること、`public` への変更で
  他人から読めるようになり、`private` へ戻すと再び読めなくなること。
- event owner でさえ他人の private participation を読めないこと。
- `not_attending` を持つ行を作れないこと（同じリクエスト形状で
  canonical status なら成功する対照実験あり）。
- 同一 occurrence への重複 participation が作れないこと。
- system-managed 列（`id`/`created_at`/`updated_at`）の直接改変不可、
  `updated_at` は実更新でのみ動くこと。
- 列 grant が意図した集合と厳密に一致すること。

### Invitation

- 3つの invitee 分岐（行なし/considering/attending）が inviter からは
  区別不能で、RPC の戻り値がいずれも同一であること。
- 現行モデル: 行なし invitee への招待が participation を作成しない
  こと（旧 auto-considering の廃止確認）。considering invitee には
  invitation のみ作成され participation は不変。attending invitee には
  invitation 自体が作られない。
- inviter は自分が送った invitation を読み返せないこと、attending
  invitee と considering invitee を区別できないこと。
- 招待資格は「対象 occurrence で attending であること」に限られ、
  considering や無参加、event owner であるだけでは資格にならない
  （owner が attending になれば招待できることも確認）。
- 自己招待の拒否。inviter が invitee を attending に昇格させたり
  attending から considering に降格させたりできないこと。
- decline: 該当なし/他人の invitation は行に一切影響を与えず
  no-op であること（inviter 自身も invitee の代わりに decline
  できない）。二重 decline が idempotent であること。
  pending invitation の field がテーブル API から UPDATE できないこと。
- 現行モデル: decline 後の再招待が新しい pending invitation を作れる
  こと（永久ブロックではない）、再招待は participation を作らない
  こと、decline 後も invitee 本人は直接 attending にできること、
  ある inviter の decline が別 inviter からの招待を妨げないこと。
- attending 到達（直接の自己申告でも、既存 considering からの昇格でも）
  が同一 occurrence の pending invitation を inviter を問わず一括で
  解消すること（複数 inviter からの同時 pending も含む）。
- 並行性: rowless invitee への2連続招待+withdraw が participation を
  復活させないこと、複数 inviter からの同時招待が participation を
  作らないこと、同一招待の同時実行が1件に収束すること、招待と
  invitee 自身の attending 化が競合しても pending invitation が
  残留しないこと、同時 decline が1件のみ削除に成功し残りは
  `data: null` で無エラーになること。
- anon の全操作拒否、テーブルへの直接 INSERT/UPDATE/DELETE 不可
  （書き込み surface が完全にゼロであること）。

### Personal schedule

- 終日/時刻指定の各正常系作成、および形状 CHECK 違反（片方の形に
  当てはまらない入力）それぞれの拒否パターン。
- owner 本人の read/update、無関係な user の read/update 拒否
  （行が変化しないことも確認）。
- `owner_id` の spoofing 不可。
- 共有: 共有によって recipient が読めるようになること、owner が
  recipient 一覧を確認できること、recipient は自分の共有行だけ
  見えること、同一 recipient への重複共有が拒否されること、recipient
  は編集不可・他 recipient の追加/削除不可、recipient 自身の
  self-leave が可能でその後読めなくなること、owner による recipient
  削除。
- system-managed 列の直接改変不可、owner 移転不可。
- 削除: owner による hard delete、削除が共有行へ cascade して
  orphan を残さないこと、recipient/無関係ユーザーは削除できず
  owner には見え続けること。

### Ticket Opportunity / Classification / UserTicketOpportunityState

- shared read は authenticated 全員、anon は拒否。
- authenticated（Event owner 含む）は opportunities/milestones/target
  occurrences/genres/groups/event_groups を直接書き込めないこと。
- `import_ticket_opportunity`: event_wide/selected_occurrences の
  相互排他制約、他 event に属する occurrence の拒否、milestone の
  精度別列グループの整合性検証（date-only/datetime/window それぞれの
  値保持、精度違反の拒否、window の順序違反拒否、未公表マイルストーン
  は単に不在として扱われること）、source_key 再import が
  milestones/targets を完全に置換すること、同一 source_url でも
  source_key が異なれば別 Opportunity になること。
- `import_event_classification`: 単一 genre の設定、`p_set_genre=
false` で既存値を変更しないこと、`p_set_genre=true` かつ key なしで
  genre 解除、未知 genre key の拒否、再分類が前の genre を置換して
  蓄積しないこと、複数 group 関連付け、同一 key の group が重複作成
  されず再利用されること、displayName 訂正が canonical 行を更新する
  こと、replace-style の group 追加/削除、空配列での group 解除、
  `p_set_groups=false` で既存を変更しないこと、重複関連付けの構造的
  防止。
- `user_ticket_opportunity_states`: owner のみの CRUD、
  `planned⇄applied` の往復、重複 `(user, opportunity)` の拒否、他人の
  状態を読み書き削除できないこと、`user_id`/`opportunity_id` の
  付け替え不可、import による classification/opportunity 再取込が
  個人状態に一切影響しないこと。
- 運用 import script（`ticketOpportunityImportScript.test.mjs`）:
  dry run が書き込みを行わないこと、同一 seed の再適用が no-op に
  なること、seed 訂正が replace-all で反映されること、occurrence
  locator（安定な startsAt 参照）の解決、未解決 locator/未解決
  Event source key がバリデーションエラーとして扱われ部分書き込みを
  残さないこと、1 event に対する複数 Opportunity の一括 import、
  ディレクトリ入力で「後続 seed に無い Opportunity は放置される」
  こと、再 import が既存の個人状態に触れないこと。

### 横断的な grant/権限監査

- `publicSchemaGrants.test.ts`: `public` スキーマの全テーブルについて
  `anon`/`authenticated` が `TRUNCATE`/`REFERENCES`/`TRIGGER`/
  `MAINTAIN` を一切持たないことを一括監査。加えて
  `events`/`event_occurrences`/`personal_schedule_entries`/
  `personal_schedule_shares` の4テーブルについて、`anon`/
  `authenticated` が保持する特権の集合（列単位の INSERT/UPDATE 対象
  列まで含む）が期待値と**完全一致**することを検証（追加も欠落も
  検知する厳密比較）。
- `migrationDataPreservation.test.ts`: 旧 `events.starts_at/ends_at`
  からの backfill が、既存データを1 event＝1 occurrence として過不足
  なく移行し、移行後に列が実際に drop されていることを検証。

---

## 7. v2 で見直すべき点（提案）

1. **`occurrence_invitations.declined_at` は削除済み。** pending-only
   モデルへの移行後、`decline_occurrence_invitation` は行を DELETE
   するだけでこの列に一切書き込まない。legacy app 削除後の contract
   cleanup で v2 schema から削除した。同様に、この移行後は
   `occurrence_invitations` に対する実質的な UPDATE 経路が無いため、
   `occurrence_invitations_set_updated_at` トリガーもほぼ発火機会が
   ない。v2 では「pending invitation は不変レコード（INSERT/DELETE
   のみ）」として設計し直し、`updated_at` 自体の要否を再検討する
   価値がある。
2. **`auth.users` への外部キーの ON DELETE 方針が一貫していない。**
   `catalog_creators.user_id` は `ON DELETE CASCADE` だが、
   `events.owner_id` / `personal_schedule_entries.owner_id` /
   `occurrence_participations.user_id` /
   `occurrence_invitations.{inviter_id,invitee_id}` /
   `personal_schedule_shares.shared_with_user_id` /
   `user_ticket_opportunity_states.user_id` はいずれも ON DELETE 未
   指定（NO ACTION）。アカウント削除機能が存在しない現状は問題化して
   いないが、v2 でアカウント削除・退会を検討するなら、削除時に何を
   残し何を消すかの方針（shared catalog data は残す、personal data は
   消す等）を先に決め、FK の ON DELETE 句として明示する必要がある。
   現行 v1 はこの点を「まだ決めていないもの」として一度も明示的に
   決定していない。
3. **SECURITY DEFINER RPC 間でのボイラープレートの重複。**
   `invite_to_occurrence` と `invite_to_occurrence_by_email` は
   settle-loop・cancellation チェック・advisory lock の扱いがほぼ
   全文重複している（意図的に「opacity 境界が違うので共有ヘルパーに
   すると漏洩し得る」という理由で分離されているが、結果として同じ
   バグを2箇所で踏みかねない状態）。`create_event` /
   `import_event_with_occurrences` / `import_update_event` /
   `import_ticket_opportunity` / `import_event_classification` も、
   「催しは atomic に作る／replace-all で再取込する」という同じ形の
   パターンを4回別々に実装している。v2 では、opacity 境界のような
   本質的差分はそのまま保ちつつ、共通の書き込みパターン
   （atomic multi-row insert、replace-all upsert、idempotent no-op）
   を明示的に部品化できないか検討する価値がある。
4. **カスタム SQLSTATE の一覧が DB 側に一元化されていない。**
   `42501`/`90001`/`90002` の意味はそれぞれの migration コメントと
   アプリ側 `classifyWriteError` 相当のコードに分散している。v2 では
   コメントに頼らず、コード内の単一箇所（例: 定数モジュール +
   このドキュメントのような oracle）でエラーコード表を正本化すべき。
5. **Event range containment を constraint trigger 2本 + `SET
CONSTRAINTS DEFERRED` の組み合わせで実現している。** 正しく機能
   しているが、この「範囲同士の包含関係」は PostgreSQL の GiST
   排他制約（`btree_gist` + `EXCLUDE USING gist`）や範囲型
   （`daterange`）でより宣言的に表現できる可能性がある。v2 で
   採用する Postgres バージョンと合わせて、素朴な CHECK/トリガーの
   組み合わせのままにするか、範囲型ベースの表現に置き換えるかを
   再検討する価値がある。
6. **genre（0..1、単一 nullable FK）と group（0..N、中間テーブル）で
   モデリング様式が非対称。** 意図的な設計判断（genre は将来の
   多対多化を先送りする明示的決定）だが、スキーマだけを見ると
   一貫性が無いように見える。v2 では、この非対称性の理由
   （product-rules.md「Catalog classification / venue boundary」）を
   コード上のコメントだけでなく、スキーマ設計ドキュメント側にも
   明示しておくべき。
7. **venue は canonical master を持たない生 text、exact match のみ。**
   将来 venue master が必要になった場合の移行コストは v1 では明示的に
   先送りされている（「まだ決めていないもの」）。v2 でこのまま
   踏襲するかどうかは、実データ規模（venue 表記揺れの実態）を見てから
   判断すべき。
8. **`event_occurrences_event_id_idx` が一意制約
   `(event_id, starts_at)` のインデックスと事実上重複している。**
   v1 では「このマイグレーションの scope 外」として意図的に残された
   だけなので、v2 でスキーマを作り直す際は素直に単一インデックスに
   統合してよい。
9. **チケット関連の設計が2世代分、痕跡として残っている。** v1 は
   「取得済みチケットの在庫・割当・譲渡」モデルを一度作り、Issue
   #225→#234 で完全に撤去し、代わりに「販売機会の発見＋個人の申込
   予定状態」という薄いモデル（TicketOpportunity /
   UserTicketOpportunityState）に置き換えた。これは実装してから
   過剰スコープに気づいて引き返した実例であり、v2 で「詳細な申込
   管理・座席・譲渡」を求められた場合は、TicketOpportunity を
   前提に新しい bounded Task としてゼロから設計すべきで、v1 の
   旧モデル（本書 §1.15）を復元してはならない。
10. **並行性まわりのテストが非常に手厚い（行ロック、advisory lock、
    デッドロック回避の順序規律）一方で、その複雑さの多くは
    「invitee の participation 行が存在しない状態」を安全に扱う
    ための advisory lock という、やや特殊な回避策に起因している。**
    v2 で PostgreSQL のバージョンやトランザクション分離レベルの
    選択肢が変わるなら、advisory lock に頼らずに済む代替設計
    （例えば「行が無い」状態自体を作らない upsert 戦略）がないか、
    ゼロから検討する価値がある。少なくとも、この複雑さが実際に
    踏まれたレースコンディションの再現（`test/rls/*Concurrency*`,
    `occurrenceInvitations.test.ts` の該当ケース）から来ている実証済み
    の対策であることは v2 でも踏まえ、単純化する場合は同等のテストで
    再検証すること。
