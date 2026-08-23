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

export type TicketDisplayBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export function ticketDisplayStatusBadgeVariant(
  status: TicketDisplayStatus,
): TicketDisplayBadgeVariant {
  switch (status) {
    case 'secured':
      return 'success';
    case 'pending':
      return 'warning';
    case 'unsuccessful':
      return 'danger';
    case 'none':
      return 'neutral';
  }
}
