# 15. 日曜・祝日の赤を1値にする

## 背景

同じ画面のなかで日曜の赤が2値ある。

| 場所 | 現在の値 | 参照 |
| --- | --- | --- |
| リストの日付見出し | `#a13b2e`（`--color-danger`） | `src/ui/DayRoleText.tsx` |
| 月カレンダーのセル | `#b3413a`（`--color-calendar-sunday` → `--color-status-danger-500`） | `MonthCalendar.module.css` / `MyMonthCalendar.module.css` |

Issue 5（`05-date-color.md`）でリスト側を `#a13b2e` に決めたとき、カレンダーのセル側は「後続で寄せる」として据え置いた（`DayRoleText.tsx` のコメントに経緯あり）。カレンダーとその下のリストは常に同じ画面に並ぶため、2値の差がそのまま見える。

参照: 17a（直した値で描いてある）、17c

## 変更

`src/ui/tokens.css` のセマンティック層を repin する。

```diff
- --color-calendar-sunday: var(--color-status-danger-500);
- --color-calendar-holiday: var(--color-status-danger-500);
+ --color-calendar-sunday: var(--color-danger);
+ --color-calendar-holiday: var(--color-danger);
```

- primitive の `--color-status-danger-500` は変えない（他の参照元に影響を出さないため）
- カレンダー側の CSS Module は触らない。トークンの値が変わるだけ
- `DayRoleText.tsx` の `ROLE_COLOR` も変えない。すでに `--color-danger` を指している
- あわせて `DayRoleText.tsx` の「Sunday はまだ別値」という説明コメントを、解消済みとして書き換える

これで赤は締切バッジ（`--color-danger` の塗り）・日祝の日付・リストの日付見出しの3か所で同一値になる。土曜（`--color-calendar-saturday` = `--color-accent`）は変更なし。

## 確認

- 17a のカレンダーの 6日・13日と、その下のリストの「9月13日（日）」が同じ赤
- 祝日も同じ赤（祝日は太字600のまま）
- コントラスト: `#a13b2e` は紙 `#eef0f1` に対して 4.5:1 以上（`#b3413a` より濃くなる方向なので後退はしない）
- 締切バッジの塗り（`#a13b2e` ＋ 文字 `#f7f5f1`）は変更なし
