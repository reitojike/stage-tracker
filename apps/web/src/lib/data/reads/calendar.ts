/**
 * `/calendar` が必要とする read（`docs/v2/oracle-routes-ui.md` §1 の
 * `主要 data fetch` 列: `occurrence_participations`／
 * `personal_schedule_entries`／`event_occurrences`・`events`）。
 *
 * `/` home と同じ2つの read（`listMyParticipations`/
 * `listVisiblePersonalSchedule`）を、月表示グリッドの範囲全体に対して
 * 呼ぶ。範囲絞り込みは screen 層が `@stage-tracker/domain` の
 * `compareInstants`/`compareTokyoCalendarDates` で行う設計にした
 * （`./participations.ts`/`./personalSchedule.ts` のコメント参照 - SQL側に
 * 複雑な範囲フィルタを持ち込まない技術判断）。`event_occurrences`/
 * `events` は `listMyParticipations` が embed 済みのため、別読み込みは
 * 不要（oracle の「ID 指定で解決」という表現は、この embed 方式でも
 * 満たされる - embed も内部的には ID を辿った解決である）。
 *
 * 画面自体（月グリッド組版、選択日リストの StatePanel 分岐）はこの
 * Task の scope 外（`apps/web/src/app/**` は後続 Task）。
 */
export { listMyParticipations } from "./participations";
export { listVisiblePersonalSchedule } from "./personalSchedule";
