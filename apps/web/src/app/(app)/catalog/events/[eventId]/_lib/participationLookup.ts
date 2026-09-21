import type {
  EventId,
  OccurrenceId,
  Participation,
} from "@stage-tracker/domain";
import type { ParticipationWithOccurrence, ReadState } from "@/lib/data";

/**
 * This event-detail helper preserves the independent read-state boundary
 * originally recorded as historical M6 rationale in `docs/v2/decisions.md`.
 * `listMyParticipations`
 * （`@/lib/data`、caller 全体の参加を横断的に返す）の read 失敗
 * (`unavailable`/`error`) を、occurrence ごとの「参加していない」
 * （= lookup に存在しない）へ**絶対に**潰さない。
 *
 * `ok: false` の場合、呼び出し元 (`page.tsx`) はこの event の全 occurrence
 * について「参加状況を読み込めなかった」ものとして扱う責任を負う
 * event本体の読み込みとは別に扱うため、参加状況の失敗でもevent本体は表示を継続する。
 *
 * `unavailable`/`error` はどちらも `message` を持たない（PR #381 review
 * finding 2 / `@/lib/data`の`ReadState`と同じ方針）。生の PostgREST/network
 * メッセージを screen まで運ばない。表示文言は呼び出し元 (`page.tsx`) が
 * `variant` を見て自分で決める。
 */
export type ParticipationLookup =
  | {
      readonly ok: true;
      readonly byOccurrenceId: ReadonlyMap<OccurrenceId, Participation>;
    }
  | {
      readonly ok: false;
      readonly variant: "unavailable" | "error";
    };

export function buildParticipationLookup(
  state: ReadState<readonly ParticipationWithOccurrence[]>,
  eventId: EventId,
): ParticipationLookup {
  if (state.variant === "unavailable" || state.variant === "error") {
    return { ok: false, variant: state.variant };
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
