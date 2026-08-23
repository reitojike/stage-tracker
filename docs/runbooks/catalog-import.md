# Event catalog import runbook

Canonical Task Contract: Issue #73。この runbook は Gate A dogfood の
ために、実在する公演を Event / 公演回として catalog へ materialize する
operator 手順のみを対象とします。汎用の import platform ではありません。

対象は **operator-assisted import** だけです。user-facing な import 導線
（一般 authenticated user が URL を入力して catalog へ登録する UI）は
提供しません。Event 作成は引き続き designated catalog creator に限定
されており（`docs/prd.md` / product-rules.md の MVP Event catalog write
boundary）、それを広げる場合は verification / moderation mechanism を
同時に設計する Post-MVP governance gate の対象です。

## この経路が存在する理由

Gate A で検証したいのは「実際のイベント情報を起点に、共有 planning
surface として機能するか」です。手動登録では成立しません — 初回 import
だけで 10 興行 / 434 公演回あり、`OccurrenceAddForm` は 1 件ずつしか
追加できません。

## 責務の分離

| 工程                 | 担当                                | 置き場所      |
| -------------------- | ----------------------------------- | ------------- |
| 公式ページの読み取り | agent（依頼ベース）                 | repository 外 |
| seed file の review  | operator                            | ローカル      |
| catalog への適用     | `scripts/import-catalog-events.mjs` | repository    |

**repository には page fetch も HTML parser も入れません。** source ごと
に日程の持ち方が異なるためです。実測した 3 例:

- 宝塚歌劇: 1 日 2 枠の表。枠は「時刻」「空」「貸切公演」のいずれか
- 歌舞伎座（歌舞伎美人）: 日付ごとの表を持たず、部の開演時刻・休演日・
  貸切日を本文に記載
- 平成中村座（同サイト内）: 日付ごとの時刻グリッドを持つ

これらを per-site parser として実装することは、Issue #73 が out of scope
とする汎用 crawler そのものであり、ページ変更時に silent breakage を
起こします。

## seed file を repository へ commit しない理由

- この repository は public です。公式サイトが公開する公演日程を全量
  転載する行為は、自分の planning に使う私的利用とは別です（宝塚歌劇の
  サイトには掲載情報の無断複製を禁じる旨の記載があります）。
- 内容としても product code ではなく transaction data に近い性質です。

`/data/catalog-imports/` は `.gitignore` 済みです。ここに置いた JSON は
operator のローカルにのみ存在します。

## seed file の形式

1 ファイル 1 event（または event の配列）。日時は Asia/Tokyo offset を
明示します — offset がない文字列は script が reject します（UTC として
9 時間ずれて解釈される事故を防ぐため）。

```json
{
  "sourceKey": "takarazuka:2026:example:takarazuka",
  "sourceUrl": "https://example.invalid/production/index.html",
  "title": "◯組公演『作品名』",
  "venue": "◯◯劇場",
  "memo": "部と開演時刻の対応、貸切日、終演時刻の扱いなど",
  "occurrences": [
    { "startsAt": "2026-07-11T13:00:00+09:00", "endsAt": null },
    { "startsAt": "2026-07-12T11:00:00+09:00", "endsAt": "2026-07-12T14:04:00+09:00" }
  ]
}
```

### `sourceKey`

公式 URL の構造から機械的に導き、命名を発明しません。

| source     | 形                                      | 例                                   |
| ---------- | --------------------------------------- | ------------------------------------ |
| 宝塚歌劇   | `takarazuka:<年>:<作品slug>:<劇場slug>` | `takarazuka:2026:ponoichizoku:tokyo` |
| 歌舞伎美人 | `kabuki-bito:<劇場>:play:<公式ID>`      | `kabuki-bito:kabukiza:play:977`      |

宝塚は劇場ごとに日程ページが分かれ（`schedule_takarazuka.html` /
`schedule_tokyo.html`）、会場は event-level 情報なので**劇場ごとに別
event** です。このとき概要ページ = `sourceUrl` は両者で同一になるため、
`sourceUrl` は同一性の判定に使えません。`source_key` が独立した列として
存在するのはこのためです。

### 取り込まないもの

- **貸切公演**: 宝塚では開始時刻がそもそも公表されません（表のセルが
  「貸切公演」のみ）。時刻を捏造せずには公演回として表現できません。
  歌舞伎座は部の時刻が固定なので時刻自体は判明しますが、意味を
  「一般に参加を計画できる公演回」で揃えるため同様に取り込みません。
  貸切日は `memo` へ記録します。
  - 例外: 脚注で開演時刻が明示される共同開催回（例「※1 8月8日（土）
    15:30開演」）は、残席があれば一般前売もあるため取り込みます。
- **終演時刻が未公表の回**: `endsAt` は `null` のままにします。宝塚の
  「公演時間は休憩を含め約3時間」から終演時刻を計算して埋めることは
  しません（product-rules.md: 未設定を既定値へ暗黙変換しない）。

