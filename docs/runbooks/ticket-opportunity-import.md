# Ticket Opportunity import runbook

Canonical Task Contract: Issue #163（product decision #157、data model #162）。
この runbook は、公式 Ticket source（抽選・先行・一般発売等）を shared
`TicketOpportunity` データへ取り込む operator 手順だけを対象とします。
汎用の import platform ではありません。

対象は **operator-assisted import** だけです。一般 authenticated user 向け
の URL 入力 import UI は提供しません。`ticket_opportunities` /
`ticket_opportunity_target_occurrences` / `ticket_opportunity_milestones`
は authenticated に SELECT only を許可しており、書き込みは
service_role-only の `import_ticket_opportunity` RPC 経由に限られます
（`supabase/migrations/20260828000300_create_import_ticket_opportunity_rpc.sql`）。

Event catalog import（`docs/runbooks/catalog-import.md`, Issue #73）と同じ
authority principle を採用します。責務の分離、seed を repository へ
commit しない理由、`.git/info/exclude` の扱いは、あちらの runbook と
同一です。ここでは Ticket Opportunity 固有の semantics だけを記載します。

## この経路が存在する理由

`/tickets`（#144）や Home（#143）を実際の公式スケジュールで dogfood
するには、宝塚友の会 PDF、Vpass、松竹、artist/FC ページ等の
heterogeneous な source から、漏れなく `TicketOpportunity` / milestone /
target Occurrence を投入できる経路が要ります。#157 の product decision
どおり、これは詳細な application tracking や Ticket inventory ではなく、
「いつ、何の抽選・先行・販売開始があるのか」を見るための最小限の
schedule データです。

## 責務の分離

| 工程                      | 担当                                      | 置き場所      |
| ------------------------- | ----------------------------------------- | ------------- |
| 公式ページ/PDF の読み取り | agent（依頼ベース）                       | repository 外 |
| seed file の review       | operator                                  | ローカル      |
| catalog への適用          | `scripts/import-ticket-opportunities.mjs` | repository    |

**repository には site-specific な HTML/PDF parser もクローラーも
入れません。** 宝塚友の会 PDF、Vpass、松竹、artist/FC ページはレイアウトが
まったく異なり、per-site parser は Issue #163 が明示的に scope 外とする
汎用 crawler そのものです。

## Ticket Opportunity と Event catalog import の違い

- Ticket Opportunity に owner 概念はありません。`--owner` は不要です。
- shared write authority は 1 つの RPC（`import_ticket_opportunity`）に
  集約されています。Event import の
  `import_event_with_occurrences`/`import_update_event` のような
  create/update の 2 経路分岐はなく、RPC 自身が
  「`source_key` が無ければ作成、あれば upsert」という単一の
  idempotent 経路です。
- **within-opportunity replace-all semantics**: 同じ opportunity
  `source_key` を再 import すると、その Opportunity 自身の列（列）に加え、
  target occurrence の関連と milestone は **全置換** されます（RPC 自身の
  atomic transaction）。前回の import にあった milestone や target
  occurrence が今回の seed に無ければ、それらは消えます。これは意図された
  挙動です — 例えば source が result 発表日を後から削除・訂正した場合、
  古い `result_announcement` milestone は次の import で消えます。
- **directory-level の stale 削除はありません。** 今日の seed
  directory に Opportunity A/B しか無く、昨日の directory に C も
  あった場合でも、DB 上の C は削除されません。この script に
  削除経路は 1 つも存在しません。「seed に無くなった Opportunity を
  自動削除する」ポリシーは Issue #163 の scope 外です。
- **personal state（`user_ticket_opportunity_states` の `planned`/
  `applied`）には一切触れません。** import は shared data
  （`ticket_opportunities` / target occurrences / milestones）だけを
  書き換えます。同じ `source_key` の再 import で、既存 user の
  `planned`/`applied` が作成・変更・削除されることはありません
  （`test/rls/ticketOpportunityImportScript.test.mjs` の
  "re-importing an Opportunity never touches an existing personal
  planning state" で確認済み）。

## seed file の形式

1 ファイル 1 opportunity（または opportunity の配列）。
`data/ticket-imports/` 配下に、宝塚友の会・Vpass・松竹・artist/FC 等
source ごとにディレクトリを分けて構いません
（`loadAndValidateSeed` はファイルまたはディレクトリを受け付け、
ディレクトリの場合は配下の `*.json` を名前順にすべて読みます）。

