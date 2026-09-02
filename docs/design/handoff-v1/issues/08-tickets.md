# チケット画面を新設する（/tickets）

**labels**: screen, new
**depends on**: #2 badge, #4 nav

## 背景

抽選申込・結果発表・発売開始・入金期限は、種別が違っても「期限が来る」という点で同じ。種別で分けず、期限の近い順に1本で並べる。

## やること

参照: `screens/10d-tickets.png`、設計HTMLの id `10d`

- ルートは `/tickets`。bottom nav の3番目
- 先頭に「＋ 申し込み予定を追加」（輪郭ボタン、可視31px）
- 月見出しは細罫 + 12px / 600 / `letter-spacing: 0.1em`（太罫=セクション、細罫=月 の2段の階層）
- 各行:
  - 左に日付列（44px）。日付22px/600 + 曜日10px/600/`0.1em`。期限が迫る行は日付を `--color-danger`、土は `--color-accent`、他は `--color-text`
  - 右に本文: タイトル16px/600、補足13px（`23:59 締切` / `10:00 発表済み` / `23:59 入金期限 ・ 24,000円`）、バッジ列、最下に `quiet` アクション（可視27px、`margin-inline-start: -8px`）
- バッジは #2 の4段階に従う。期限が残っているものは `deadline`（残りN日）、落選・不成立は `terminal`、結果待ち・当選は `subtle`、券種は `outline`
- 並び順は期限の昇順。種別でグルーピングしない

## 完了条件

- 「落選」の行と「残り1日」の行が縦に並んだとき、行動が必要な側だけが赤で立つ
- 文言は `ticketDisplayStatusLabel` / `occurrenceTimeRangeLabel` の出力そのまま
