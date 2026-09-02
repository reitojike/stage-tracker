# 三状態チェックボックス（新規コンポーネント）

**labels**: component, new
**depends on**: #1 tokens

## 背景

絞り込みシートでカテゴリの階層を扱う。中間層（例: 宝塚）は配下（花組・月組…）の一部だけが選ばれている状態を取りうるため、二状態では表現できない。

`src/ui/` 50件を確認したが、チェックボックス・ラジオ・トグル・セレクトはいずれも存在しない。新規に作る。

## やること

- 状態は `checked` / `unchecked` / `indeterminate` の3つ
- 見た目: 18px の四角、1px `--color-control-border`、radius 2px。checked = `--color-accent` の塗り + 白のチェック、indeterminate = `--color-accent` の塗り + 白の横棒
- タップ領域は行全体（`min-height: 44px`）
- 中間層をタップしたときの挙動: indeterminate または unchecked → 配下すべて checked、checked → 配下すべて unchecked
- 配下の状態変化に応じて親は自動で3状態を再計算する
- `aria-checked="mixed"` を indeterminate に割り当てる（native input の `indeterminate` プロパティでもよい）

## 完了条件

- キーボード操作（Space で切り替え、Tab で移動）が効く
- 色に依存せず判別できる（チェック / 横棒 / 空 の形の差がある）
