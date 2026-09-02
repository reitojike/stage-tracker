# Handoff: Stage Tracker リデザイン（確定版 — 藍と墨）

## Overview

stage-tracker（reitojike/stage-tracker, branch: main）のUI再設計。対象は7画面。目的は2つ。

1. ホームから「行き先の一覧」を排し、期限と直近の予定だけを見せる
2. カレンダーの記号と色の意味を一意にし、色に依存せず形でも判別できるようにする

情報構造・IA・文言はリポジトリの実装（`src/domain/*Formatting`, `src/ui/`）を正本として踏襲している。変更は表示規則・色の割り当て・画面構成に限る。

## About the Design Files

このフォルダに同梱した HTML は **デザインの参照物** であり、そのまま製品に取り込むコードではない。意図した見た目と挙動を示すプロトタイプとして扱い、実装は stage-tracker の既存環境（Next.js App Router + CSS Modules + `src/ui/` のコンポーネント群）で、その規約に沿って作り直す。

- 設計HTMLは1ファイルに複数ターンの検討履歴が縦に並んでいる。**実装対象は先頭セクション「確定版 — 藍と墨」（id: `10a`〜`10g`）のみ**。TURN 9 以下は検討の記録で、実装対象外。
- HTML はインラインスタイルで書かれている。値（色・寸法・間隔）は正確だが、書き方は移植対象ではない。

## Fidelity

**High-fidelity。** 色・タイポ・間隔・状態は確定値。ピクセル単位で再現してよい。ただし以下は既存実装に従う。

- フォント: system font stack（`src/ui/globals.css` の指定をそのまま使う。webfontは追加しない）
- タップ領域: 可視サイズと別に44pxを確保（`tapTarget.module.css` の `expand44` を composes する既存規約）
- トークンは `src/ui/tokens.css` に追加する形をとる（新規CSS変数は下記「Design Tokens」参照）

## Screens / Views

デバイス幅 390px 基準。各画面は AppBar（高さ48px）+ 本文 + bottom nav（高さ56px）の3層。本文の padding は `20px 16px 24px`、ブロック間の gap は 32px。

### 共通: AppBar

- 高さ 48px、下辺に 1px 罫（`--color-border`）、`padding-inline: 4px`
- 左: お知らせ（ベルアイコン、40×40）。未読があれば右上に 7px の藍の点（紙色で 1.5px の縁取り）
- 中央: ロゴタイプ `STAGE TRACKER`。14px / 600 / `letter-spacing: 0.22em` / 文字色 `--color-text`
- 右: マイページ（40×40 の中に 30px の円、1px 枠 `--color-control-border`、イニシャル 12px）

### 共通: bottom nav

- 4項目: ホーム / イベント / チケット / マイカレンダー
- 各項目 `flex: 1`、`min-height: 56px`、ラベル 12px、上辺に 1px 罫
- 現在地: ラベルを 600 + `--color-text`、項目の上端に高さ2pxの藍のバー（左右 inset 12px）
- 非現在地: 12px / 400 / `--color-text-secondary`
- 「マイカレンダー」は `overflow-wrap: anywhere`（390px で折り返す）
- アイコンは持たない（テキストのみ）

### 10a ホーム

**Purpose**: 「今やること」と「次に行く公演」だけを見る。

**Layout**: 2ブロック。ブロック1「申し込み期限」は横スクロールのカード列、ブロック2「9月の予定」は日付ごとの縦リスト。

- ページ見出し 24px / 600 / `line-height: 1.4`
- ブロック見出しは太罫（`border-bottom: 2px solid --color-text`, `padding-bottom: 8px`）、15px / 600
- 期限カード: 幅158px、`gap: 8px` の横並び。中に 赤の塗りバッジ（残りN日）+ タイトル16px/600 + 日時13px
- 予定リスト行: 左に時刻列（44px, 12px, `--color-text-secondary`）、右に本文（タイトル16px/600、会場13px、バッジ列）
- 行間の区切りは 1px 細罫、行の padding は `14px 0`
- アカウント / Passkey はこの画面に置かない（10f へ移動）

### 10b イベント（/catalog）

**Purpose**: みんなの公演カレンダーを見て、日を選んで公演を確認する。

- ページ見出し行の右端にフィルターアイコン（40×40）。絞り込み中は右上に藍の点
- 月移動: `‹ 2026年9月 ›`（両端 40×40 のタップ領域）
- 曜日ヘッダ: 11px / 600。土は藍、日は赤、他は `--color-text-secondary`
- 日付セル: `min-height: 44px`、`grid-template-columns: repeat(7, minmax(0,1fr))`、週ごとに 1px 細罫
- 複数日公演は帯（週の grid row 2 に `grid-column` で span）。帯は淡い藍面 `#dbe2ee` / 文字 `#24365c` / 10px / `line-height: 1.6`。先頭にカテゴリ短縮ラベル（紙色で抜く、`padding: 0 3px`, 600）。同日に複数カテゴリなら短縮ラベルを並べ、3つ以上は `+N`
- 単日公演は dot（7px の円）
- 選択日リスト: 日付見出し（太罫, 15px/600）+ 行。行のバッジは分類（輪郭）と状態（淡い面 / 墨）