歌舞伎の上演時間は初日の数日前にならないと公表されません。初回 import
は `endsAt: null` で入り、後日 seed file を更新して再実行すれば埋まります
（下記 idempotency 参照）。

## 手順

### 1. seed file を用意する

agent へ公式 URL を渡して依頼します。宝塚は概要ページと日程ページの
2 種類が必要です（概要から title / 組 / 会場、日程から公演回）。
生成物を `/data/catalog-imports/` に置きます。

### 2. dry run

```bash
npm run catalog:import -- ./data/catalog-imports --owner <catalog-creator-email>
```

作成 / 追加予定の件数と日時範囲が出力されます。**`--apply` を付けない
限り一切書き込みません。** 公演回数・初日・千秋楽・休演日を公式ページと
突き合わせてください。

### 3. 適用

```bash
npm run catalog:import -- ./data/catalog-imports --owner <catalog-creator-email> --apply
```

remote へ適用する場合は `--remote` を追加し、
`STAGE_TRACKER_REMOTE_SUPABASE_URL` と
`STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY` を shell に export します
（`scripts/lib/adminTarget.mjs`。secret は repository へ記録しません）。

### 4. 確認

catalog UI で対象 event を開き、公演回が日時順に並ぶこと、participation
登録が可能なこと、My Calendar に反映されることを確認します。

## 不変条件

script が守るもの:

- **削除しない。** event も公演回も削除・更新による除去を行いません。
  seed file に載っていない既存の公演回は、そのまま残します。貸切回の
  チケットが取れて手動で公演回を追加した場合、その後の再 import が
  それを壊さないのはこの性質によります。
- **再実行できる。** `source_key` で event を、`(event_id, starts_at)`
  で公演回を同定します。同じ seed file を二度適用しても重複しません。
  events / event_occurrences に DELETE path が存在しない以上、重複は
  恒久的に除去できないため、これは利便性ではなく必須要件です。
- **終演時刻を消さない。** seed file 側が `null` の場合、既存の値を
  上書きしません。値がある場合のみ更新します。
- **owner を書き換えない。** 既存 event の owner が指定 owner と異なる
  場合は中断します（owner transfer は product operation ではありません）。
- **designated catalog creator 以外を owner にしない。** service_role で
  書き込むため RLS と RPC の creator check を迂回します。script 自身が
  `public.catalog_creators` membership を検証します。
- **公演回 0 件の event を作らない・残さない。** UI 経路では
  `create_event_with_occurrence` が atomic に保証する不変条件を、
  service_role 経路でも保持します。seed 側は事前 validation で公演回 0 件
  を reject し、書き込み時は event row と公演回の INSERT が別 request に
  なるため、新規作成した event の公演回 INSERT が失敗した場合はその
  event row を rollback します。これは script が削除を行う唯一の箇所で、
  対象は直前に自分が作成した公演回 0 件の event のみです（既存 event は
  何が失敗しても削除しません）。

## 既知の制約

- 公演中止・公演回の削除を表現できません（deletion semantics 未決定）。
  誤 import の訂正手段は存在しないため、dry run が唯一の事前防御です。
- 開演時刻が変更された場合、再実行は新しい公演回の追加になり、旧公演回
  を除去できません。
- **seed file に載っている公演回については、seed 側の終演時刻が
  authoritative です。** import 後に owner が UI から終演時刻を手で修正
  しても、その後に古い seed file を再適用すると seed の値へ戻ります
  （imported occurrence は manual occurrence と同じく owner が編集できる
  ため）。dry run の出力に `(既存値) -> (新しい値)` と、既存値を置き換える
  件数が表示されるので、適用前に確認してください。seed に無い公演回は
  この対象外です（上記「削除しない」）。
- **`--apply` を同時に 2 つ実行しないでください。** `(event_id,
starts_at)` に DB の UNIQUE 制約が無いため、同時実行すると双方が同じ
  日時を未登録と判断して二重に INSERT する可能性があります。通常の逐次
  再実行では発生しません。DB 制約による恒久対処は
  `event_occurrences` の invariant を扱う専用 Task（#46 と同種）の対象と
  し、この Task では入れていません。
- 同一 event 内に同じ開始時刻の公演回が既に 2 件以上ある場合、その日時
  については終演時刻の更新を行わず、dry run / apply の出力に警告として
  表示します（どちらの row を指しているか決定できないため推測しません）。
- source の取得日時 / snapshot version を保持しません。
- 貸切・新人公演・学校団体などの区別を公演回単位で持てないため `memo`
  に記録します（公演回単位の note 列は導入していません）。
- 1 event あたり最大 68 公演回になるため、event 詳細および catalog
  calendar の表示負荷は 2-user dogfood の観測対象です。
