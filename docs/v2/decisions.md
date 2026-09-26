# 移行期の判断記録インデックス

**状態: 履歴資料であり、現行の仕様ではありません。** 現在の挙動と運用上の契約は Living Spec、アーキテクチャ、runbook、実行可能な設定、ソース、テストが管理します。

判断記録の完全版は圧縮直前のコミットに保存されています。
[891807ba2977466477b0292bd22ee51c2d80a3d9 時点の decisions.md](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md)。このインデックス内のリンクは履歴記録を示すもので、過去の判断を現行要件として復活させるものではありません。

| 履歴上の識別子 | 履歴記録の参照先                                                                                                                                          | 現在の管理先（該当する場合）                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D1 = D         | [PO の判断と理由](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L1038)                    | [ランタイム構成](../architecture/runtime-stack.md)、[リモート環境 runbook](../runbooks/gate-a-remote-environment.md) |
| A8             | [runtime-first の順序に関する理由](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L1115)   | [ランタイム構成](../architecture/runtime-stack.md)、[リモート環境 runbook](../runbooks/gate-a-remote-environment.md) |
| P5             | [外部キー `ON DELETE` の判断](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L156)         | 現行スキーマ、マイグレーション、DB テスト                                                                            |
| A1             | [ボタンの variant / size に関する判断](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L25) | [共通 UX/UI 契約](../ux-ui.md)と `packages/ui`                                                                       |
| A2             | [未定義トークンの指摘](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L26)                 | [共通 UX/UI 契約](../ux-ui.md)と現行スタイル                                                                         |
| P2             | [主要ナビゲーションの判断](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L122)            | 現行ナビゲーションと[UX/UI 契約](../ux-ui.md)                                                                        |
| A14            | [インデックス統合の指摘](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L61)               | マイグレーションと現行 DB テスト                                                                                     |

削除したその他の判断記録は、上記の変更されない完全版から参照できます。