### 10c マイカレンダー（/calendar）

**Purpose**: 自分の参加予定と個人予定を1つのカレンダーで見る。

- カレンダーの規則は 10b と同じ。加えて個人予定の帯（blocking = 淡い藍面、non-blocking = 1px 輪郭 `#6a7d9e`）
- 凡例をカレンダー下に1行: ● 決まっている / ○ 検討中 / ▬ 予定を確保する / ▭ 確保しない
- 選択日リストに個人予定も混ぜる。時刻列は「終日」ではなく 期間表記（`scheduleTemporalLabel` に従う）

### 10d チケット（新規画面）

**Purpose**: 申込・結果発表・発売・入金の期限を、種別で分けず期限の近い順に1本で見る。

- 先頭に「＋ 申し込み予定を追加」（輪郭ボタン、可視31px）
- 月見出しは細罫 + 12px / 600 / `letter-spacing: 0.1em`（画面内の階層は 太罫=セクション / 細罫=月 の2段）
- 各行: 左に日付列（44px、日付22px/600 + 曜日10px/600/0.1em）。期限が迫る行は日付を赤、土は藍、他は `--color-text`
- 右に本文: タイトル16px/600、補足13px（`23:59 締切` / `10:00 発表済み` / `23:59 入金期限 ・ 24,000円`）、バッジ列、最下に `quiet` アクション（可視27px、`margin-inline-start: -8px`）
- バッジの使い分けは下記「バッジの4段階」に従う

### 10e 絞り込みシート

**Purpose**: カテゴリを絞る。中間層の部分選択を扱える。

- 画面下から出るシート。上端のみ角丸4px、境界は1px細罫、背後は暗幕
- 行はラベル + チェック + ★（お気に入り）。中間層が部分選択のときは横棒（−）の三状態
- お気に入りは中間層と最下層の両方に付けられる
- 件数は表示しない
- 下部に確定ボタン1つ（この画面の塗りボタンは1つだけ）

### 10f マイページ

**Purpose**: アカウントと Passkey の管理。AppBar のアバターから開く二次画面。

- bottom nav の項目にはしない
- セクションは 太罫見出し + 本文。アカウント（サインイン中のメール、サインアウト）、Passkey（説明、登録済み端末、登録ボタン、削除）
- 文言と操作は `HomeAccount.tsx` / `PasskeySection.tsx` / `DeletePasskeyForm.tsx` / `RegisterPasskeyButton.tsx` の現行実装を踏襲

### 10g お知らせ

**Purpose**: プッシュ通知が無くても、ここを見れば追いつける。

- AppBar のベルから開く。bottom nav の項目にはしない
- 行: 未読は先頭に藍の点 + 日時を藍 + 本文を `--color-text`。既読は点なし、日時 `--color-text-secondary`、本文の濃度を1段下げる
- 面の塗り分けはしない（既読/未読は点と文字色だけで表す）

## Interactions & Behavior

- 日付セルのタップ → 選択日リストを差し替え。選択中の表現はセル全体を1.5pxの枠で囲う（`box-shadow: inset 0 0 0 1.5px --color-text`）。日付の丸ではない
- 「今日」は日付数字にグレーの塗り丸。選択中と併存できる
- フィルターアイコン → 10e のシートを下から出す。確定で閉じ、`/catalog` の表示に反映。**表示状態は次回訪問時に復元する**
- `quiet` アクション（「申込済みにする」「一般発売を追加する」「予定を確保する」）は楽観的更新でよい
- 横スクロールのカード列（ホームの期限ブロック）はスナップ不要
- アニメーションはシートの出入り（200ms 程度、ease-out）のみ。他の遷移に演出を付けない

## State Management

- カレンダーの表示月と選択日（画面ローカル）
- 絞り込み条件（**永続化する**。前回の状態を復元）
- お知らせの既読状態（サーバ側）
- チケット行のアクション実行状態（申込済みフラグ等、サーバ側）

## Design Tokens

既存の `src/ui/tokens.css` に対する差分。

### 色（新規・変更）

| 用途 | 値 | 備考 |
| --- | --- | --- |
| `--color-canvas`（紙） | `#eef0f1` | 冷たい白へ寄せる |
| `--color-border`（細罫） | `#d7dcde` | |
| `--color-text` | `#1f2426` | 太罫にも使う |
| `--color-text-secondary` | `#5c6467` | |
| `--color-text-tertiary` | `#454b4e` | バッジ内の文字 |
| `--color-control-border` | `#7f878b` | 地に対して3:1以上（SC 1.4.11） |
| `--color-surface-subtle`（淡い面） | `#dfe4e7` | 進行中の状態バッジ |
| `--color-accent`（藍） | `#2f4a7a` | nav現在地 / dot / 帯 / 土曜 / 未読 / 確定ボタン |
| `--color-danger`（赤） | `#a13b2e` | **これから来る期限** と 日曜・祝日のみ |
| `--color-terminal`（墨、新規） | `#2b3033` | **もう行動できない状態**。文字は `#eef0f1` |
| 帯（面） | `#dbe2ee` | 文字 `#24365c` |
| 帯（輪郭） | `#6a7d9e` | non-blocking |
| 赤の塗り上の文字 | `#f7f5f1` | |

