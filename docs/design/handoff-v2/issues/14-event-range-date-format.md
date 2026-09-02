# 14. 開催期間の日付表記を他画面と揃える

## 背景

`src/app/catalog/_components/EventLevelFallbackList.tsx` の「開催期間で該当するイベント」が、日付を `{event.startsOn}〜{event.endsOn}` と ISO のまま出している。

```
2026-09-01〜2026-09-30
```

他の画面は日本語の日付表記で、同じ画面（イベント）の選択日見出しが「9月13日（日）」、マイカレンダーの行が「9月11日〜13日」。同じ節の隣に ISO が並んでいる状態。

参照: 17b

## 変更

`src/domain/personalScheduleFormatting.ts` の `scheduleTemporalLabel` が使っている期間表記の考え方に合わせる。開催期間は日付のみ（時刻を持たない）なので、既存関数をそのまま呼ぶのではなく、同じ語彙の整形を `src/domain/catalogFormatting.ts` に1つ追加して `EventLevelFallbackList` から使う。

| 条件 | 表記 |
| --- | --- |
| 同一月 | `9月1日〜30日` |
| 月をまたぐ（同一年） | `9月28日〜10月2日` |
| 年をまたぐ | `2026年12月28日〜2027年1月5日` |
| 単日（startsOn = endsOn） | `9月13日` |

- 曜日は付けない（この節は期間であり、特定の日ではない）
- 「〜」は全角。`-` や `–` は使わない
- 表示している月と同じ年のときは年を省く。年をまたぐ範囲だけ両側に年を付ける

## 確認

- 17b の2行が「9月1日〜30日」「9月10日〜20日」になる
- 単日のイベント範囲で「9月13日〜9月13日」にならない
- 年末年始をまたぐイベントで年が両側に出る
- `EventLevelFallbackList` は My Calendar からも使われている（`classificationByEventId` を渡さない経路）。そちらでも同じ表記になること
