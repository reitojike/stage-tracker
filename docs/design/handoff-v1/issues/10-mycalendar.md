# マイカレンダー（/calendar）を確定版の表示規則に更新

**labels**: screen
**depends on**: #2 badge, #6 calendar

## やること

参照: `screens/10c-mycalendar.png`、設計HTMLの id `10c`

- カレンダーは #6 の marker 規則に従う
- **個人予定の帯は blocking / non-blocking で分ける**（自分 / 共有 では分けない）。blocking = 面、non-blocking = 輪郭。共有された予定も同じ規則
- 従来の `予` / `共` / `?` / `!` のグリフは廃止
- カレンダー下に凡例を1行: ● 決まっている / ○ 検討中 / ▬ 予定を確保する / ▭ 確保しない
- 選択日リストに公演と個人予定を混ぜる。個人予定の期間表記は `scheduleTemporalLabel` に従う（「終日」の語は使わない）
- カード面（`Surface`）は使わない

## 完了条件

- 帯の塗り分けが blocking / non-blocking になっている
- チケット未確定の `!` marker がカレンダーから消えている（チケット画面に移管済み）
