# AppBar 再構成（左ベル / 中央ロゴタイプ / 右アバター）

**labels**: navigation
**depends on**: #1 tokens

## やること

- 高さ48px、下辺に 1px `--color-border`、`padding-inline: 4px`
- 左: お知らせ（ベル、40×40のタップ領域）。未読があれば右上に 7px の `--color-accent` の点、`box-shadow: 0 0 0 1.5px --color-canvas` で紙色の縁を付ける
- 中央: ロゴタイプ `STAGE TRACKER`。14px / 600 / `letter-spacing: 0.22em` / `--color-text`
- 右: マイページ（40×40 の中に 30px の円、1px `--color-control-border`、イニシャル12px）
- 未読の点は **藍**。赤は「期限」と「休日」に割り当てているため未読には使わない

## 完了条件

- 全画面で AppBar が共通表示される
- 左右のタップ領域が44px以上
