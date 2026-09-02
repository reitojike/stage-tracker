# docs/design — design handoff の決定索引

stage-tracker の visual decision は、repo 外の sibling directory に置かれた
design handoff artifact（Claude Design の canvas `.dc.html`、390px の参照
画像、Issue 草案、RULES / MATERIALIZATION 文書）を起点に進めてきました。
Issue / PR / `docs/ux-ui.md` が「TURN 23 に揃える」「RULES.md に従う」
「`design_handoff_v3/reference/*.png` が正解」と書いているとき、その参照先が
何で、何を決め、どの Issue / PR で materialize されたかを、この 1 file で
引けるようにします（Issue #275）。

artifact 本体は repo へ copy しません（Issue #275 Scope revision）。所在と
決定の要約だけをここに持ちます。

## Ownership 宣言

- **global UX/UI rule の正本は [`docs/ux-ui.md`](../ux-ui.md)** です。
  artifact 内の `RULES.md` 等に値や rule が書かれていても、repo 内で従うべき
  rule は `docs/ux-ui.md` に materialize されたものだけです。artifact と
  `docs/ux-ui.md` が食い違う場合は `docs/ux-ui.md` が優先し、artifact 側の
  値を採用したい場合は `docs/ux-ui.md` を更新します。
- **product / domain semantics の正本は
  [`.ai-dev-foundation/product-rules.md`](../../.ai-dev-foundation/product-rules.md)**
  です。artifact 内の Issue 草案が触れている domain 仕様（Invitation の
  pending-only 等）は product-rules.md が authority であり、草案はその時点の
  design 側の理解に過ぎません。
- **artifact は materialize 済み決定の historical evidence であり、authority
  ではありません。** implementation authority は各 GitHub Issue 本文です。
  artifact は「その handoff 時点で何が decision され、どの Issue へ渡ったか」
  を示す証拠として参照します。
- この索引は decision の要約と所在を持ちますが、rule 本文を複製しません。

## 更新運用

- source 側の artifact が更新された場合は、下の「所在」表の該当行の確認時点
  と最終更新日時、および必要なら決定要約を更新します。artifact 本体を repo へ
  copy しません。
- 新しい handoff が来た場合は「所在」表に行を追加し、決定要約と対応表の節を
  追加します。
- 対応表の Issue / PR 番号は `gh issue view` / `gh pr view` で実在と title を
  照合してから載せます。

## 所在

確認時点: **2026-09-02**（source directory を直接読んで確認）。「最終更新」は
その directory 配下で最も新しい file の mtime（JST）です。

| 参照名                                                  | source path（repo 外、read-only）                                  | 最終更新            | 内容                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design Wave 1 / `design_handoff_stage_tracker`          | `D:/Users/jack0/Documents/MyProject/design_handoff_stage_tracker/` | 2026-08-27 21:59:49 | `README.md` / `github.md` / `issues/00-INDEX.md`〜`12-*.md` / `screens/10a`〜`10g-*.png` / `Stage Tracker リデザイン案.dc.html` / `support.js`（24 files） |
| Design Wave 2 / TURN 12 / TURN 25 / `design_handoff_v2` | `D:/Users/jack0/Documents/MyProject/design_handoff_v2/`            | 2026-08-30 21:00:38 | `README.md` / `MATERIALIZATION.md` / `TURN25-fixes.md` / `issues/00-INDEX.md`〜`20-*.md` / `reference/*.png` / `.dc.html`（30 files）                      |
| Design handoff v3 / TURN 23 / 23h / `design_handoff_v3` | `D:/Users/jack0/Documents/MyProject/design_handoff_v3/`            | 2026-09-01 09:14:36 | `README.md` / `RULES.md` / `MATERIALIZATION.md` / `issues/00-INDEX.md`, `v3-01`〜`v3-08-*.md` / `reference/*.png` / `.dc.html`（29 files）                 |
| Design refactor / `../design_refactor`                  | `D:/Users/jack0/Documents/MyProject/design_refactor/`              | 2026-09-02 02:08:08 | `Refactor Issues.md` / `Screen Inventory.dc.html` / `Screens 375.dc.html` / `support.js`（4 files）                                                        |

