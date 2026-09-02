# 1. 角丸とボタン

## 背景

カード面を外して角丸を 2px / 4px に絞ったのに、ボタンだけ 10px の角丸と白面のまま残っている。紙 `#eef0f1` の上でボタンだけが白く浮く。

参照: TURN 16（16a / 16b / 16c の比較、採用は 16b）、TURN 12 全画面

## 変更

`src/ui/tokens.css`

- `--radius-control`: 10px → **4px**
- `--radius-control-sm`: 8px → **4px**
- `--radius-surface`（12px）: 参照箇所が無くなるので削除。#6 のあとに消えるので、#6 とどちらが先でも良いよう最後に残った参照を確認してから消す

`src/ui/Button.module.css`

- `.secondary`: `background-color` を `var(--color-surface)` → `transparent`。border は `var(--color-control-border)` のまま
- `.small`: 同上
- `.quiet`: 静止状態に `background-color: var(--color-surface-subtle)` を敷く（現在は transparent）。行全体がリンクになる画面（#12）で、面の無い文字ボタンが押せる部分として立たなくなるため
- hover / active の `--color-surface-subtle` / `--color-surface-active` はそのまま。`.quiet` は静止が subtle に上がるので、hover は active 相当へ1段ずらす

## 確認

- 12f のサインアウト、12g の「条件を解除する」、12h の「再読み込み」が細罫だけの箱になる
- 12c の「この条件で絞り込む」は藍の面のまま、角丸だけ 4px
- 12e の行内 quiet ボタンに淡い面が付く
- WCAG 2.2 SC 1.4.11: transparent 化した secondary の境界は紙 `#eef0f1` に対して `--color-control-border` で 3:1 を満たすこと（現状の rest 状態と同条件）
