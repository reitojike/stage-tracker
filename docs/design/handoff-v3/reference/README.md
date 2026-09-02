# reference/ — visual source of truth

390px 幅で撮った正解画像です。実装後、同じ幅で screenshot を取り、
ここの画像と比較してください。運用ルールは `../MATERIALIZATION.md`。

| 画像 | 内容 | Issue | デッキ |
|---|---|---|---|
| `parts-quiet-button.png` | quiet の原則（塗りなし）と例外（行全体リンク） | 01 | TURN 28 見本 |
| `parts-danger-and-radius.png` | danger の透明化、角丸2値の対比 | 01 | TURN 28 見本 |
| `event-detail-390.png` | イベント詳細（中止 badge が日時の行） | 02 | 27a |
| `event-create-390.png` | イベントを登録 | 03 | 23c |
| `event-edit-390.png` | イベント編集 | 03 | 23b |
| `schedule-detail-390.png` | 個人予定の詳細（共有はシート） | 04 | 23e |
| `schedule-new-390.png` | 個人予定を追加 | 04 | 23f |
| `schedule-edit-390.png` | 個人予定を編集 | 04 | 23g |
| `sign-in-390.png` | サインイン | 05 | 23h |
| `filter-sheet-390.png` | 絞り込みシート（構造は実装採用。条件をクリアの塗りなしは 01 適用後の姿） | 01 | 27b |
| `participation-sheet-390.png` | 参加の状態シート（01 で閉じるが揃う） | 01 | 27c |
| `finishing-event-edit-390.png` | イベント編集（保存はグループの中／中止 badge は日時の左） | 06 | 31a |
| `finishing-occurrence-lifecycle-390.png` | 公演回シートの中止・削除（通知は行の外、ボタンは横1行） | 06 | 31a の注記 |
| `finishing-share-sheet-390.png` | 共有相手を追加シート（footer に確定・閉じるなし） | 06 | 31b |
| `finishing-sign-in-requested-390.png` | サインイン受付（淡い面・角丸4px） | 06 | 31c |

いずれも `Stage Tracker リデザイン案.dc.html` の該当フレームを切り出したものです。

**すべて Issue 適用後の姿を描いています。** 現行実装の as built ではありません。
絞り込みシートは構造を実装から取っていますが、「条件をクリア」の塗りだけは
01 適用後（塗りなし）で描いてあります。

## 画像は1状態しか写しません

時間で変わるもの（取り消しトーストの8秒）、0件・空・エラー・送信中、中止や締切で
選択肢が変わるもの、件数バッジの出現条件は、対応する Issue の本文を読んでください。

## 撮影のしかた

撮影用の中間ファイルは置いていません。撮り直すときは、
`Stage Tracker リデザイン案.dc.html` の該当フレームを機械的に切り出した
一時ページを作って撮影し、そのページは捨てます。

切り出したコピーを残さないのは、dc.html と静かにずれて第二の正典になるためです。
