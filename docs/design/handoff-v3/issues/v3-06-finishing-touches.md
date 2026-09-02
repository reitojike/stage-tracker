# 06. 仕上げ — 画面をまたぐと気づく不揃い

参照画像：`../reference/finishing-event-edit-390.png` / `finishing-occurrence-lifecycle-390.png` / `finishing-share-sheet-390.png` / `finishing-sign-in-requested-390.png`
デッキ：TURN 31a〜31c
規模：中（4画面・視覚差分は各画面に閉じる）／前提：なし（01〜05 はすべて適用済み）

## 背景

01〜05 がすべて main に入り、実装されている画面はすべて新デザインになりました。
残っているのは **1画面の中では破綻していないが、2画面以上を続けて見ると規則が2つあるように見える**もの
だけです。1件だけバグ（4）が混ざっていますが、直す場所が同じ公演回シートなのでここに含めます。

---

## 1. イベント編集：保存をグループの中へ

参照画像：`../reference/finishing-event-edit-390.png`

いま `EventDetailsEditForm` の送信が `.fixedSubmit`（`position: fixed`）で画面下端に固定されています。
この帯が送るのは「イベント情報」グループだけですが、開催期間・公演回・中止と削除まで
スクロールしても出続けるため、帯が指すものと目の前の内容が食い違います。

- `EventDetailsEditForm` から `.fixedSubmit` / `.fixedForm` を外し、
  送信を **そのグループの末尾に右寄せ**（`display: flex; justify-content: flex-end`）で置く
- ラベルは「イベント情報を保存」のまま
- 他の3グループはすでにシートの footer で保存しているので、これで
  「保存は、いま見ているまとまりの中にある」が全グループで揃う

**登録画面（`EventCreateForm`）の固定帯は残します。** 画面全体で1つの送信だからです。
`.fixedSubmit` は「画面に送信が1つのときだけ使う」という位置づけになります。

## 2. イベント編集：公演回行の中止 badge を日時の左へ

参照画像：`../reference/finishing-event-edit-390.png`（2行目の公演回）

編集画面の `.occurrenceSummary` では中止 badge が日時と開場の**下**（3行目）にあります。
詳細画面は Issue #245 で日時の**左**に揃えたばかりなので、2画面で扱いが分かれています。

- badge を `.occurrenceDateTime` と同じ行の左へ（`display: flex` / `gap: 6px` / `align-items: flex-start` / badge は `flex-shrink: 0`）
- 日時が折り返しても badge は先頭行に残す
- 日時の赤（`.occurrenceCanceled`）はそのまま

## 3. 共有相手を追加：シートの形を1つに

参照画像：`../reference/finishing-share-sheet-390.png`

1件を入力するシートが2つの形を持っています。公演回・開催期間・公演回を追加は
footer に確定＋ヘッダに閉じるなし、共有相手を追加だけが footer なし＋閉じるあり。

- `ShareAddSheet` に `showCloseButton={false}` と `footer` を渡し、
  「共有相手を追加」を footer の塗りボタンにする（`OccurrenceAddForm` と同じ形）
- `ShareAddForm` 側の `.actions`（本文末尾の右寄せ）は削除し、
  送信は `form` 属性で footer のボタンと結ぶ
- 離脱は覆いのタップと Escape

**参加の状態シートは対象外です。** 選んだ時点で保存する footer なしのシートなので、
`RULES.md` §7（footer を持つならヘッダに閉じるを出さない）の反対側に当たります。

## 4. 公演回シート：中止／削除の行が崩れる（バグ）

参照画像：`../reference/finishing-occurrence-lifecycle-390.png`

**再現**：公演回シートで「この公演回を中止」または「中止を解除」を実行する。

**症状**：2つのボタンの並びが崩れ、「この公演回を中止」に灰色の背景が付いたように見える。

**原因**：`.sheetLifecycle` は `display: flex; flex-wrap: wrap` の横1行ですが、
`OccurrenceCancellationForm` は form の中に「`StatePanel` → `WriteNotice` → ボタン」を縦に持ちます。
通知が出ると flex item の幅が通知の長文で決まり、2つのボタンが1行に収まらず折り返します。
灰色はボタンの色ではなく `.notice`（`--color-surface-subtle`・角丸4px）がボタンの上に乗ったものです。

**変更**：通知と状態表示を lifecycle の**行の外**に出し、行にはボタンだけを残す。