### artifact 内の旧 path 参照の読み替え

Issue 本文や artifact 本文は sibling directory 時代の相対 path で相互参照して
います。次のように読み替えてください。

| Issue / artifact 内の表記                    | 実体                                     |
| -------------------------------------------- | ---------------------------------------- |
| `design_handoff_stage_tracker/README.md`     | Wave 1 の source path 直下の `README.md` |
| `design_handoff_stage_tracker/NN-*.md`       | Wave 1 の `issues/NN-*.md`               |
| `design_handoff_v2/...`                      | Wave 2 の source path 配下               |
| `design_handoff_v3/...`                      | v3 の source path 配下                   |
| `../RULES.md`（v3 `issues/` から）           | v3 の `RULES.md`                         |
| `design_refactor/...` / `../design_refactor` | Design refactor の source path 配下      |

## TURN 番号の引き方

`Stage Tracker リデザイン案.dc.html` は 1 file に複数 TURN の検討履歴が縦に
並ぶ canvas で、v1 → v2 → v3 と TURN が積み増されています。**TURN 番号だけが
分かっている場合は v3 の canvas を開けば TURN 1〜33 をすべて参照できます。**

| canvas                     | 収録 TURN | 各 TURN の位置づけ                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave 1 `.dc.html`          | 1〜10     | **TURN 10「確定版 — 藍と墨」（id `10a`〜`10g`）が Wave 1 の確定案**。TURN 9 以前は検討記録                                                                                                                                                                                                                                                                                                              |
| Wave 2 `.dc.html`          | 1〜25     | **TURN 12（`12a`〜`12h`）が Wave 2 の確定案**。11 = as built 再現、13〜16 = 検討過程、17 = handoff 後の main、18 = 未適用 9 画面、19 = `/schedule` 廃止、20 = 招待一覧 pending only、21 = 共有をシートへ、22 = 書き込み後のフィードバック、**23 = 未適用画面の決定稿（form / 個人予定 / sign-in）**、24 = Issue 17・18（イベント側）の as built、**25 = TURN 24 as built への修正指示（`25a`〜`25c`）** |
| v3 `.dc.html`              | 1〜33     | 26 = #240 / Issue 16 の as built、**27 = 中止 badge の位置とシートの「閉じる」（`27a` / `27b` / `27c`）**、**28 = 共通パーツと RULES の一致確認（見本）**、29 = #244・#245 の as built、30 = v3-03〜05 の as built、**31 = 仕上げ（`31a`〜`31c` = v3-06、`31d` = v3-07）**、32 = v3-06 の as built、33 = v3-07 の as built（`33d` = v3-08）                                                             |
| `Screen Inventory.dc.html` | —         | 2026-09 時点の全画面 inventory（TURN 番号は持たない）                                                                                                                                                                                                                                                                                                                                                   |
| `Screens 375.dc.html`      | —         | 375px 幅での画面一覧。`Refactor Issues.md` の A / B / C の根拠                                                                                                                                                                                                                                                                                                                                          |

## 決定と materialization

Issue / PR 番号は 2026-09-02 時点で `gh issue list` / `gh pr list --json closingIssuesReferences`
と PR 本文の Issue 参照から確認しています。PR は squash merge されたものです。

### Design Wave 1（`design_handoff_stage_tracker`、TURN 10「藍と墨」）

**何を決めたか**

- 7 画面（ホーム / イベント / マイカレンダー / チケット / 絞り込みシート /
  マイページ / お知らせ）の 390px 基準の再設計。ホームから一覧を排して期限と
  直近の予定だけにし、カレンダーの記号と色の意味を一意化する。
- 色の役割を「藍 = 操作・現在地、赤 = まだ間に合う期限と休日、墨 = もう行動
  できない状態」の 3 つに固定し、success / warning の状態色を廃止。Badge を
  輪郭 / 淡い面 / 赤 / 墨の 4 段階へ。カード面を廃し 1px 細罫と 2px 太罫で区切る。
- bottom nav を 4 項目（ホーム / イベント / チケット / マイカレンダー）、AppBar
  を「左ベル / 中央ロゴタイプ / 右アバター」に。新規部品は三状態チェック
  ボックス、`/tickets`、`/notifications`、`/mypage`。