```json
{
  "eventSourceKey": "takarazuka:2026:example:tokyo",
  "sourceKey": "takarazuka:2026:example:tokyo:lottery1",
  "displayName": "第1抽選",
  "sourceUrl": "https://example.invalid/tickets",
  "memo": "友の会員向け",
  "targetScope": "event_wide",
  "milestones": [
    { "type": "application_open", "precision": "date", "date": "2026-08-01" },
    { "type": "application_close", "precision": "datetime", "at": "2026-09-05T17:00:00+09:00" },
    {
      "type": "payment_window",
      "precision": "window",
      "startsAt": "2026-09-10T18:00:00+09:00",
      "endsAt": "2026-09-13T23:59:00+09:00"
    }
  ]
}
```

### `eventSourceKey` — 対象 Event の特定

Ticket Opportunity 自身の `sourceKey` と、対象 Event を特定する
`eventSourceKey` は別の authority です（#162
「Event `source_key` と TicketOpportunity `source_key` は別authority」）。
`eventSourceKey` は `docs/runbooks/catalog-import.md` の import で
`events.source_key` に入っている値をそのまま使います。DB UUID を
seed へ手書きすることは避けます — 対象 Event が catalog import 済み
であることが前提です。

### `sourceKey` — Opportunity 自身の identity

1 つの source ページ/PDF に複数の Opportunity が載ることがあるため
（例: 宝塚友の会の同一 schedule PDF が 第1〜第3抽選 + 一般前売を列挙
する）、`sourceUrl` だけを identity にはできません。`sourceKey` は
公式 URL/PDF の構造とその Opportunity 固有のラベルから機械的に導き、
命名を発明しません。

| source     | 形                                                     | 例                                                |
| ---------- | ------------------------------------------------------ | ------------------------------------------------- |
| 宝塚友の会 | `takarazuka:tomonokai:<年>:<作品slug>:<抽選/前売種別>` | `takarazuka:tomonokai:2026:ponoichizoku:lottery1` |
| Vpass      | `vpass:<公式ID>:<募集種別>`                            | `vpass:12345:general`                             |
| 松竹       | `shochiku:<年>:<作品slug>:<会員種別>`                  | `shochiku:2026:kabukiza-example:platinum`         |
| artist/FC  | `fc:<アーティスト>:<年>:<募集種別>`                    | `fc:example-group:2026:fc-lottery`                |

同じ source URL に複数 Opportunity が列挙されている場合、それぞれに
別の `sourceKey` を割り当てます。命名規則自体は source ごとに違って
構いません — 重要なのは「公式ページ/PDF を見ながら operator が
review できる、stable な識別子であること」です。

### `targetScope` と `targetOccurrences` — 対象範囲

- `"event_wide"`: Event 全体が対象。`targetOccurrences` は指定しません
  （指定すると validation error）。「その時点で存在する Occurrence
  一覧」への snapshot 展開はしません — DB 側も `event_wide`
  Opportunity には target-occurrence 行を一切持たせません
  （trigger で enforce）。
- `"selected_occurrences"`: 特定の Occurrence だけが対象。
  `targetOccurrences` に、対象 Occurrence の **開演日時
  （`startsAt`, Asia/Tokyo offset 明示）** を文字列配列で列挙します。
  DB UUID ではなく、公式ページ/PDF から読み取れる開演日時で指定します
  — `(event_id, starts_at)` は Occurrence を一意に特定する現行の
  canonical identity です
  （`event_occurrences_event_id_starts_at_key`, Issue #79）。

```json
{
  "targetScope": "selected_occurrences",
  "targetOccurrences": ["2026-09-01T13:00:00+09:00", "2026-09-02T13:00:00+09:00"]
}
```

validation は次を reject します（dry run 時点、DB constraint 違反を
待ちません）:

- `event_wide` + `targetOccurrences` 指定
- `selected_occurrences` + `targetOccurrences` 空/未指定
- `targetOccurrences` の要素が対象 Event に存在しない開演日時
  （「target occurrence not found」）
- `targetOccurrences` 内の offset 省略

同じ開演日時が重複して列挙された場合は validation error にはせず、
重複排除して 1 件として扱います（RPC 自身が `p_occurrence_ids` を
`array_agg(distinct ...)` するのと同じ扱い）。

### `milestones` — 時系列の各段階

`type` は次の 5 種類のいずれかです（#162 landed vocabulary）:

- `application_open`（申込開始）
- `application_close`（申込締切）
- `result_announcement`（当落発表）
- `sale_start`（販売開始）
- `payment_window`（支払い/決済期間）

`precision` は 3 種類で、それぞれ必須フィールドが異なります。

| precision  | 必須フィールド                          | 例                                                                                            |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `date`     | `date`（`YYYY-MM-DD`）                  | `{ "type": "result_announcement", "precision": "date", "date": "2026-09-10" }`                |
| `datetime` | `at`（offset 明示）                     | `{ "type": "application_close", "precision": "datetime", "at": "2026-09-05T17:00:00+09:00" }` |
| `window`   | `startsAt`/`endsAt`（両方 offset 明示） | `{ "type": "payment_window", "precision": "window", "startsAt": "...", "endsAt": "..." }`     |