- `.sheetLifecycle` を縦積み（`flex-direction: column` / `gap: var(--space-md)`）にし、
  その中に「通知・エラー」→「ボタン2つの横並び行」の順で置く
- ボタン行は `display: flex; gap: var(--space-sm)` で、各ボタンは `flex: 1 1 0`（編集画面の `.dangerActions` と同じ）
- 中止／解除は `secondary`（細枠・墨）、削除は `danger`（細枠・赤）のまま
- 通知の文言（「この公演回を中止にしました」「この公演回の中止を解除しました」）は変えない

## 5. サインイン受付：角丸を4pxへ

参照画像：`../reference/finishing-sign-in-requested-390.png`

`?requested=1` の受付メッセージだけが `Surface variant="subtle"`（`--radius-surface` 12px）です。
角丸12pxはここが最後の利用者で、`RULES.md` の「2px = 小さな箱と印 / 4px = 31〜44px の箱」に載っていません。

- `Surface` をやめ、`page.module.css` に淡い面のブロックを持たせる
  （`background: var(--color-surface-subtle)` / `border-radius: var(--radius-control)` / `padding: var(--space-card-block)`）
- **文言は一字も変えない**（アカウントの有無を示唆しない現在の言い回しがそのまま正）
- 面そのものは残す。1回だけ出る受付の控えなので、本文と地続きにすると読み飛ばされる

これで `Surface` の利用者は0になります。**コンポーネント自体の削除は別 Issue**にしてください
（`Surface.stories.tsx` とテストが付いているため）。

---

## Acceptance Criteria

### 1. イベント編集の保存

- [ ] イベント編集画面に `position: fixed` の送信帯が存在しない
- [ ] 「イベント情報を保存」が「イベント情報」グループの末尾に右寄せで表示される
- [ ] 開催期間・公演回・中止と削除までスクロールしても、画面に固定された送信ボタンが出ない
- [ ] イベント**登録**画面の下部固定帯は従来どおり残っている
- [ ] ラベルは「イベント情報を保存」のまま変わっていない

### 2. 編集画面の中止 badge

- [ ] 中止の公演回行で、badge が日時と同じ行の左にある
- [ ] 日時が折り返す長さでも badge が先頭行に残る
- [ ] 中止でない行の見た目が変わっていない
- [ ] イベント詳細画面（#245 適用済み）の見た目が変わっていない

### 3. 共有相手を追加シート

- [ ] シートのヘッダに「閉じる」が出ない
- [ ] 「共有相手を追加」が footer にあり、塗りのボタンである
- [ ] 本文末尾に送信ボタンが二重に出ていない
- [ ] 覆いのタップと Escape で閉じられる
- [ ] 送信成功でシートが閉じ、共有相手の行が増えている
- [ ] 参加の状態シートは footer なし・閉じるありのまま変わっていない

### 4. 公演回シートの中止／削除

- [ ] 「この公演回を中止」を実行したあと、2つのボタンが横1行に並んだままである
- [ ] 「この公演回の中止を解除」を実行したあとも同じく崩れない
- [ ] 通知（「この公演回を中止にしました」等）がボタンの**上**に、行とは別のブロックとして出る
- [ ] 通知が出ている状態でボタンの背景色が変わっていない（中止＝細枠、削除＝赤の細枠）
- [ ] エラー時の `StatePanel` も同じ位置に出る
- [ ] 通知の文言が変わっていない

### 5. サインイン受付

- [ ] `?requested=1` の受付メッセージが淡い面＋角丸4px で表示される
- [ ] 文言が1文字も変わっていない
- [ ] `src/app/sign-in/` から `Surface` の import が消えている
- [ ] 通常状態（Passkey / または / Magic Link）の見た目が変わっていない

### 全体

- [ ] 390px で4枚の参照画像との重大な visual 差異がない
- [ ] 既存の server action・RLS・確認ダイアログの挙動を変更していない
- [ ] `src/ui/` の共通パーツを変更していない（この Issue は画面側だけで閉じる）

## 触らないもの

- 通知の置き場所そのものの統一と処理中の語の整理 → Issue 07
- 破壊的操作の確認の作り直し → Issue 07
- 読み込み表現（skeleton / spinner）→ `RULES.md` に規則を書くだけ
- 招待一覧の8秒取り消し行 → 別語彙として `RULES.md` に明記して残す
- `Surface` コンポーネント自体の削除
