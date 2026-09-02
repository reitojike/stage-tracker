# 起票の順序

粒度はコンポーネント/変更単位。1〜3（基盤）を先に確定させてから画面に入る。各Issueの本文は `design_handoff_stage_tracker/README.md` を参照する前提で書いてある。

| # | ファイル | 内容 | 前提 |
| --- | --- | --- | --- |
| 1 | 01-tokens.md | トークン追加（墨・紙・罫・境界） | — |
| 2 | 02-badge.md | Badge を4段階に再定義 | 1 |
| 3 | 03-tristate-checkbox.md | 三状態チェックボックス（新規） | 1 |
| 4 | 04-bottom-nav.md | bottom nav を4項目に | 1 |
| 5 | 05-appbar.md | AppBar 再構成（ベル / ロゴタイプ / アバター） | 1 |
| 6 | 06-calendar-markers.md | カレンダーの marker 規則 | 1 |
| 7 | 07-home.md | ホーム再構成 | 2,4,5 |
| 8 | 08-tickets.md | チケット画面（新規） | 2,4 |
| 9 | 09-catalog.md | イベント（/catalog）更新 | 2,6 |
| 10 | 10-mycalendar.md | マイカレンダー（/calendar）更新 | 2,6 |
| 11 | 11-filter-sheet.md | 絞り込みシート（新規） | 3 |
| 12 | 12-mypage-notifications.md | マイページ / お知らせ | 5 |

Claude Code への渡し方の例:

```
このフォルダの issues/*.md を、00-INDEX.md の順で GitHub Issues に起票してください。
起票後、01 から順に実装してください。仕様は README.md、見た目は screens/*.png と
Stage Tracker リデザイン案.dc.html の先頭セクション（id 10a〜10g）を参照してください。
```
