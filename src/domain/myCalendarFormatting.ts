import type { ParticipationStatus } from './participation.ts';
import type { TicketDisplayStatus } from './myCalendar.ts';

// Pure display formatting for My Calendar (Issue #34).

/** Mirrors src/app/catalog/_components/ParticipationPanel.tsx's own
 * participation labels ("参加する" / "気になる") so the same status reads
 * identically everywhere in the product. */
export function participationStatusLabel(status: ParticipationStatus): string {
  return status === 'attending' ? '参加する' : '気になる';
}

/**
 * Ticket state label, always paired with a distinct Badge variant by the
 * caller (never color/variant alone - Issue #34 acceptance: "ticket
 * pending/unconfirmed状態を色だけに依存せず識別可能"). `'none'` and
 * `'pending'` both read as still-unresolved ("未確定"), the two states the
 * acceptance criterion is about, while remaining textually distinct from
 * each other (a caller who never attempted an acquisition reads
 * differently from one whose attempt is still open).
 */
export function ticketDisplayStatusLabel(status: TicketDisplayStatus): string {
  switch (status) {
    case 'secured':
      return 'チケット確保済み';
    case 'pending':
      return 'チケット申込中（未確定）';
    case 'unsuccessful':
      return 'チケット落選/不成立';
    case 'none':
      return 'チケット未取得（未確定）';
  }
}

export type TicketDisplayBadgeVariant = 'outline' | 'subtle' | 'deadline' | 'terminal';

/**
 * Issue #138: Badge variants are redefined to outline/subtle/deadline/
 * terminal. secured and pending both read as an in-progress state
 * ('subtle'); unsuccessful is a terminal, no-further-action state
 * ('terminal'); none/not-yet-attempted is a classification ('outline').
 */
export function ticketDisplayStatusBadgeVariant(
  status: TicketDisplayStatus,
): TicketDisplayBadgeVariant {
  switch (status) {
    case 'secured':
    case 'pending':
      return 'subtle';
    case 'unsuccessful':
      return 'terminal';
    case 'none':
      return 'outline';
  }
}
