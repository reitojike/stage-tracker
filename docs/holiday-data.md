# 日本の祝日データ（My Calendar）

このdocumentは、stage-trackerの日本の祝日データがどこから来て、どのように
更新されるかを記録するdurable recordです（Issue #34 Acceptance Criteria:
「holiday update procedureがdurableに記録される」）。このデータが供給する
normativeな*rule*（Saturday blue / Sunday red / holiday red、holidayが
Saturdayより優先されること、色に加えてnon-color cueを併用すること）は
`docs/ux-ui.md`の「Calendar weekday / Japanese holiday presentation」
節が正本であり、本documentはデータ自体のみを扱います。

## 正本

**唯一の**canonical sourceは、内閣府「国民の祝日について」データセットです。

- CSV: <https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv>
- 掲載元: <https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html>

未公表の将来の祝日は、ruleからの推測・計算（春分・秋分の計算、「第N月曜」等）
を一切行いません。runtime lookup自体がこれをどう担保しているかは
`src/domain/japaneseHolidays.ts`のheaderを参照してください。

## データがrepoに入る仕組み

`scripts/update-japanese-holidays.mjs`が上記CSVを取得し、デコード
（Shift_JIS）・parseした上で、`src/domain/japaneseHolidaysData.ts`
（日付と祝日名のみを持つ、手編集しないplainなgenerated data file）を
再生成します。generated fileは自身のfetch timestampと、そのsnapshotが
実際に持っていた正確なcoverage range
（`JAPANESE_HOLIDAY_DATA_COVERAGE_START` / `_END`）を記録するため、
読み手はどれだけ最新かを推測する必要がありません。

`src/domain/japaneseHolidays.ts`はそのsnapshotに対するruntime lookupで
あり、network accessを一切持たないpureなdomain logicです。

## 更新手順

1. repo rootから次を実行します。

   ```sh
   npm run holidays:update
   ```

2. `src/domain/japaneseHolidaysData.ts`のdiff（特に新しいcoverage end
   date）を確認し、通常のsource changeとしてcommitします。この
   repositoryのReview Protocolに沿った独立したreviewを受けます
   （Executable artifact - `.ts` source）。
3. 新しく公表された年をrepositoryへ取り込みたいタイミングで、手順1を
   再実行します。内閣府は将来年の公表スケジュールを固定していないため、
   これはmanual・as-needed operationです。このTaskはscheduled/cron job
   を新設するものではありません。

## Coverage / 鮮度

snapshotが記録するcoverage range外の日付は、その区別を必要とするいかなる
箇所からも「祝日ではないことが確認済み」とは扱われません。詳細は
`src/domain/japaneseHolidays.ts`の`isWithinJapaneseHolidayDataCoverage`を
参照してください。My Calendar / Event Catalogの通常のcalendar renderingは
この区別に実際にbranchします。`src/domain/calendarDayRole.ts`の
`calendarDayRole`はcoverage外の日付について`'holiday'`を一切報告しません
（そのため確定した平日として黙って表示されることはありません）。

この内部区別のuser向け presentationはmonth-level notice onlyです（Issue
#97 PO adjudication。Issue #34で採用したper-cell marker/ARIA部分を明示的に
上書き）。表示中の月にcoverage外の日付が1件でも含まれる場合、
`src/app/calendar/_components/MyMonthCalendar.tsx`と
`src/app/catalog/_components/MonthCalendar.tsx`はいずれもnon-colorな
text noticeを月全体に1つだけ表示します。個々のcellへ`?`等のmarkerや、
day単位のaria-labelへの「祝日未確認」追加は行いません -
coverage外であること自体はdomain layer（`isWithinJapaneseHolidayDataCoverage`）
で厳密に保持されたままですが、day-level markerほど高いvisual priorityでは
扱いません。