**色の役割は3つに固定する。** 藍 = 操作できる場所と現在地、赤 = まだ間に合う期限と休日、墨 = 終わったもの。success / warning の状態色は持たない。

### バッジの4段階

| 見た目 | 意味 | 例 |
| --- | --- | --- |
| 輪郭（1px `--color-control-border`, 文字 `--color-text-tertiary`） | 分類 | 宝塚 / 月組、一般発売、FC先行・抽選、歌舞伎 |
| 淡い面（`--color-surface-subtle`） | 進行中の状態 | 申込中、結果発表を待つ、当選、参加する、自分の予定 |
| 赤の塗り（`--color-danger`） | 期限。行動すれば間に合う | 残り 1日、残り 12日 |
| 墨の塗り（`--color-terminal`） | 終了。行動する余地がない | 落選、不成立、受付終了、販売終了 |

- 共通: `padding: 3px 8px`、`border-radius: 2px`、11px / 600 / `line-height: 1.4`、バッジ間 `gap: 5px`
- 「公演終了」はバッジにしない（過去の公演は日付の並びで分かるため重複）
- `Badge` の variant は success / warning を廃し、この4段階に対応させる。`ticketDisplayStatusLabel` の danger = 墨

### 間隔・角丸

- 縦の間隔は 4 / 8 / 12 / 20 / 32 の5段のみ
- 角丸は 2px（バッジ・ボタン）と 4px（シェル上端・シート上端）のみ
- カード面（`Surface`）は使わない。区切りは 1px 細罫（行）と 2px 太罫（見出し）の2種

### ボタン

- 塗り（primary）は1画面に1つまで。実質シートの確定のみ
- 輪郭 / `small`: 可視31px、15px / 500、`padding: 4px 12px`、1px 枠 `--color-control-border`
- `quiet`: 背景・枠なし、13px、`--color-text-secondary`、`padding: 2px 8px`、`margin-inline-start: -8px`、可視27px
- すべてタップ44px。新しいテキストリンクは作らない（最低強調は `quiet`、戻る動線は `BackLink`）

### カレンダーの記号（marker）

- 複数日 = 帯、単日 = dot。イベントと個人予定で同じ規則
- dot は1セル1個。決まっているイベント or blocking の予定があれば塗り、検討中 or non-blocking のみなら輪郭
- 帯は blocking = 淡い藍面、non-blocking = 1px 輪郭
- 件数は表示しない
- 「今日」= 日付数字にグレーの塗り丸。「選択中」= セルを1.5pxの枠で囲う
- 祝日 = 日付を 600 + 赤。`祝` グリフは廃止
- 1セルの marker は最大3（dot 1個 + 帯 2本）

## 文言（正本は実装側）

`src/domain/*Formatting` の出力をそのまま使う。デザイン側で言い換えない。

- チケット状態 `ticketDisplayStatusLabel`: チケット確保済み / チケット申込中（未確定）/ チケット落選・不成立 / チケット未取得（未確定）
- 参加状態 `participationStatusLabel`: 参加する / 気になる
- 時刻 `occurrenceTimeRangeLabel`: `18:00〜20:30`、終了未定は `18:00〜（終了時刻未定）`、翌日終了は `（翌日）` を付す
- 個人予定 `scheduleTemporalLabel`: 単日 `2026年9月13日`、複数日 `2026年9月30日〜2026年10月2日`。「終日」という語は使わない
- 曜日・祝日 `calendarDayRoleLabel`: 土 / 日 の1文字、祝日は実際の祝日名

## 新規に必要なもの

`src/ui/` 50件を確認済み。以下は存在しないため新規実装。

1. 三状態チェックボックス（絞り込みシートの中間層の部分選択）
2. 墨の Badge variant（既存 danger の見せ方を差し替え）
3. チケット画面（`/tickets`）と bottom nav の4項目化
4. お知らせ画面（`/notifications`）
5. マイページ（`/mypage`、ホームから移設）

チェックボックス・ラジオ・トグル・セレクトは既存に無い。入力の境界線は `--color-control-border`、radius 10px、`min-height: 44px` の既存規約に合わせる。

## Assets

画像・アイコン素材は使っていない。ベル・アバター・チェック・矢印はすべて CSS の図形と文字で組んでいる。実装時はプロジェクトの既存アイコン方針に合わせて差し替えてよい（形と寸法は設計HTMLを参照）。

## Files

- `Stage Tracker リデザイン案.dc.html` — 設計の全体。**実装対象は先頭セクション（id `10a`〜`10g`）のみ**
- `screens/10a-home.png` 〜 `screens/10g-notifications.png` — 確定版7画面のスクリーンショット
- `issues/` — GitHub Issues 用の起票文（12件、実装順）
- `github.md`（プロジェクトルート） — これまでの決定事項と参照した実装ファイルの対応表
