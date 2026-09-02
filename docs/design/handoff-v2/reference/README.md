# reference/ — visual source of truth

390px 幅で撮った正解画像です。実装後、同じ幅で screenshot を取り、
ここの画像と比較してください。運用ルールは `../MATERIALIZATION.md`。

| 画像 | 画面 | 対応フレーム | 対応 Issue |
|---|---|---|---|
| `event-detail-390.png` | イベント詳細 | 25a | 18 |
| `invite-sheet-390.png` | 招待するシート | 25b | 18 |
| `invitations-390.png` | 招待一覧 | 25c | 17 |

いずれも `Stage Tracker リデザイン案.dc.html` の TURN 25 を切り出したものです。
画像は1状態しか写しません。中止・0件・送信中・8秒の取り消しなどは
対応 Issue の状態表を参照してください。

## `_source.html` について

撮影専用の中間ファイルです。`Stage Tracker リデザイン案.dc.html` の TURN 25 を
機械的に切り出したコピーなので、**直接編集しないでください**。
画像を撮り直すときは、必ず dc.html から再生成してから撮影します
（編集すると dc.html と静かにずれ、MATERIALIZATION.md §4 が禁じている
第二の正典になります）。
