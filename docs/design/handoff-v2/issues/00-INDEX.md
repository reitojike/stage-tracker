# Issue インデックス

親Issue: 「リデザイン第2弾（確定案 TURN 12）」を新規に立て、#136 から参照する。
#136 の子（#137〜#148）はほぼマージ済みのため、本件は別の親にぶら下げる。

## 基盤 — 先にマージする

| # | 内容 | ファイル |
| --- | --- | --- |
| 1 | 角丸とボタン | `01-radius-and-buttons.md` |
| 2 | Badge に「完了」variant | `02-badge-done-variant.md` |
| 3 | StatePanel の空とエラー | `03-state-panel.md` |

## 共通 — 互いに独立

| # | 内容 | ファイル |
| --- | --- | --- |
| 4 | PrimaryNav にアイコン | `04-primary-nav-icons.md` |
| 5 | 日付色の共通化 | `05-date-color.md` |
| 6 | カード面の撤去 | `06-remove-card-surfaces.md` |

## ドメイン

| # | 内容 | ファイル |
| --- | --- | --- |
| 7 | 残り日数の閾値 | `07-deadline-thresholds.md` |
| 8 | 表示範囲（保持期間と窓） | `08-visible-window.md` |

## 画面 — 1〜8 のあと

| # | 内容 | ファイル |
| --- | --- | --- |
| 9 | ホーム | `09-home.md` |
| 10 | イベント＋絞り込みシート | `10-catalog-and-filter.md` |
| 11 | マイカレンダー | `11-my-calendar.md` |
| 12 | チケット | `12-tickets.md` |
| 13 | マイページ | `13-mypage.md` |

## 実装後の手直し（2026-08-29、main 同期で拾った分）

| # | 内容 | ファイル |
| --- | --- | --- |
| 14 | 開催期間の日付表記を他画面と揃える | `14-event-range-date-format.md` |
| 15 | 日曜・祝日の赤を1値にする | `15-sunday-red-single-value.md` |

1〜13 はマージ済み。この2件はどちらも小さく、互いに独立している。

## Claude Code への指示

- 各Issueは1PR。基盤3件が入るまで画面Issueは着手しない
- 既存のトークンとコンポーネントを使う。新しい色・新しい角丸値は追加しない
- 44px のタップ範囲（`tapTarget.module.css` の `expand44`）は今回の変更で外さない
- 見た目の値はIssue本文の実数を正とし、モックのHTMLからコピーしない（モックはインラインstyleで書かれている）
