# 08. 確認シートの footer を保存シートと揃える

デッキ：TURN 33d（拾った差分）／規模：小（CSS と footer の囲みだけ）／前提：07

## 何が起きているか

v3-07 で削除3か所が `Sheet` の確認になりましたが、footer に渡しているのが素の `<div>` です。

```tsx
footer={
  <div>
    <Button type="submit" form={formId} variant="danger" …>削除</Button>
  </div>
}
```

保存系のシート（`OccurrenceUpdateForm` / `EventRangeEditForm` / `OccurrenceAddForm` / `ShareAddSheet`）は
同じ位置に `.sheetFooter` を敷いています。

```css
.sheetFooter {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-md);
  border-top: 1px solid var(--color-border);
}
```

このため確認シートだけ、**実行ボタンが本文に接して左寄せ**になり、本文と footer の境目の
1px 罫もありません。1画面の中では破綻しませんが、保存シートと確認シートを続けて見ると
「シートの footer の形が2つある」ように見えます — v3-06 で `ShareAddSheet` を揃えたのと同じ問題です。

## やること

- 削除3か所（`DeleteEventForm` / `DeleteOccurrenceForm` / `DeleteEntryForm`）の footer の `<div>` に
  `.sheetFooter` を当てる
- 個人予定側（`ScheduleWriteForm.module.css`）に `.sheetFooter` が無ければ、
  イベント側と同じ値で追加する。値は増やさない（`--space-md` / 1px / `--color-border`）

## Acceptance Criteria

- [ ] 削除3か所の実行ボタンが右寄せになり、上に 1px の罫と `--space-md` の余白がある
- [ ] 保存シートの footer と見た目が一致している（390px で並べて確認）
- [ ] 実行ボタンは `danger`、ヘッダに「閉じる」なし、`form={formId}` の紐づけを変えていない
- [ ] `CONFIRM_MESSAGE` の文言・`Sheet` の公開 API・server action を変更していない

## 触らないもの

- 確認の規則そのもの（`RULES.md` §「破壊的操作の置き場所」）— 削除＝シート、中止・解除＝即実行のまま
- `.stablePending*` の3クラス（v3-07 で入った幅固定の手法）

## 付随（同じ PR で片付けてもよい、見た目の差はなし）

- `tickets/_components/TicketOpportunityWriteNotice.tsx` を `src/ui/WriteNotice` に寄せる（3つ目の複製）
- `Sheet` の `closeButtonClassName` は呼び出し元が0になっている