- 文言は `src/domain/*Formatting` の実装を正本とし design 側で言い換えない。
  PO 確定事項の履歴は `github.md` にある。

**materialization**（親 Issue **#136**、`issues/00-INDEX.md` の順）

| 草案（`issues/`）            | GitHub Issue | PR   | 備考                                                                                                       |
| ---------------------------- | ------------ | ---- | ---------------------------------------------------------------------------------------------------------- |
| `00-INDEX.md`                | #136         | —    | 親 Issue「起票の順序」                                                                                     |
| `01-tokens.md`               | #137         | #149 | 墨（terminal）・紙・罫・境界の token                                                                       |
| `02-badge.md`                | #138         | #155 | Badge 4 段階（outline / subtle / deadline / terminal）                                                     |
| `03-tristate-checkbox.md`    | #139         | #153 | 三状態チェックボックス                                                                                     |
| `04-bottom-nav.md`           | #140         | #152 | PrimaryNav 4 項目化                                                                                        |
| `05-appbar.md`               | #141         | #154 | AppBar（ベル / ロゴタイプ / アバター）                                                                     |
| `06-calendar-markers.md`     | #142         | #156 | カレンダー marker 規則                                                                                     |
| `07-home.md`                 | #143         | #171 | ホーム 2 ブロック化                                                                                        |
| `08-tickets.md`              | #144         | #166 | `/tickets` 新設（data model は #162 / PR #164、import は #163 / PR #165）                                  |
| `09-catalog.md`              | #145         | #170 | classification persistence は #167 / PR #168                                                               |
| `10-mycalendar.md`           | #146         | #160 |                                                                                                            |
| `11-filter-sheet.md`         | #147         | #169 | filter semantics の product checkpoint は #158                                                             |
| `12-mypage-notifications.md` | #148         | —    | My Page 部分は **#159 / PR #161**。Notifications 部分は **#231**（open）へ移管し #148 は not planned close |

Wave 1 の follow-up（草案なし）: #150 / PR #151（Button hover contrast）、
#172 / PR #173（integrated review の accepted findings）。

### Design Wave 2（`design_handoff_v2`、TURN 12 / TURN 25）

**何を決めたか**

- TURN 12 で 8 画面（ホーム / イベント / 絞り込みシート / マイカレンダー /
  チケット / マイページ / 絞り込み 0 件 / 読み込みエラー）を確定。面を外して
  行を詰め、二次操作をマイページへ集約。Badge を「淡い面（藍）＋✓ = 自分が
  終えたこと」を加えた 5 段階へ。角丸を 2px（バッジ・ボタン）/ 4px（入力欄・
  枠・淡い面）/ 6px（作図上の外枠）に整理し、白面カード（`#ffffff` +
  radius 12px）を使わない。赤は期限専用でエラー表示に使わない。
- `MATERIALIZATION.md` で「再現タスクであり再設計タスクではない」「参照画像
  （390px）が visual source of truth」「逸脱は禁止しないが黙って吸収しない
  （PR 説明に列挙）」を受け入れ条件として定義。
- TURN 17〜23 で handoff 後の main と未適用 9 画面を棚卸しし、`/schedule`
  廃止（19）、招待一覧の pending only 化（20）、共有・参加操作のシート化
  （21）、書き込み後のフィードバック（22）、form / 個人予定 / sign-in の
  決定稿（23）を追加。TURN 25 は Wave 24 as built への 3 画面の微修正
  （イベント詳細の編集位置と公演回リストの面、招待シートの角丸、招待一覧の
  白カード撤去と未回答件数）。
- お知らせ（#148）は通知 trigger / 保持期間 / 既読の domain が未決のため
  この handoff に含めない。

**materialization**（親 Issue **#184**）

