# bottom nav を4項目にする（チケットを追加）

**labels**: navigation
**depends on**: #1 tokens

## 背景

チケットの期限管理を独立した動線にする。あわせて、画面の中に nav と重複するリンクを置かない方針にする（ホームの動線カードを廃止する前提）。

## やること

`src/ui/PrimaryNav` を4項目にする: **ホーム / イベント / チケット / マイカレンダー**

- 各項目 `flex: 1`、`min-height: 56px`、ラベル 12px、上辺に 1px `--color-border`
- 現在地: ラベル 600 + `--color-text`、項目の上端に高さ2pxの `--color-accent` のバー（左右 `inset: 12px`）
- 非現在地: 400 + `--color-text-secondary`
- アイコンは持たない（テキストのみ）
- 「マイカレンダー」は390px幅で折り返すため `overflow-wrap: anywhere`
- マイページとお知らせは nav に入れない（AppBar から開く）

## 完了条件

- 4項目が390px幅で破綻せず表示される
- 各項目のタップ領域が44px以上
