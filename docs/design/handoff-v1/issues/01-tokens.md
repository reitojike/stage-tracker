# トークン追加: 墨（terminal）と紙・罫・境界の更新

**labels**: design-system
**depends on**: なし

## 背景

色の役割を3つに固定する。藍 = 操作できる場所と現在地、赤 = まだ間に合う期限と休日、墨 = もう行動できないもの。従来の success / warning / danger の状態色3種はこの規則に合わないため廃止する。

## やること

`src/ui/tokens.css` を更新する。

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--color-canvas` | `#eef0f1` | 紙 |
| `--color-border` | `#d7dcde` | 細罫（行の区切り） |
| `--color-text` | `#1f2426` | 本文 / 太罫 |
| `--color-text-secondary` | `#5c6467` | 副 |
| `--color-text-tertiary` | `#454b4e` | バッジ内の文字 |
| `--color-control-border` | `#7f878b` | コントロールの枠 |
| `--color-surface-subtle` | `#dfe4e7` | 淡い面 |
| `--color-accent` | `#2f4a7a` | accent（土曜も同値） |
| `--color-danger` | `#a13b2e` | 期限・日祝 |
| `--color-terminal` | `#2b3033` | **新規**。終了状態の塗り |
| `--color-terminal-on` | `#eef0f1` | **新規**。墨の上の文字 |
| `--color-band-fill` | `#dbe2ee` | 帯（blocking） |
| `--color-band-text` | `#24365c` | 帯の文字 |
| `--color-band-outline` | `#6a7d9e` | 帯（non-blocking） |

- `--color-calendar-saturday` は `--color-accent` を参照（現行の扱いを踏襲）
- 角丸は `--radius-badge: 2px` / `--radius-sheet: 4px` を追加。既存の surface 12px は使わなくなる
- success / warning のトークンは残してよいが、UIからの参照を無くす

## 完了条件

- `--color-terminal` / `--color-terminal-on` が定義されている
- `--color-control-border` が `--color-canvas` に対して 3:1 以上（SC 1.4.11）
- 既存画面がビルド・表示できる（見た目の差分は後続Issueで吸収）