| 草案（`issues/`）                          | GitHub Issue                          | PR                   | 備考                                                                                                                                    |
| ------------------------------------------ | ------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `00-INDEX.md`                              | #184                                  | —                    | 親 Issue「リデザイン第2弾（確定案 TURN 12）」                                                                                           |
| `01-radius-and-buttons.md`                 | #185                                  | #198                 | TURN 16                                                                                                                                 |
| `02-badge-done-variant.md`                 | #186                                  | #199                 | TURN 15。Badge 5 段階                                                                                                                   |
| `03-state-panel.md`                        | #187                                  | #200                 |                                                                                                                                         |
| `04-primary-nav-icons.md`                  | #188                                  | #202                 | TURN 14d。均等 4 分割の補正は #206 / PR #208                                                                                            |
| `05-date-color.md`                         | #189                                  | #207                 |                                                                                                                                         |
| `06-remove-card-surfaces.md`               | #190                                  | #205                 |                                                                                                                                         |
| `07-deadline-thresholds.md`                | #191                                  | #201                 |                                                                                                                                         |
| `08-visible-window.md`                     | #192                                  | #203                 | 当日保持の補正は #215 / PR #218                                                                                                         |
| `09-home.md`                               | #194                                  | #212                 | `12a`                                                                                                                                   |
| `10-catalog-and-filter.md`                 | #195                                  | #214                 | `12b` / `12c` / `12g` / `12h`。title 位置の補正は #216 / PR #219                                                                        |
| `11-my-calendar.md`                        | #196                                  | #211                 | `12d`。月内 agenda の追加は #217 / PR #220                                                                                              |
| `12-tickets.md`                            | #197                                  | #213                 | `12e` / TURN 14a。chevron token は #227 / PR #229                                                                                       |
| `13-mypage.md`                             | #193                                  | #204                 | `12f`                                                                                                                                   |
| `14-event-range-date-format.md`            | #221                                  | #224                 | 2026-08-29 main 同期で拾った分                                                                                                          |
| `15-sunday-red-single-value.md`            | #222                                  | #223                 | 同上                                                                                                                                    |
| `16-retire-schedule-list.md`               | #241                                  | #243                 | TURN 19。`/schedule` 廃止                                                                                                               |
| `17-invitation-pending-only.md`            | #225 / #230                           | #233（#235 は #234） | TURN 20。product authority は #225、実装は #230。画面（`25c`）は #240 / PR #242                                                         |
| `18-sheets-for-share-and-participation.md` | #240（event 側）、#247（schedule 側） | #242 / #252          | TURN 21。event detail / 招待シート（`25a` / `25b`）は #240。共有シートは v3-04 へ、破壊的操作の置き場所は v3-03 と v3 `RULES.md` へ移管 |
| `19-form-screens.md`                       | #246 / #247                           | #258 / #252          | TURN 23。v3-03（event 側）/ v3-04（個人予定側）へ移管                                                                                   |
| `20-sign-in.md`                            | #248                                  | #251                 | TURN 23h。v3-05 へ移管                                                                                                                  |
| `TURN25-fixes.md` + `reference/*.png`      | #240                                  | #242                 | TURN 24b / 25a〜25c                                                                                                                     |

Wave 2 の follow-up（草案なし、Issue 本文が「Wave 2」を参照）: #206 / PR #208、
#215 / PR #218、#216 / PR #219、#217 / PR #220、#226 / PR #228、#227 / PR #229。
FilterSheet の dialog lifecycle を共通 `Sheet` へ収束した #236 / PR #238 は、
v3 README の「絞り込みシートは実装側の判断を採用（TURN 27b）」の根拠です。

### Design handoff v3（`design_handoff_v3`、TURN 23 / 27 / 28 / 31）

**何を決めたか**

- v2 で未適用だった画面（イベント登録・編集、個人予定の詳細・追加・編集、
  サインイン）を TURN 23 の決定稿で materialize し、共通パーツ（Button /
  Badge）の語彙を TURN 28 の棚卸しで実装と突き合わせて揃える。
- `RULES.md` は artifact 側の値の一覧（色 token、角丸を箱の大きさで 2px /
  4px の 2 値、ボタン variant の静止時の見た目、シートの「閉じる」規則、
  Badge 5 段階、破壊的操作の置き場所、書き込みフィードバック、読み込み中の
  skeleton / spinner の使い分け、取り消し行、画面ローカル部品の扱い）。
  repo 内の rule としては #244 以降で `docs/ux-ui.md` へ materialize 済みで、
  `RULES.md` 自体は authority ではない。
