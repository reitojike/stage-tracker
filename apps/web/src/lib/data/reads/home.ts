/**
 * `/` home が必要とする read（`docs/v2/oracle-routes-ui.md` §1 の
 * `主要 data fetch` 列）。
 *
 * home 画面は「申し込み期限」と「直近の予定」の2ブロックを**完全に
 * 独立**した data fetch/表示状態として扱う（`docs/v2/decisions.md` P4
 * 「read ごとに独立して劣化」、`docs/v2/oracle-routes-ui.md` §2「ホーム」）。
 * この read boundary の設計はまさにその独立性を反映していて、個々の
 * read 自体は `/calendar`/`/tickets` と共有する（同じテーブル・同じ
 * visibility scope のため画面固有の別実装を持たない）。
 *
 * - 「申し込み期限」ブロック: `listTicketOpportunities` +
 *   `listMyTicketOpportunityStates`（`./tickets.ts`）。screen 側で
 *   `buildTicketOpportunityAggregates` を経由し、`@stage-tracker/domain`
 *   の `buildTicketOpportunityTimelineRows`/`selectTicketOpportunityPrimaryRows`
 *   で「これから来る期限」だけへ絞り込む（絞り込みに要る「今」は
 *   screen 層が渡す - `packages/domain` は clock-free、
 *   `docs/v2/decisions.md` A6）。
 * - 「直近の予定」ブロック: `listMyParticipations`（`./participations.ts`）
 *   + `listVisiblePersonalSchedule`（`./personalSchedule.ts`）。
 *
 * 画面自体（StatePanel への variant 分岐、2ブロックの組版）はこの Task の
 * scope 外（`apps/web/src/app/**` は後続 Task）。ここでは re-export に
 * とどめ、実装を重複させない。
 */
export {
  buildTicketOpportunityAggregates,
  listMyTicketOpportunityStates,
  listTicketOpportunities,
} from "./tickets";
export { listMyParticipations } from "./participations";
export { listVisiblePersonalSchedule } from "./personalSchedule";
