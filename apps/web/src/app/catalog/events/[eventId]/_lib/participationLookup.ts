import type {
  EventId,
  OccurrenceId,
  Participation,
} from "@stage-tracker/domain";
import type { ParticipationWithOccurrence, ReadState } from "@/lib/data";

/**
 * `docs/v2/decisions.md`「M6が負う責任: StatePanelの3状態を正しく分類する
 * こと」を、このイベント詳細画面専用に体現する。`listMyParticipations`
 * （`@/lib/data`、caller 全体の参加を横断的に返す）の read 失敗
 * (`unavailable`/`error`) を、occurrence ごとの「参加していない」
 * （= lookup に存在しない）へ**絶対に**潰さない。
 *
 * `ok: false` の場合、呼び出し元 (`page.tsx`) はこの event の全 occurrence
 * について「参加状況を読み込めなかった」ものとして扱う責任を負う
 * （event 本体は表示継続 - oracle-routes-ui.md §2 イベント詳細の
 * 「participation の個別読込失敗は event 本体とは別枠で表示」）。
 */
export type ParticipationLookup =
  | {
      readonly ok: true;
      readonly byOccurrenceId: ReadonlyMap<OccurrenceId, Participation>;
    }
  | {
      readonly ok: false;
      readonly variant: "unavailable" | "error";
      readonly message: string;
    };

export function buildParticipationLookup(
  state: ReadState<readonly ParticipationWithOccurrence[]>,
  eventId: EventId,
): ParticipationLookup {
  if (state.variant === "unavailable" || state.variant === "error") {
    return { ok: false, variant: state.variant, message: state.message };
  }

  const rows = state.variant === "populated" ? state.data : [];
  const byOccurrenceId = new Map<OccurrenceId, Participation>();
  for (const row of rows) {
    if (row.event.id === eventId) {
      byOccurrenceId.set(row.occurrence.id, row.participation);
    }
  }
  return { ok: true, byOccurrenceId };
}