- 実装側の判断を採用して決定稿を寄せたもの: 共通 `Sheet.tsx`、絞り込み
  シートの構造（TURN 27b）、未回答公演回の状態ラベル非表示、チケット画面の
  状態語（旧チケット domain 削除に伴い design 対応不要）。
- v3 README の「30 で拾った差分」3 件（下部固定帯の対象、編集画面の中止
  badge 位置、1 件入力シートの形が 2 つ）は v3-06 / v3-07 / v3-08 として
  起票・適用済み。お知らせ（#148 → #231）は引き続き domain の決めが先。

**materialization**（Issue title prefix「Design handoff v3:」）

| 草案（`issues/`）                      | GitHub Issue | PR   | 参照 frame / 画像                                                                                                                       |
| -------------------------------------- | ------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `00-INDEX.md`                          | —            | —    | 残 Issue 一覧と v2 からの移管表（18 → 04 / 03、19 → 03 / 04、20 → 05）                                                                  |
| `v3-01-shared-parts.md`                | #244         | #250 | TURN 28。`parts-quiet-button.png` / `parts-danger-and-radius.png` / `filter-sheet-390.png`（27b）/ `participation-sheet-390.png`（27c） |
| `v3-02-event-detail-canceled-badge.md` | #245         | #249 | TURN 27a。`event-detail-390.png`                                                                                                        |
| `v3-03-event-write-screens.md`         | #246         | #258 | TURN 23b / 23c。`event-create-390.png` / `event-edit-390.png`                                                                           |
| `v3-04-personal-schedule-screens.md`   | #247         | #252 | TURN 23e / 23f / 23g。`schedule-detail-390.png` / `schedule-new-390.png` / `schedule-edit-390.png`                                      |
| `v3-05-sign-in.md`                     | #248         | #251 | TURN 23h。`sign-in-390.png`                                                                                                             |
| `v3-06-finishing-touches.md`           | #261         | #262 | TURN 31a〜31c。`finishing-*.png` 4 枚                                                                                                   |
| `v3-07-write-feedback.md`              | #263         | #264 | TURN 31d。`finishing-occurrence-lifecycle-390.png`                                                                                      |
| `v3-08-confirm-sheet-footer.md`        | #265         | #266 | TURN 33d                                                                                                                                |

v3 の follow-up（草案なし）: #254 / PR #255（個人予定詳細の共有→削除の順序を
`schedule-detail-390.png` に合わせる）、#257 / PR #267（Android Chrome の
datetime-local 表示 bug。TURN 23 は文脈参照のみ）。

### Design refactor（`design_refactor`、2026-09）

**何を決めたか**

- 全画面に散っている「縮む文字＋縮まないボタン」の `space-between` 行で、
  伸縮の規約（`min-width: 0` / `flex-shrink: 0` / `white-space: nowrap`）が
  module.css ごとに個別に書かれ、書き忘れで狭い幅のボタン label が折り返す
  問題（Passkey 行の「削除」）を共通化で解く。
- A: `Button` 自体に nowrap を持たせ重複宣言を削除。B: 「テキスト＋操作」行の
  共有クラス（`row` / `main` / `aside`）を `src/ui/` に置き、規約を
  `docs/ux-ui.md` へ追記。C: 見出しが対象を示している画面のボタン文言を動詞
  だけに短くする（サインインは「送る」にしない）。

**materialization**（copy 確認時点で 3 件とも open、PR 未作成）

| 草案（`Refactor Issues.md`）                | GitHub Issue | PR  |
| ------------------------------------------- | ------------ | --- |
| A. ボタンのラベルは折り返さない（共通化）   | #270         | —   |
| B. 「テキスト＋操作」の行を共有クラスにする | #271         | —   |
| C. 長いボタン文言を短くする                 | #272         | —   |

## repo 側からの参照

- [`docs/ux-ui.md`](../ux-ui.md) — bottom nav の label set が Wave 1 handoff
  「共通: bottom nav」で確定したことを、この索引経由で参照しています。
- Issue #136〜#148、#184〜#197、#240、#244〜#265、#270〜#272 の本文は、上記
  「旧 path 参照の読み替え」表の path で artifact を参照しています。
