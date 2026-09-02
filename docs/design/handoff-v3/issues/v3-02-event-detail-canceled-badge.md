# 02. イベント詳細の中止 badge を日時の行へ

> **適用済み（Issue #245、2026-08-30 の同期で確認）。** `.occurrenceTime` が
> `display: flex` / `gap: 6px` / `align-items: flex-start` になり、badge は
> `.occurrenceCanceledBadge`（`flex-shrink: 0`）として日時の左に入っています。

参照画像：`../reference/event-detail-390.png`
デッキ：TURN 27a

## 背景

公演回の行で、中止 badge が日時の上に1行取っています。招待一覧（#240 で適用済み）は
タイトルの左に並べたので、2画面で扱いが分かれています。行の縦幅も1行分伸びます。

## 変更

`EventDetail.module.css` の `.canceledBadge`（`margin-bottom` で日時の上に置く形）を
やめ、`.occurrenceTime` と同じ行に `gap: 6px` で並べます。

- badge は `flex-shrink: 0`
- 日時が折り返す場合も badge は先頭行に残す
- `InvitationCard.module.css` の `.title` がすでに同じ扱いなので、それに合わせる

イベント全体の中止 badge（見出し直下）は変更しません。

## 触らないもの

- 「選択した公演回」の badge とリングの扱い（Issue #107）
- 未回答の行に状態ラベルを出さない挙動（PO 確定。「未定」は出さない）
- 公演回リストの罫と `padding-block`（12px）

## 確認

- [ ] 中止 badge が日時と同じ行の左にある
- [ ] 日時が折り返す長さでも badge が先頭行に残る
- [ ] 中止でない行の見た目が変わっていない
- [ ] 390px で参照画像との重大な visual 差異がない
