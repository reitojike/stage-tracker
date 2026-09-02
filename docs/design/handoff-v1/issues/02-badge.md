# Badge を4段階に再定義（danger = 墨）

**labels**: design-system, component
**depends on**: #1 tokens

## 背景

状態色（success / warning / danger）を持たない方針にしたため、Badge の意味を色ではなく「4つの見た目」で表す。

## やること

`src/ui/Badge` の variant を次の4つにする。

| variant | 見た目 | 意味 | 例 |
| --- | --- | --- | --- |
| `outline` | 1px `--color-control-border` / 文字 `--color-text-tertiary` / 背景なし | 分類 | 宝塚 / 月組、一般発売、FC先行・抽選 |
| `subtle` | 面 `--color-surface-subtle` / 文字 `--color-text-tertiary` | 進行中の状態 | 申込中、結果発表を待つ、当選 |
| `deadline` | 塗り `--color-danger` / 文字 `#f7f5f1` | 期限（行動すれば間に合う） | 残り 1日 |
| `terminal` | 塗り `--color-terminal` / 文字 `--color-terminal-on` | 終了（行動する余地がない） | 落選、不成立、受付終了、販売終了 |

共通スタイル: `padding: 3px 8px` / `border-radius: 2px` / `font-size: 11px` / `font-weight: 600` / `line-height: 1.4`。バッジを並べるときは `display: flex; flex-wrap: wrap; gap: 5px`。

## 既存の対応

`ticketDisplayStatusBadgeVariant` のマッピングを差し替える。

- success（チケット確保済み） → `subtle`
- warning（チケット申込中（未確定）） → `subtle`
- danger（チケット落選・不成立） → **`terminal`**
- neutral（チケット未取得（未確定）） → `outline`

ラベル文字列（`ticketDisplayStatusLabel`）は変更しない。

## やらないこと

- 「公演終了」バッジは作らない。過去の公演は日付の並びで判別できるため重複になる。墨のバッジを出すのは受付・販売・当落の3系統だけ。

## 完了条件

- 4 variant が実装され、既存の Badge 利用箇所がすべて4つのいずれかに割り当てられている
- 墨の上の文字コントラストが 4.5:1 以上（#eef0f1 on #2b3033 ≈ 13:1）
