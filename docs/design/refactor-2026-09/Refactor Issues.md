# Issue 草案（3本）

同じ動機からの3本。A → B の順で進め、C は独立に進められる。1 Issue = 1 PR。

共通の背景：`space-between` の行に「縮む文字」と「縮まないボタン」を並べる形が全画面に散っているが、伸縮の規約（`min-width: 0` / `flex-shrink: 0` / `white-space: nowrap`）は各 module.css が個別に書き足している。書き忘れると、狭い幅でボタンのラベルが縦に折り返す。実例：マイページの Passkey 行（`PasskeySection.module.css` の `.item` に伸縮の指定がなく、端末名が長いと「削除」が2行になる）。

---

## A. ボタンのラベルは折り返さない（共通化）

### 背景

`Button.module.css` の `.button` は `white-space: nowrap` を持たない。そのため折り返してほしくない箇所ごとに `stablePendingButton { white-space: nowrap }` などを個別に付けて回っており、付け忘れた場所（`DeletePasskeyForm`）で実際に折り返しが起きている。`white-space` は継承するプロパティなので、`.button` に1回宣言すれば内側のラベル span まで効く。

### 変更

- `src/ui/Button.module.css` の `.button` に `white-space: nowrap` を追加する。
- 以下の重複宣言を削除する（`stablePendingLabel { display: grid }` と `stablePendingSizing` は幅を固定する別目的なので残す）。
  - `src/app/catalog/_components/EventWriteForm.module.css`
    - `.stablePendingButton` / `.stablePendingLabel > span` の `white-space`
    - `.dangerActions > form > button` / `.sheetLifecycleActions > form > button` の `white-space`
  - `src/app/schedule/_components/ScheduleWriteForm.module.css` の同2箇所
  - `src/app/schedule/_components/ScheduleDetail.module.css` の同2箇所
  - `src/app/catalog/_components/InvitationCard.module.css` の同2箇所
  - `src/app/catalog/_components/InviteSheet.module.css` の同2箇所
  - `src/app/schedule/_components/ShareAddSheet.module.css` の同2箇所

`Badge` / カレンダーの省略表示（`truncatedLine`・`weekOverflowLabel`）/ ホームの「すべて見る ›」の `nowrap` は Button を通らない、あるいは省略表示のための別目的なので対象外。

### 受け入れ条件

- Passkey の行で端末名が長くても「削除」が1行のままである。
- 上記の重複宣言が残っていない。
- 見た目の差分は「狭い幅で折り返す代わりに溢れる」だけで、通常幅の描画は変わらない。

---

## B. 「テキスト＋操作」の行を共有クラスにする

### 背景

行の形（罫・余白・chevron）は `MySelectedDayList.module.css` を `composes` で借りる形で既に共有されているが、借りているのは見た目だけで、伸縮の規約は各ファイルが自分で書いている。結果 `min-width: 0` と `flex-shrink: 0` が10ファイル前後に散在し、書き忘れが A の不具合を生んだ。

### 変更

- `src/ui/row.module.css` を追加する。

```css
.row   { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.main  { flex: 1 1 auto; min-width: 0; }
.aside { flex: 0 0 auto; }
```

- 既存の行をこれに `composes` で寄せ、各ファイルの `min-width: 0` / `flex-shrink: 0` の直書きを削除する。対象（`aside` 側 / `main` 側）：
  - `PasskeySection.module.css` — `.item`（規約が無い＝A の原因箇所）
  - `OccurrenceParticipationRow.module.css` — `.row` / `.statusText` / `.actions`（同じ抜け方。今は文言が短いので表面化していない）
  - `ScheduleDetail.module.css` — `.recipientRow` / `.recipientIdentity` / `.recipientStatus` / `.removeForm` / `.titleRow`
  - `EventDetail.module.css` — `.titleRow` / `.editLink` / `.occurrenceHeading` / `.occurrenceCount`
  - `InvitationList.module.css` — `.headingRow` / `.pendingCount`
  - `CatalogView.module.css` — `.headingRow` / `.summaryRow` / `.summaryClear`
  - `ScheduleAndEventSection.module.css` — `.label`
  - `MySelectedDayList.module.css` と、それを借りている `SelectedDayList` / `EventLevelFallbackList` / `HomeUpcomingList` — `.itemBody` / `.chevron`
  - `TicketOpportunityRow.module.css` — `.body` / `.chevron` / `.dateColumn`
  - `EventWriteForm.module.css` — `.occurrenceRow` / `.occurrenceSummary` / `.sectionHeading` / `.sectionAction`
