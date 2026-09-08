/**
 * read boundary（M6a）の barrel export。
 *
 * `docs/v2/decisions.md`「M6 が負う責任: StatePanel の 3 状態を正しく
 * 分類すること」を実装する層。すべての read が `ReadResult`（`Result`）を
 * 返し、権限起因の失敗を空の成功へ潰さない。詳細は各ファイルの docstring
 * を参照。
 */
export * from "./read-error";
export * from "./read-result";
export * from "./supabase-select";
export * from "./row-mapping";

export * from "./mappers/eventRow";
export * from "./mappers/participationRow";
export * from "./mappers/scheduleEntryRow";
export * from "./mappers/ticketRow";
export * from "./mappers/classificationRow";

export * from "./reads/participations";
export * from "./reads/personalSchedule";
export * from "./reads/catalog";
export * from "./reads/tickets";
