import Link from 'next/link';
import { catalogInvitationsHref } from '@/domain/catalogNavigation.ts';
import styles from './ScheduleAndEventSection.module.css';

export interface ScheduleAndEventSectionProps {
  /** Issue #193: designated catalog creator membership, resolved by
   * ../_lib/creatorCapability.ts the same fail-closed way Catalog's own
   * create affordance already does. false hides the row entirely - no
   * disabled/explained state, per the design handoff's explicit
   * "「カタログ登録者のみ」のような副題は付けない" instruction. */
  canCreateEvent: boolean;
  /** Precomputed by the page (Issue #193): My Page carries no calendar
   * navigation state of its own, unlike Catalog's own ActionRow, so this is
   * derived from "today" rather than from an in-flight month/day. */
  newEventHref: string;
  /** Count of the viewer's own pending (unresolved) received invitations
   * (Issue #230 addendum). The 招待一覧 row itself is always shown - only
   * the count badge is conditional ("pending count = 0: badgeだけ非表示,
   * 招待一覧row自体は消さない"). */
  pendingInvitationCount: number;
}

const PERSONAL_SCHEDULE_HREF = '/schedule';

/**
 * "予定とイベント" (Issue #193 / design_handoff_v2/issues/13-mypage.md,
 * visual reference 12f): the low-frequency management destinations moved
 * off Event Catalog's and My Calendar's own ActionRow, placed above
 * ../_components/AccountSection.tsx. Section-heading rule reuses
 * sectionHeading.module.css (same "太罫見出し" AccountSection/PasskeySection
 * already use); row shape reuses MySelectedDayList's plain-row/hairline/
 * chevron vocabulary (see ScheduleAndEventSection.module.css) - no broad
 * card surface for either.
 */
export function ScheduleAndEventSection({
  canCreateEvent,
  newEventHref,
  pendingInvitationCount,
}: ScheduleAndEventSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="mypage-schedule-event-heading">
      <h2 id="mypage-schedule-event-heading" className={styles.heading}>
        予定とイベント
      </h2>
      <ul className={styles.items}>
        <li className={styles.item}>
          <Link href={PERSONAL_SCHEDULE_HREF} className={styles.itemLink}>
            <span className={styles.label}>個人予定を管理</span>
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
        <li className={styles.item}>
          <Link href={catalogInvitationsHref()} className={styles.itemLink}>
            <span className={styles.label}>招待一覧</span>
            {pendingInvitationCount > 0 ? (
              <span className={styles.countBadge}>{pendingInvitationCount}</span>
            ) : null}
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
        {canCreateEvent ? (
          <li className={styles.item}>
            <Link href={newEventHref} className={styles.itemLink}>
              <span className={styles.label}>イベントを追加</span>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
