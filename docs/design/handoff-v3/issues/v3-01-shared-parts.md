# 01. 共通パーツの語彙を揃える

> **適用済み（Issue #244、2026-08-30 の同期で確認）。** 3件とも決定どおりで、
> `.quietAction` 3箇所と `--radius-badge` 上書き2箇所も削除されています。
> 例外のチケット行は `TicketOpportunityStateControls.module.css` の
> `button.stateButton` にスコープされています。以下は実装時の指示の記録です。

参照画像：`../reference/parts-quiet-button.png` / `../reference/parts-danger-and-radius.png`
ルール：`../RULES.md`
デッキ：TURN 28

## 背景

`src/ui/` の共通パーツを `../RULES.md` と突き合わせたところ、3件が食い違っていました。
いずれも画面単位ではなくパーツ単位の不一致なので、**直すと全画面に効きます。**

Issue #240 では、この食い違いを画面ごとの上書きで埋めていました。既定を直せば
その上書きは不要になるため、あわせて削除します。

## 1. quiet ボタンは静止時に塗りを持たない

`Button.module.css` の `.quiet` から静止時の `background-color: var(--color-surface-subtle)`
を外します。hover / active のフィードバック（`--color-surface-active`）は残します。

### 例外を1つだけ設ける

**行全体がリンクになっている行の中だけ、静止時の淡い面を許します。**
該当は `TicketOpportunityStateControls`（チケット行の状態変更）のみ。

理由は「行全体がリンクなので、押せる場所がどこかを示す必要がある」ことで、
quiet だからではありません。したがって `.quiet` の既定に戻すのではなく、
チケット行の側にスコープ付きのクラスを1つ置いてください。

### 不要になる上書き

既定が変わるので、#240 で入れた `.quietAction` 3箇所を削除します。

- `src/app/catalog/_components/InviteSheet.module.css`
- `src/app/catalog/_components/InvitationCard.module.css`
- `src/app/catalog/_components/OccurrenceParticipationRow.module.css`

これでシートの「閉じる」も全画面で同じ見た目になります（参加の状態シートだけ
塗りが残っていた不整合の解消）。

## 2. danger ボタンの白面を外す

`Button.module.css` の `.danger` から `background-color: var(--color-surface)` を外し、
透明にします。ほかの variant は #185 で透明になったのに danger だけ取り残されていて、
紙 `#eef0f1` の上に白い箱が1つだけ浮いていました。

赤の枠と文字は残すので、危険であることは変わりません。hover / active も現状のまま。

## 3. ボタンの角丸を 4px の1値に戻す

`--radius-control`（4px）が正しい値です。#240 で入れた `--radius-badge`（2px）の
個別上書き2箇所を削除します。

- `src/app/catalog/_components/InviteSheet.module.css` の `button.submitButton`
- `src/app/catalog/_components/InvitationCard.module.css` の `button.acceptButton`

`Button.module.css` と `tokens.css` は変更しません。**決定稿側の誤り**で、
README の「2px = バッジとボタン」を品目で書いたことが原因でした。角丸は
箱の大きさで分ける書き方に直しています（`../RULES.md`）。

## 4. Badge のコメントを5段階に直す

`Badge.module.css` 冒頭のコメントが「4 shape-based variants
(outline/subtle/deadline/terminal)」のままです。#186 で `done`（✓ 付き）が増えて
5 variant になっているので、記述を合わせます。コードは変更なし。

## 触らないもの

- `tokens.css`（値の追加・変更なし。既存トークンの参照だけで足ります）
- `Button` の寸法（35 / 31 / 27 / 40px）と 44px の tap 範囲
- `Sheet` の骨格、`StatePanel`、`Surface`、`TextInput` の既定
- `FilterSheet` の「条件をクリア」— quiet の既定が変わるので自動的に塗りなしになります
  （`../reference/filter-sheet-390.png` はその適用後の姿で描いてあります）

## 確認

- [ ] quiet ボタンが静止時に塗りを持たない（シートの閉じる、変更 / 招待、参加しない、条件をクリア）
- [ ] チケット行の状態変更だけ静止時に淡い面がある
- [ ] すべてのシートで「閉じる」の見た目が同じ
- [ ] 削除ボタンに白い面がない
- [ ] ボタンの角丸が 4px の1値（個別上書きが残っていない）
- [ ] バッジ・カレンダーの帯・チェックボックスの箱は 2px のまま
- [ ] 参照画像2枚との重大な visual 差異がない
- [ ] 参照画像から逸脱した箇所を PR 説明に列挙した
