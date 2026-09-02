repo: reitojike/stage-tracker
branch: main

## Last sync

date: 2026-08-27T12:40:00Z

### Updated in this project

- 採用セクションを「確定版 — 藍と墨」に整理。9 vs 10 の比較文を削除し、バッジ4段階の凡例と実装への申し送り（画面と動線 / カレンダーの記号 / 文言 / 新規に必要なもの）に差し替え。TURN 9 以前は「参考」として残置

- danger に墨 #2b3033 を適用（落選 / 不成立 / 受付終了 / 販売終了）。赤の塗りは「まだ間に合う期限」だけになった
- **TURN 10（藍版）を採用確定。** 以後の画面はすべて 10 系のトンマナで作る（accent 藍 #2f4a7a / 赤 #a13b2e は締切と日祝のみ / 紙 #eef0f1）
- TURN 10：8a のレイアウトのまま accent を朱→藍 #2f4a7a に振ったパターンを3プージ作成（赤は締切と日祝だけに残す）
- ボタンを軽量化（可視 31px / 15px / 細枠）し、絞り込みをフィルターアイコン＋肩のバッジに変更
- **8a を採用確定。** TURN 9 として 8a の語彙で7画面を再構成（ホーム / イベント / 絞り込み / チケット / マイカレンダー / マイページ / お知らせ）
- TURN 8：トンマナを大きく変えた3案（8a 劇場のプログラム / 8b 暗転した客席 / 8c 手帳）をホーム＋カレンダーで提示
- 帯の塗り分けを「自分 / 共有」から「blocking / non-blocking」に変更（PO確定）
- 選択中の表現を日付の丸からセル全体の枠に変更（PO確定）
- src/ui/ 50件を全住確認。チェックボックス / トグルは存在しないため新規として明記
- TURN 7：accent を C #3a53a8 に確定し、AppBar を再設計（左ベル / 中央ロゴタイプ / 右マイページ）し、7画面を確定仕様で並べた
- テキスト系のコントロールを自作するのをやめ、Button `quiet` variant と `BackLink` の寸法に統一
- チケット申し込み一覧（6a）を新設し、bottom nav を 4項目化（ホーム / イベント / チケット / マイカレンダー）
- Event Catalog の絞り込みシート（6b）と適用後画面（6c）、お知らせ画面（6d）を追加
- 選択日リストの文言を src/domain/*Formatting の実装に修正（チケット状態の4ラベルとBadge variant、日付見出しの曜日表記、個人予定の期間表記）
- PO指示を反映：ホームを直近の予定中心に再構成、5b マイページを新設、カレンダーのmarkerを最大2に紞って祝日を太字化、「今日」をグレー丸に変更、帯を追加
- marker整理（band = 期間 / dot = その日）と accent hue 3案を提案
- /catalog と /calendar の現状画面を並べて忠実に再現（3a / 3b）し、IAの重複箇所を洗い出した
- 3a の band / 件数Badge を Issue #91 の disjoint モデル（bandは複数日Eventのみ、Badgeは単日Eventのみ）に修正
- ActionRow の row-gap 16 / column-gap 8 を実装値に修正
- ホーム画面の現状再現（2a）と、チケット期限を先頭に置くブラッシュアップ案（2b）を追加
- 2a のアカウント / Passkey ブロックを HomeAccount.tsx・PasskeySection.tsx の実装に合わせて修正
- docs/ux-ui.md は「現状のルールの記述」であり可変、という前提に更新（PO判断）

## Screen map

| 案 | 参照した repo ファイル |
| --- | --- |
| 2a 現状のホーム | src/app/(home)/page.tsx, _components/HomeNav.tsx, HomeNav.module.css, _components/HomeAccount.tsx, HomeAccount.module.css, _components/PasskeySection.tsx, PasskeySection.module.css, _components/RegisterPasskeyButton.tsx, src/ui/AppShell.module.css, src/ui/PrimaryNav.tsx, PrimaryNav.module.css, src/ui/Surface.tsx, Surface.module.css, src/ui/tokens.css, src/ui/globals.css |
| 2b ホーム ブラッシュアップ案 | 上記すべて + src/ui/Badge.module.css, src/ui/Button.module.css, src/ui/StatePanel.module.css |
| 3a /catalog 現状 | src/app/catalog/page.tsx, _components/MonthCalendar.tsx, MonthCalendar.module.css, _components/SelectedDayList.tsx, SelectedDayList.module.css, src/ui/ActionRow.tsx, ActionRow.module.css, src/ui/PageHeading.tsx, PageHeading.module.css, src/ui/Badge.module.css, src/ui/Button.module.css |
| 3b /calendar 現状 | src/app/calendar/page.tsx, _components/MyMonthCalendar.tsx, MyMonthCalendar.module.css, _components/MySelectedDayList.tsx, MySelectedDayList.module.css, src/ui/ActionRow.tsx, ActionRow.module.css, src/ui/PageHeading.tsx, PageHeading.module.css |
| 4a /calendar marker整理案 | 3b と同じ + src/ui/tokens.css |
| 4b accent hue 3案 | src/ui/tokens.css |
| 5a ホーム改善案 | src/app/(home)/page.tsx, src/ui/AppShell.module.css, src/ui/PrimaryNav.module.css, src/ui/PageHeading.module.css, src/ui/Badge.module.css |
| 5b マイページ（新設） | _components/HomeAccount.tsx, _components/PasskeySection.tsx, PasskeySection.module.css, _components/DeletePasskeyForm.tsx, _components/RegisterPasskeyButton.tsx, src/domain/passkey.ts, src/ui/Button.module.css, src/ui/Surface.module.css |
| 5c /calendar 改善案 | 3b と同じ |
| 5d 「今日」表示比較 | MyMonthCalendar.module.css, src/ui/tokens.css |
| 6a チケット申し込み一覧（新設） | src/domain/ticket.ts, ticketAcquisition.ts, myCalendarFormatting.ts, src/ui/PrimaryNav.module.css, src/ui/Badge.module.css, src/ui/Button.module.css, src/ui/tokens.css |
| 6b 絞り込みシート（新設） | カテゴリ機能は未実装。src/ui/tokens.css と Button / Badge の語彙に準拠 |
| 6c /catalog 絞り込み適用後 | MonthCalendar.module.css, MonthCalendar.tsx, SelectedDayList.module.css, ActionRow.module.css |
| 6d お知らせ（新設） | 未実装。personalScheduleFormatting.ts の期間表記に準拠 |
| 10a〜10g（採用版・藍） | レイアウトは TURN 9 と同一。tokens.css の --color-calendar-saturday = accent-600 の扱いを踏襲 |
| 9a〜9g（8a 語彙・朱） | 情報構造は TURN 7 と同じ。実装側の参照元も TURN 7 と同一 |
| 8a / 8b / 8c トンマナ3案 | 情報構造は TURN 7 と同じ。書体・面・色のみ差し替え（8b は tokens.css の semantic 層差し替えで成立） |
| 1a / 1b（初期案・参考） | なし（リポジトリ読み込み前に作成） |

## 参照したトークンとルール

- src/ui/tokens.css — canvas #eceef0, surface #ffffff, surface-subtle #f7f8f9, accent #3d5590, text #17191b / #565e65, icon-affordance #737b82, border #dde1e4, control-border #737b82, status success #22684a / warning #7a5417 / danger #b3413a, badge tint success #e4f0ea / warning #f4ece0 / info #e2e8f4 / neutral #eceef0, radius surface 12 / control 10 / control-sm 8 / band 5, system font stack
- docs/ux-ui.md — typography ladder（20/16/14/12/11）、container vocabulary、bottom nav label set、色のみに意味を依存しない。POにより可変要素として扱う

## 文言の正本（src/domain/*Formatting）

- チケット状態 `ticketDisplayStatusLabel` / `...BadgeVariant`：チケット確保済み=success / チケット申込中（未確定）=warning / チケット落選・不成立=danger / チケット未取得（未確定）=neutral
- 参加状態 `participationStatusLabel`：参加する / 気になる
- 時刻 `occurrenceTimeRangeLabel`：`18:00〜20:30`、endsAt が null なら `18:00〜（終了時刻未定）`、終了が翌日なら `（翌日）` を付ける
- 個人予定 `scheduleTemporalLabel`：終日単日は `2026年9月13日`、複数日は `2026年9月30日〜2026年10月2日`。「終日」という語は使わない
- 曜日・祝日 `calendarDayRoleLabel`：土 / 日 の1文字、祝日は実際の祝日名

## コントロール語彙の正本

- フォーム部品は `TextInput` / `TextArea` / `FormSection` / `RequirementIndicator` のみ。チェックボックス・ラジオ・トグルスイッチ・セレクトは存在しない（src/ui/ 50件全住確認済み）
- 入力の境界線は `--color-control-border` #737b82、radius `--radius-control` 10px、min-height 44px

- `Button` primary/secondary = 可視 35px / `small` 31px / `quiet` 27px / `icon` 40×40。tap はすべて 44px（tapTarget.module.css の expand44 を composes）
- `quiet` は背景・枠なし、文字色 `--color-text-secondary` #565e65、padding 2px 8px、radius 8px、font-size 14px
- `BackLink` は `←` + ラベル、可視 27px、padding-inline 8px と margin-inline-start -8px で文字を本文に揃える。色は #565e65、`‹` ではない
- 新しいテキストリンクを作らない。最低強調のアクションは `quiet`、戻る履歴は `BackLink`

## 採用したトンマナ（8a / TURN 9）と藍版（TURN 10）

### 共通

- カード面なし。区切りは 1px 細罫（行）と 2px 太罫（見出し）の2種
- 状態色（success / warning / danger）を持たない。バッジの形で3階層：輮郭 = 分類、淡い面 = 状態、赤の塗り = 期限
- ボタンは可視 31px / 15px / 細枠。塗りは1画面1つ（シートの確定のみ）
- 絞り込みは見出し行右のフィルターアイコン（肩のバッジで絞り込み中を表す）
- 角丸 = 2px（バッジ・ボタン）/ 4px（シェル上端）。書体は system font stack、webfont 追加なし
- 縦の間隔 = 4 / 8 / 12 / 20 / 32 の5段のみ
- コントロールの境界線は地に対して 3:1 以上（SC 1.4.11）

### 9 系（朱）

紙 #f2efe9 / 細罫 #ddd8ce / 太罫・文字 #2b2721 / 副 #6b6459 / 弱 #4a453c / 境界 #8d8677 / 淡い面 #e4dfd4 / accent 朱 #a13b2e（日祝と兼用）/ 土曜 藍 #3f5a70

### 10 系（藍）

紙 #eef0f1 / 細罫 #d7dcde / 太罫・文字 #1f2426 / 副 #5c6467 / 弱 #454b4e / 境界 #7f878b / 淡い面 #dfe4e7 / accent 藍 #2f4a7a（土曜と兼用、tokens.css と同じ扱い）/ 帯 #dbe2ee・文字 #24365c・輮郭 #6a7d9e / 赤 #a13b2e は締切バッジ・未取得の輮郭・日曜・祝日のみ / 墨 #2b3033 は落選・不成立・受付終了・販売終了の塗り（文字 #eef0f1）

## 未決事項（PO確認待ち）

- accent hue: 青系内の3案を提示済み（A #3d5590 現状 / B #344a7a 藍鉄 / C #3a53a8 群青、C推奨）
- チケット未確定の `!` marker を月カレンダーから外す判断（ホームの申し込みブロックに移管）
- マイページの展開位置（AppBar アバターからの二次画面とした）

## PO 確定事項

- **danger = 墨 #2b3033 の塗り**。「もう行動できない」状態すべてに適用：落選 / 不成立 / 受付終了 / 販売終了。赤の塗りは「これから来る期限」専用
- 過去の公演は日付の並びで分かるため「公演終了」バッジは出さない（墨のバッジは受付・販売・当落のみ）
- **accent = C #3a53a8**（群青）。scale: 100 #dee2f4 / 200 #b8c1e6 / 600 #3a53a8 / 700 #2e4285
- カレンダーの「今日」= 日付数字にグレー塗り丸、「選択中」= セルの四角を accent の枠で囲う（radius 8px / inset 1.5px、現仕様の「今日」と同じ見せ方）
- 帯は自分 / 共有ではなく **blocking / non-blocking** で分ける。blocking = 塗り、non-blocking = 白抜き。共有された予定も同じ規則
- dot の塗りは accent #3a53a8（黒でなく accent で確定）
- カレンダーの dot は1セル1個。決まっているイベント or blocking の予定があれば塗り、検討中のイベント or non-blocking の予定のみなら白。件数は出すない
- 複数日にまたがるものは帯、単日は丸。イベントと個人予定で同じ規則
- 祝日は日付を太字（600）＋赤。祝 グリフは廃止
- AppBar：左にお知らせ（ベル）、中央にロゴタイプ（system font 大文字 11px/600/字送り0.18em）、右にマイページ
- 絞り込みは中間層の部分選択を持つ（三状態）。件数表示は不要
- チケット申し込みは独立1画面（bottom nav 4項目化）
- /catalog の既定表示は前回の状態を復元、帯の先頭にカテゴリの短紮ラベル
- お気に入りは中間層と最下層の両方
- プッシュ通知は MUST でない。お知らせ画面をメイン動線とは別に設ける
- docs/ux-ui.md は現状の記録であり、よりよいデザインのためなら可変

## 次ターンの作業

- 確定版（10 系＋墨）を実装へ渡す。三状態チェックボックス・墨の Badge variant・チケット画面が新規
