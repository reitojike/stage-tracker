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

### 保管場所

seed cache の canonical local location は **primary checkout の
`data/catalog-imports/`** です（現状 10 ファイル）。**task 用の linked
worktree 内には保管しません。** 別 worktree から import を実行する場合
は、primary checkout 側の seed path を明示的に指定してください
（例: `npm run catalog:import -- /path/to/primary-checkout/data/catalog-imports --owner ...`）。

ignore は 2 段構えです。

- コミット済み `.gitignore` の `/data/catalog-imports/`。これは通常の
  clone で自動的に配布されます。
- **`.git/info/exclude` は `.gitignore` と異なり Git 管理対象外で、
  clone 間で配布されません。** 各 clone の共通 `.git` へ、operator が
  手動で 1 回だけ追記する必要があります。この repository の現在の
  checkout では既に次を追記済みですが、**新しい clone / 別 operator の
  checkout では未設定です**。

  ```text
  data/catalog-imports/
  ```

  追記済みかは次で確認できます。

  ```bash
  cat "$(git rev-parse --git-common-dir)/info/exclude"
  ```

  一度追記すれば、共通 `.git` を共有するその clone 配下の**全 worktree**
  で、branch に関わらず effective です（committed `.gitignore` 側の
  該当行を持たない branch / 過去 commit を checkout した場合でも
  ignore され続けます）。**これはあくまで同じ clone 内の話です。**
  ignore rule が worktree 間で共有されることと、seed file の実体が
  primary checkout にしか存在しないことは別の話です。

**`git clean -xdf` は ignore 対象も削除します。** primary checkout で
これを実行する前は、必ず `git clean -xdn` で dry run し、
`data/catalog-imports/` が削除対象に含まれていないことを確認してくだ
さい。

### seed file は正本ではない

seed file は正本ではなく、**公式ページと Production DB という 2 つの
正本の間の中間生成物（キャッシュ）**です。

| 対象           | 正本                                    |
| -------------- | --------------------------------------- |
| 公演日程       | 公式ページ                              |
| catalog の内容 | Production DB                           |
| seed file      | 上記 2 つの間の中間生成物（キャッシュ） |

失っても構造的な損失にはなりません。復旧経路は目的によって使い分けます。

- **公式ページからの再生成** — 最新の日程が欲しいとき。開演時刻の変更や
  貸切の追加があると内容が変わり、公演回は `(event_id, starts_at)` で
  同定するため、時刻が変わった回は「更新」ではなく「追加」になります
  （削除手段が無いことは下記「既知の制約」参照）。公演終了後にページが
  取り下げられた場合は再生成自体ができません。
- **Production DB からの再構成** — 現在 catalog に入っている内容を seed
  形式で手元に戻したいとき。**これは import 時点の状態への「復元」では
  ありません。** DB は import 時点の snapshot ではなく現在の catalog
  状態なので、import 後に手動追加した公演回（貸切のチケットが取れて UI
  から足した回など）も含まれます。それを seed として再適用すると、その
  回が seed 管理下に入り、終演時刻が seed 側 authoritative の対象へ
  変わります（破壊的ではありませんが、想定外の occurrence が seed 管理
  下に入るため、再適用前に dry run の出力で確認してください）。ファイル
  分割・キー順序・整形が元の seed file と bit-for-bit 一致する保証も
  ありません。

「取り込んだ内容を正確に復元したい」という目的には、公式ページではなく
Production DB からの再構成が正しい経路です。

## seed file の形式

1 ファイル 1 event（または event の配列）。日時は Asia/Tokyo offset を
明示します — offset がない文字列は script が reject します（UTC として
9 時間ずれて解釈される事故を防ぐため）。

`startsOn` / `endsOn`（Issue #87/#88 の Event range）は必須です。
公式に公表されている初日〜千秋楽をそのまま入力します。
`event_occurrences` の min/max から自動生成しません — Event range は
公演回集合とは独立した product fact であり、貸切等の未取込 occurrence
がある event では min/max と一致しないことがあるためです。各
occurrence の `startsAt` の Asia/Tokyo calendar date は必ず
`[startsOn, endsOn]` に収まっている必要があります（DB level でも
enforce されます）。`occurrences` は空配列でも構いません（開催期間だけ
判明していて具体的な公演回がまだ発表されていない event）。`doorsAt`
（開場日時）は任意です。

