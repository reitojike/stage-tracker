/**
 * read boundary（M6a）の barrel export。
 *
 * This layer classifies read failures without collapsing them into empty data.
 * すべての read が `ReadResult`（`Result`）を
 * 返し、権限起因の失敗を空の成功へ潰さない。詳細は各ファイルの docstring
 * を参照。
 */
export * from "./read-error";
export * from "./read-result";
export * from "./supabase-select";
export * from "./paged-select";
export * from "./row-mapping";

export * from "./mappers/eventRow";
export * from "./mappers/participationRow";
export * from "./mappers/scheduleEntryRow";
export * from "./mappers/ticketRow";
export * from "./mappers/classificationRow";

export * from "./reads/participations";
export * from "./reads/personalSchedule";
export * from "./reads/scheduleShare";
export * from "./reads/catalog";
export * from "./reads/tickets";
export * from "./reads/notifications";
export * from "./reads/events";
export * from "./reads/invitations";
export * from "./creator-capability";