**source に無い milestone は行ごと作りません。** 「メールで通知」等の
非 temporal な記述からの偽 datetime 生成、当落発表日が未公表の場合の
埋め合わせ、開催されるか未確定な conditional phase の先行作成は
いずれも禁止です（#162/#163 「source に無ければ捏造しない」）。
`date`-precision を `00:00` の `datetime` へ変換することも禁止です。
`datetime`/`window` の時刻は必ず Asia/Tokyo offset（`+09:00`）を明示し、
省略された場合は validation error になります（UTC として 9 時間ずれて
解釈される事故を防ぐため）。

1 Opportunity 内に同じ `type` の milestone を 2 つ以上置くことはできません
（`unique(opportunity_id, milestone_type)`、dry run 時点で reject）。

### source 上の display label の扱い

「第1抽選」「ゴールド会員先行」「FC先行」「プレリク」「一般発売」等の
source 固有ラベルは `displayName` へそのまま保持し、`milestone type`
や closed enum へ丸め込みません。

## 手順

### 1. seed file を用意する

agent へ公式 URL/PDF を渡して依頼します。生成物は primary checkout の
`data/ticket-imports/` に置きます（`data/catalog-imports/` と同じ理由 —
public repository へ第三者の公開スケジュールを転載しないため、
`.gitignore` で除外済みです。`.git/info/exclude` への追記が必要な
条件は `docs/runbooks/catalog-import.md`「保管場所」節と同一です）。

### 2. dry run

```bash
npm run tickets:import -- ./data/ticket-imports
```

`--apply` を付けない限り一切書き込みません。各 Opportunity について
次が出力されます: 対象 Event / `sourceKey` / `displayName` /
create・update・unchanged の別 / `targetScope` / 対象 Occurrence 件数
（selected の場合）/ milestone 一覧 / `sourceUrl`。update の場合は
どのフィールドが変わるか（詳細情報、target occurrence 件数、milestone
一覧の前後比較）も表示されます。公式ページ/PDF と突き合わせて
review してください。

### 3. 適用

```bash
npm run tickets:import -- ./data/ticket-imports --apply
```

remote へ適用する場合は `docs/runbooks/catalog-import.md`「3.
適用」節の 3a〜3c（project link / service_role key 取得）と同一の
手順を踏んでください。この runbook はその手順を複製しません。

```bash
npm run tickets:import -- ./data/ticket-imports --apply --remote
```

`STAGE_TRACKER_REMOTE_SUPABASE_URL` / `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY`
の扱い（session-local な export のみ、`.env` 等へ書き込まない、
project ref/service_role key を Issue/PR/commit へ書かない）は
Event catalog import と共通の Secret boundary に従います
（`scripts/lib/adminTarget.mjs`）。

### 4. 確認

`/tickets`（#144 実装後）または直接 Supabase Studio で、対象
Opportunity の `displayName`/`targetScope`/milestone が公式ページと
一致すること、対象 Event の Occurrence が正しく紐づいていることを
確認します。

## 次 session への依頼テンプレート

> `docs/runbooks/ticket-opportunity-import.md` の手順で、次の公式
> Ticket source を追加 import してください。
>
> - 対象 URL/PDF: `<公式ページ/PDF の URL>`
> - 対象 Event の `eventSourceKey`: `<catalog import 済みの source key>`
> - 適用範囲: dry run のみ / local `--apply` / remote `--apply --remote`
>   のいずれか
> - seed file は primary checkout の `data/ticket-imports/` に置くこと
>   （linked worktree 内には置かない）
>
> production credential はこの依頼に含めません。remote 適用が必要な
> 場合は `docs/runbooks/catalog-import.md`「3. 適用」節の手順で、
> 実行 session 内で project ref / service_role key を都度取得して
> ください。

## 既知の制約

- destructive な stale-removal（source から消えた Opportunity の
  自動削除）はありません。誤って作成した Opportunity の訂正・削除手段は
  この script では提供しません（Ticket Opportunity の deletion
  semantics 自体が未決定です）。
- `eventChanged`（既存 Opportunity を別の Event へ re-point する
  re-import）は RPC レベルでは拒否されず、dry run 上で `!` マーク付きの
  警告として表示されるだけです。意図しない Event 変更を防ぐのは
  この dry run review だけです。
- source の取得日時 / snapshot version は保持しません。
- copyrighted な source 本文（PDF 全文・ページ全文）を repository へ
  転載しません。`test/rls/ticketOpportunityImportScript.test.mjs` の
  fixture も、宝塚友の会/Vpass/松竹/artist・FC の実データを転載せず、
  各 source が持つ shape（複数抽選+一般前売、result 日時なし、
  会員種別ごとの複数 sale phase、application window + result/payment
  window）だけを合成データで再現しています。