- `docs/ux-ui.md` の shared UI pattern 節に規約を追記する：`space-between` の行は `row.module.css` を composes し、縮む側に `main`、縮まない側に `aside` を付ける。
- 任意：`FilterSheet.test.ts` 等と同じやり方で「`justify-content: space-between` を自前で宣言する行クラスが無いこと」を確かめる単体テストを足す。

### 受け入れ条件

- 全画面で見た目が変わらない（375px と 320px の両方で確認する）。
- 各 module.css に伸縮のための `min-width: 0` / `flex-shrink: 0` の直書きが残っていない（`Button` の `.icon` の `min-width: 40px` はタップ領域の寸法なので対象外）。
- `docs/ux-ui.md` に規約が載っている。

---

## C. 長いボタン文言を短くする

### 背景

見出しが対象を名乗っているのにボタンも対象を繰り返しているため、文言が長い。削除の確認シートは既に「見出し＝このイベントを削除／ボタン＝削除」の形になっており、他がそれに揃っていない。2分割で並ぶ中止・削除の行は、320px では1つあたり約144pxしかなく、最長の「この公演回の中止を解除」が収まらない。

### 方針

見出しが対象を示している場所では、ボタンは動詞だけにする。

| 画面・面 | 現在 | 変更後 |
| --- | --- | --- |
| イベント編集「中止と削除」 | このイベントを中止 | 中止する |
| イベント編集「中止と削除」 | このイベントの中止を解除 | 中止を解除 |
| イベント編集「中止と削除」 | このイベントを削除 | 削除する |
| 公演回シート | この公演回を中止 | 中止する |
| 公演回シート | この公演回の中止を解除 | 中止を解除 |
| 公演回シート | この公演回を削除 | 削除する |
| 公演回シート | この公演回を保存 | 保存 |
| 開催期間シート | 開催期間を保存 | 保存 |
| 公演回を追加シート | 公演回を追加 | 追加 |
| 共有相手を追加シート | 共有相手を追加 | 追加 |
| イベント編集「イベント情報」 | イベント情報を保存 | 保存 |
| サインイン | サインインリンクをリクエスト | リンクをリクエスト |

変更しないもの：「予定を作成」（画面に他のボタンがなく、見出しは「予定を追加」）、「Passkeyでサインイン」「Passkeyを登録」「招待する」「参加する」「参加しない」「閉じる」「この条件で絞り込む」「条件をクリア」「サインアウト」。

サインインは「送る」にしない。実際に送信されたかを名乗らない、という現在の文言の意図（`requestSignInLink` の受領文と対）を壊さないため。

### 変更

- 対象コンポーネントの表示文言と、幅固定用の `stablePendingSizing` に入れている最長ラベルを合わせて更新する。
- 文言を検証している単体テストを更新する。
- 読み上げ用の代替テキスト（`aria-label` に対象名を入れている `DeletePasskeyForm` など）は短くしない。見出しを読めない利用者にとっては対象名が唯一の手がかりのため。

### 受け入れ条件

- 320px で中止・削除の2分割ボタンが溢れない。
- 見出しとボタンで同じ語を繰り返している箇所が無い。
- 成功時の読み上げ文言（「イベント情報を保存しました。」等）は変更しない。
