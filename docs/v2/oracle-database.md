# 移行期のデータベース資料インデックス

**状態: 履歴の参照解決用であり、現行のデータベース仕様ではありません。** 現在の DB 挙動は適用済みスキーマとマイグレーション、現行 DB テスト、および該当する Living Spec が定義します。

データベース資料の完全版は圧縮直前のコミットに保存されています。
[891807ba2977466477b0292bd22ee51c2d80a3d9 時点の oracle-database.md](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/oracle-database.md)。

## 変更されないマイグレーションの参照先

適用済みマイグレーション `20260908000100_consolidate_event_occurrences_event_id_index.sql` は、「§7 point 8 (A14, Issue #375 In Scope #3)」を参照しています。参照先は完全版の[§7 第8項](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/oracle-database.md#L1141)です。A14 の判断記録は[こちら](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L61)、関連する [Issue #375](https://github.com/reitojike/stage-tracker/issues/375) も参照してください。現在の実装は適用済みマイグレーションと現行 DB テストです。この履歴参照先は現行スキーマの挙動を定めません。
