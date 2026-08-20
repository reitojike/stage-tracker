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
  概念として扱います。1 つの event は 1 件以上の公演回を持ちます。
- 公演回は必ずいずれかの event に属し、event から独立して存在しません。
- 単発の公演は「公演回が 1 件の event」として表します。単発のための別概念は
  設けません。
- event は少なくとも 1 件の公演回を持ちます。日程が未発表の event を catalog
  へ登録する扱いは、その need が出た時点で再評価します。

### 公演日程

- 公演の開始日時は公演回が持ちます。
- 終演時刻は不明な場合があり、未設定を正当な状態として扱います。未設定を
  「当日中に終わる」等の既定値へ暗黙に変換しません。
- 同一日に複数回の公演がある場合は、その日に複数の公演回が存在するものとして
  表します。1 日あたりの公演回数が event 内で一定である必要はありません。
- 公演期間（初日から千秋楽まで）は公演回から導出する派生情報として扱い、
  独立に管理・編集する情報としては持ちません。
- 休演日は「公演期間内で公演回が存在しない日」として表します。休演日のための
  専用の概念は設けません。

### Event と公演回の情報境界

- event が持つのは、興行そのものの識別情報（title / 会場 / 参照 URL / memo）と
  owner です。
- 公演回が持つのは、その回の開始日時と終了日時です。
- 会場は event の情報として扱います。公演回ごとに会場が変わる興行の扱いは、
  その need が出た時点で再評価します。

### Catalog の日程参照要件

- 指定した期間（例: ある月）に公演回が存在する event を引けます。
- ある日を指定して、その日に公演回がある event と、その日の公演回の時刻を
  引けます。
- ある event について、その公演回を日時順に引けます。
- 期間内であっても公演回が存在しない日は、その日の結果に現れません。

### 分類

- catalog を関心のある分類で絞り込みたいという requirement があります。
- 分類を導入する場合、分類は event に属する情報とします。公演回ごとに異なる
  分類を持ちません。
- 分類の taxonomy そのもの（単一選択か複数選択か、固定 taxonomy か tag 的か、
  canonical な語彙の ownership）は、それを扱う専用の product task で決定します。

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
  memo）と、その event の公演回の日時です。
- record の識別子・作成日時・owner とレコードの更新日時は system-managed と
  し、normal な authenticated client から直接書き換えられる対象にはしません。

### Deletion

- PR B の時点では event deletion を提供しません。存在する event row は
  すべて current catalog row として扱います。
- deletion semantics（論理削除の要否を含む）は、それを扱う専用の product
  task で別途決定します。「将来 migration したくない」という理由だけで
  deletion 用の schema を先行実装しません。

## Invitation

- invite 可否は event へ参加登録済みかで決まり、owner かどうかでは決まりません。
- MVP の invite は approval flow を持たず、invite 時点で invitee の schedule
  へ即時反映します。

## Participation

- participation visibility の default は `private` です。
  - `private` = 本人のみ
  - `public` = authenticated users 全員
- participation の intention/planning と ticket acquisition は独立した
  concept とし、ticket の結果から participation status を自動変更しません。
- participation status の初期 semantic 候補は `considering` / `attending` /
  `not_attending` です。
- participation の table 名・永続化 shape は participation 実装時まで固定
  しません。

## 時刻・タイムゾーン

- product 上の日付境界は `Asia/Tokyo` です。
- persisted timestamp は PostgreSQL `timestamptz` です。

## 先行実装しないもの

- 将来用の `participation_state` / invite approval states /
  `profiles.is_admin` 等を、「後で migration したくない」という理由だけで
  先行実装しません。
- MVP 後の変更を不必要に阻害する不可逆 coupling は避けますが、将来可能性
  だけを理由にした speculative machinery も作りません。

## まだ決めていないもの

以下は関連する product task が起票されるまで、このファイルへ追記しません。

- participation の persistence / table naming
- budget 集計の期間基準
- ticket entry と participation row の必須関係
- 分類 taxonomy の具体形
- 「関心のある分類」を persistent な personal preference にするか、その場の
  filter に留めるか
- participation / ticket acquisition が event 単位と公演回単位のどちらに
  対応するか
- 公演回ごとに会場が異なる興行の扱い
- 日程が未発表の event の扱い
- 公演回の deletion / 公演中止の表現
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