```json
{
  "sourceKey": "takarazuka:2026:example:takarazuka",
  "sourceUrl": "https://example.invalid/production/index.html",
  "title": "◯組公演『作品名』",
  "venue": "◯◯劇場",
  "memo": "部と開演時刻の対応、貸切日、終演時刻の扱いなど",
  "startsOn": "2026-07-11",
  "endsOn": "2026-08-02",
  "occurrences": [
    {
      "doorsAt": "2026-07-11T12:30:00+09:00",
      "startsAt": "2026-07-11T13:00:00+09:00",
      "endsAt": null
    },
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
生成物は primary checkout の `data/catalog-imports/` に置きます
（保管場所の原則は上記「保管場所」参照。linked worktree 内には置きません）。

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

remote へ適用する場合は、事前に次の 3a〜3c の準備が必要です（`--remote`
は最後に付けます）。いずれも production credential をこの runbook 本文
やコミットへ書き込みません。

#### 3a. project への link

project ref はこの repository のどこにも記録されていません
（`supabase/.temp/` は gitignore 済みで local にしか残らないため）。
毎 session、次で確認します。

```bash
supabase projects list -o json
```

出力の `ref`（`id` と同値）が project ref です。project ref は
cryptographic secret ではありません（本番デプロイの
`NEXT_PUBLIC_SUPABASE_URL` として既に client bundle へ露出しており、
認証は別途 CLI login と service_role key で行われます）が、**この
repository の既存 Secret boundary
（`docs/runbooks/gate-a-remote-environment.md`「Vercel・Supabase project
identifier を Issue / PR / commit message へ貼り付けない」）に従い、実際の
project ref の値をこの runbook・commit message・Issue/PR コメントへは
記録しません。** 毎 session、operator 自身の shell で `supabase projects
list` を実行してその場で確認し、session-local な変数・shell への
export に留めます。

```bash
supabase link --project-ref <project-ref>
```

#### 3b. `--owner` へ渡す email の解決

`public.catalog_creators` は `user_id` しか持たないため（RLS も
`auth.uid()` の own-row にしか SELECT を許しません）、designated
catalog creator の email は `auth.users` との join でしか得られません。
service_role key は不要です — 3a で link 済みの CLI session から
Management API 経由（`--linked`）で問い合わせます。

```bash
supabase db query --linked "select au.email from public.catalog_creators cc join auth.users au on au.id = cc.user_id;"
```

#### 3c. service_role key の取得（出力・記録しない）

`supabase projects api-keys` の生出力を terminal へ表示させず、command
substitution で直接環境変数へ渡します。project が legacy JWT 形式の
`service_role` key を持つ場合はそれを、新しい API key 体系
（`sb_secret_...`）へ移行済みで legacy key が無い場合は、
`secret_jwt_template.role` が `service_role` の key を使います
（`scripts/lib/adminTarget.mjs` の `createClient(url, serviceRoleKey, ...)`
はどちらの形式も受け付けます）。`type === "secret"` は project が secret
key を複数持つ場合に false positive を拾い得るため、単独の判定条件には
しません（`supabase/cli` の e2e fixture
`apps/cli-e2e/fixtures/recorded/GET_v1_projects___PROJECT_REF___api_keys/default.response.json`
で確認した実際の応答形状に基づく判定です。動作確認時の CLI version は
`supabase --version` で `2.115.0` でした）。

```bash
export STAGE_TRACKER_REMOTE_SUPABASE_URL="https://<project-ref>.supabase.co"
export STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY="$(
  supabase projects api-keys --project-ref <project-ref> --reveal -o json |
  node -e '
    const keys = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const key =
      keys.find((k) => k.name === "service_role" && k.type === "legacy") ??
      keys.find((k) => k.type === "secret" && k.secret_jwt_template?.role === "service_role");
    if (!key) { console.error("service_role key not found"); process.exit(1); }
    process.stdout.write(key.api_key);
  '
)"
```

`$( ... )` による直接代入のため、key の値は terminal 出力にも shell
history にも現れません。この 2 つの環境変数はこの shell session の間
だけ有効にし、`.env` 等のファイルへは書き込みません
（`scripts/lib/adminTarget.mjs` 参照）。

#### 3d. 初回 push 時の重複確認

`event_occurrences_event_id_starts_at_key`（Issue #79）を含む migration を
初めて remote へ `supabase db push` する際は、Issue #73 の初回 import で
remote に実データが既に入っている前提で扱ってください。この migration は
既存の重複 `(event_id, starts_at)` があれば push 自体が失敗する additive
制約です。念のため `supabase db push` の直前に、read-only で次を実行し
0 行であることを確認してから push してください（1 行でも返る場合は
push を行わず停止し、重複行の扱いを個別に検討します — この script 自身
には重複を解消する手段がありません）。

```sql
select event_id, starts_at, count(*) as duplicate_rows
from public.event_occurrences
group by event_id, starts_at
having count(*) > 1
order by event_id, starts_at;
```

#### 3e. import の適用

```bash
npm run catalog:import -- ./data/catalog-imports --owner <catalog-creator-email> --apply --remote
```

### 4. 確認

catalog UI で対象 event を開き、公演回が日時順に並ぶこと、participation
登録が可能なこと、My Calendar に反映されることを確認します。

## 次 session への依頼テンプレート

次の import を別 session / agent へ依頼する場合、この runbook への参照
と、依頼ごとに変わる部分（対象 URL、適用範囲）だけを渡せば再開できます。
手順自体をこの依頼文へ複製しません。project ref / service_role key は
この依頼に含めず、実行 session が 3a〜3c の手順でその都度取得します。

> `docs/runbooks/catalog-import.md` の手順で、次の公式ページを追加
> import してください。
>
> - 対象 URL: `<公式ページ URL>`（宝塚は概要ページ + 日程ページの 2 種）
> - 適用範囲: dry run のみ / local `--apply` / remote `--apply --remote`
>   のいずれか
> - seed file は primary checkout の `data/catalog-imports/` に置く
>   こと（linked worktree 内には置かない）
>
> production credential はこの依頼に含めません。remote 適用が必要な
> 場合は runbook の「3. 適用」節 3a〜3c の手順で、実行 session 内で
> project ref / service_role key を都度取得してください。

## 不変条件

script が守るもの:

- **削除しない（例外なし）。** event も公演回も削除・更新による除去を行いません。
  script に削除経路は 1 つも存在しません（新規 event の中断時 rollback も
  DB transaction 側で行われます。下記参照）。
  seed file に載っていない既存の公演回は、そのまま残します。貸切回の
  チケットが取れて手動で公演回を追加した場合、その後の再 import が
  それを壊さないのはこの性質によります。
- **再実行できる。** `source_key` で event を、`(event_id, starts_at)`
  で公演回を同定します。同じ seed file を二度適用しても重複しません。
  events / event_occurrences に DELETE path が存在しない以上、重複は
  恒久的に除去できないため、これは利便性ではなく必須要件です。
  `(event_id, starts_at)` の一意性は、この script の同定ロジックに加えて
  `event_occurrences_event_id_starts_at_key`（Issue #79）が DB level でも
  保証しています。
- **終演時刻を消さない。** seed file 側が `null` の場合、既存の値を
  上書きしません。値がある場合のみ更新します。
- **owner を書き換えない。** 既存 event の owner が指定 owner と異なる
  場合は中断します（owner transfer は product operation ではありません）。
- **designated catalog creator 以外を owner にしない。** service_role で
  書き込むため RLS と RPC の creator check を迂回します。script 自身が
  `public.catalog_creators` membership を検証します。
- **公演回 0 件の event を作れる（Issue #87/#88）。** UI 経路の
  `create_event`（旧 `create_event_with_occurrence`）と同じく、
  operator 経路でも `occurrences: []` の import が正当な状態です。
  「開催期間だけ発表されていて具体的な公演回がまだ発表されていない」
  event を import 対象の興行でも表現できます。新規 event の作成は
  `import_event_with_occurrences` RPC を 1 回呼ぶだけで、event row と
  その全公演回（0 件を含む）が **1 transaction** で書かれます。どこか
  1 件でも失敗すれば event row ごと rollback されます。client 側の補償
  削除には依存しません（event INSERT の commit 後に応答が失われた場合や
  プロセスが強制終了した場合、補償処理はそもそも走らないため）。この
  RPC は `service_role` のみ実行可能で、`anon` / `authenticated` からは
  実行できません。
- **Event range の補正は seed の再適用で行う。** 機械的 backfill
  （既存公演回の min/max、貸切等の未取込 occurrence により公式期間と
  ずれ得る）で入った `starts_on`/`ends_on` を、公式情報と照合して
  補正する場合も、raw SQL の直接 UPDATE を primary path にしません。
  seed file の `startsOn`/`endsOn` を公式情報へ更新して dry run →
  operator review → `--apply` を再実行してください。既存 event の
  update は `import_update_event` RPC（Issue #88）が event の
  description/Event range/新規 occurrence/終演・開場時刻の補正を
  1 transaction で atomic に適用します（Event range と occurrence 群を
  同時に動かす reschedule でも、DB level の containment invariant と
  deadlock しません）。

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
- **`(event_id, starts_at)` は DB level の UNIQUE 制約
  （`event_occurrences_event_id_starts_at_key`、Issue #79）で保証されて
  います。** 同一 event 内で同じ開始日時の公演回が 2 件以上存在する状態は
  構造的に発生しません。したがって:
  - 既存の公演回を instant で同定する処理（`(event_id, starts_at)` を
    key にした lookup）が、同じ instant の 2 件から片方を選べず取りこぼす
    という状態も起こり得ません。この lookup が万一衝突を検出した場合、
    script は警告を出して片方を無視するのではなく **即座に失敗します**
    （対象 target がこの migration 未適用の schema である可能性を示す
    シグナルとして扱うため）。
  - **`--apply` を同時に 2 つ実行することは推奨しません**が、これはもはや
    correctness 上の禁止ではなく運用上の推奨です。同時実行で両方が同じ
    日時を未登録と判断して INSERT しても、後勝ちの一方は DB の UNIQUE
    制約により `23505`（unique_violation）で失敗するだけで、重複行が
    persist されることはありません。失敗した側は再実行すれば
    resume します。
  - 上記の `import_event_with_occurrences` による atomicity（**1 回の
    event 作成が中途半端に終わらないこと**）と、この UNIQUE 制約
    （**並行実行どうしが重複行を作らないこと**）は別の保証です。
  - 同じ table の DB invariant としては #46（`ends_at >= starts_at`）も
    ありますが、別の invariant です。
- source の取得日時 / snapshot version を保持しません。
- 貸切・新人公演・学校団体などの区別を公演回単位で持てないため `memo`
  に記録します（公演回単位の note 列は導入していません）。
- 1 event あたり最大 68 公演回になるため、event 詳細および catalog
  calendar の表示負荷は 2-user dogfood の観測対象です。
