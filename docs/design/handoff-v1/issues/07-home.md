# ホームを「期限」と「直近の予定」の2ブロックに再構成

**labels**: screen
**depends on**: #2 badge, #4 nav, #5 appbar

## 背景

現状のホームは行き先の名前と説明が並ぶだけで、「いま何をすべきか」が分からない。bottom nav と重複する動線カードを全て外し、期限と直近の予定だけを置く。

## やること

参照: `screens/10a-home.png`、設計HTMLの id `10a`

- **HomeNav（動線カード）を削除**。bottom nav と重複する
- **アカウント / Passkey ブロックを削除**し、マイページ（#12）へ移設
- ブロック1「申し込み期限」: 横スクロールのカード列。カード幅158px、`gap: 8px`。中身は 赤の塗りバッジ（残りN日）+ タイトル16px/600 + 日時13px
- ブロック2「9月の予定」: 日付ごとの縦リスト。左に時刻列（44px / 12px / `--color-text-secondary`）、右に本文（タイトル16px/600、会場13px、バッジ列）
- ブロック見出しは太罫（`border-bottom: 2px solid --color-text`, `padding-bottom: 8px`）、15px / 600
- 行の区切りは 1px 細罫、行の padding は `14px 0`
- ページ見出し 24px / 600、本文 padding `20px 16px 24px`、ブロック間 `gap: 32px`
- カード面（`Surface`）は使わない

## 完了条件

- 画面内に bottom nav と同じ行き先へのリンクが無い
- 赤の塗りが出ているのは期限のバッジだけ
