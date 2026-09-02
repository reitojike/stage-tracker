# 6. カード面の撤去

## 背景

白面＋角丸12pxのカードが3か所だけ残っていて、他の画面（紙＋細罫）と作りが違う。

参照: 12a（申し込み期限）、12b（カレンダー）、12d（カレンダー）

## 変更

### `src/app/(home)/_components/HomeDeadlineList.module.css`

- カードの `background` `#dfe4e7` と `border-radius` 12px を外す
- 幅 158px → **150px**。列と列の間は `gap` ではなく **左の細罫 `1px solid #d7dcde`**（先頭列には付けない）で切る
- 横スクロールは維持。3列目が右端で見切れることでスクロールを示唆する（コンテナに `margin-inline-end: -16px`）

### `src/app/catalog/_components/MonthCalendar.module.css` / `src/app/calendar/_components/MyMonthCalendar.module.css`

- 白面 `background: #ffffff`、`border-radius: 12px`、`padding: 8px` を外す
- 週の区切りの `border-top: 1px solid #d7dcde` はそのまま
- セル・帯・dot の寸法は変えない。ただしセルの選択枠の角丸は 8px → **4px**、帯の角丸は 5px → **2px**

これで `--radius-surface` の参照が無くなる（#1 で削除）。

## 確認

- 3画面とも紙 `#eef0f1` の上に細罫だけが乗る
- ホームの横スクロールで3列目が見切れる
