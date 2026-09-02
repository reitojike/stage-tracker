# カレンダーの marker 規則を統一する

**labels**: calendar
**depends on**: #1 tokens

## 背景

現状は 祝グリフ・件数Badge・複数種のmarkerが混在し、1セルの情報量が読み切れない。形（帯 / 丸）と塗り（塗り / 輪郭）の2軸に整理する。

## やること

`MonthCalendar` / `MyMonthCalendar` 共通の規則にする。

- **複数日にまたがるものは帯、単日は dot。** イベントと個人予定で同じ規則
- **dot は1セル1個。** 決まっているイベント or blocking の予定があれば塗り（`--color-accent`）、検討中 or non-blocking のみなら輪郭（1.5px）
- **帯**は blocking = `--color-band-fill` の面 + `--color-band-text` の文字、non-blocking = 1px `--color-band-outline` の輪郭。高さは 10px / `line-height: 1.6`
- 帯の先頭にカテゴリの短縮ラベル（紙色で抜く、`padding: 0 3px`, 600）。複数カテゴリは並べ、3つ以上は `+N`
- **件数Badgeは廃止。** 件数は出さない
- **1セルの marker は最大3**（dot 1個 + 帯 2本）。溢れる分は表示しない
- **「今日」** = 日付数字にグレーの塗り丸
- **「選択中」** = セル全体を枠で囲う（`box-shadow: inset 0 0 0 1.5px --color-text`, radius 8px）。日付の丸ではない。「今日」と併存できる
- **祝日** = 日付を 600 + `--color-danger`。`祝` グリフは廃止（祝日名は選択日リスト側に出す）
- 日付セルは `min-height: 44px`、週ごとに 1px `--color-border`

## 完了条件

- 「今日」「選択中」「祝日」が同じセルに重なっても判別できる
- 色を落として（グレースケールで）見ても、決まっている/検討中、blocking/non-blocking が形で区別できる
