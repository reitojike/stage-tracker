# v2 決定ログ

oracle 抽出中に見つかった、v2 で判断が必要な論点。
`OPEN` は未決、`AGENT` は実装側で決めてよい技術判断、`PO` は product 判断が要るもの。

## PO 判断が必要

| # | 論点 | 現状 | 出典 |
|---|---|---|---|
| P1 | 通知ベルが未配線のまま UI に存在（Issue #141 以降）。v2 で実装するか、UI から外すか | `aria-disabled` の非活性ボタンとして表示され続けている | oracle-routes-ui §5 |
| P2 | `/schedule` と `/mypage` が PrimaryNav に無く、文脈的な入口からしか到達できない。個人予定管理の重要度次第で IA を再検討するか | 意図的な設計（コード内コメントに明記）だが妥当性は未評価 | oracle-routes-ui §5 |
| P3 | Invitation の decline が client-side 8秒タイマー + unmount 確定の楽観的 UI。タブを閉じる等の離脱で pending が残り得る。server 主導へ変えるか、現挙動を仕様として明文化するか | 実際の離脱時挙動は未検証 | oracle-routes-ui §5 |
| P4 | エラー表示の粒度が画面間で不揃い。ホームは read ごとに独立劣化、カレンダーは単一エラーへ縮退。v2 で揃えるか、意図的な差として明文化するか | 意図か未整理かが不明 | oracle-routes-ui §5 |

## 実装側で決めてよい技術判断

| # | 論点 | 方針 |
|---|---|---|
| A1 | `Button` の variant に「意味」と「サイズ」が混在（`secondary` と `small` が同一 chrome でサイズのみ差） | shadcn 準拠で `variant`（意味）と `size` の2軸へ分離する |
| A2 | `--color-primary` という未定義 token 参照が1箇所ある | 現行のバグ。v2 へ踏襲しない |
| A3 | `monthCalendarGrid.module.css` が primitive token を直接参照（自社規約の唯一の違反） | v2 では semantic token のみ参照する規約を維持し、これを踏襲しない |
| A4 | orphan token（`--space-scale-7`, `--radius-scale-xs/md/lg`, `--color-success/-warning/-info` 等）が複数ある | Tailwind `@theme` 移行時に棚卸しし、使用実績のないものは移さない |
| A5 | `loading.tsx` が Client Component 化して URL を再解決している | Next.js が `loading.tsx` に params を渡さない制約への対処。v2 でも Next.js を使うため制約は同じ。ただし「データ依存の見出しを先取り表示しない」原則は維持する |
| A6 | 各ルートが「今日」を個別実装（`_lib/today.ts` / `_lib/now.ts`） | `packages/domain` を clock-free に保つ意図は正しい。clock 境界を1箇所に集約し直す |

## 引き継ぐと決めた不変原則

- `StatePanel` の `empty` / `error` / `unavailable` 3分岐。RLS 等の silent failure を
  空状態 UI へ誤変換しないための全画面共通原則。v2 でも維持する。
- 認証は `proxy.ts` 相当の default-deny を基本とし、ページ内でも権限を再確認する二重化を維持する。
- 権限判定の真の境界は RPC / RLS 側にあり、画面側の判定はレンダー制御に過ぎない、という位置づけを維持する。
