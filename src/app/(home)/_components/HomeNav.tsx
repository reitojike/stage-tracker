import Link from 'next/link';
import { LinkPending } from '@/ui/LinkPending';
import styles from './HomeNav.module.css';

interface HomeDestination {
  href: string;
  label: string;
  description: string;
}

/**
 * Gate A's two primary destinations (#70 "Bounded IA decision"), each with
 * the one sentence that separates them. Labels match the destination's own
 * page heading and PrimaryNav's label; the descriptions are what make the
 * Event Catalog / My Calendar split legible rather than two similar names
 * side by side.
 */
const PRIMARY_DESTINATIONS: readonly HomeDestination[] = [
  {
    href: '/catalog',
    label: 'イベント',
    description: 'みんなで共有している公演カレンダーを見る',
  },
  {
    href: '/calendar',
    label: 'マイカレンダー',
    description: '自分の参加予定と個人の予定をまとめて見る',
  },
];

/**
 * Reachable, but deliberately not a peer of the two above. Personal
 * Schedule is where individual entries are created and shared; My Calendar
 * is where they are read back together with participation. Presenting both
 * as equal top-level choices is exactly what made the two indistinguishable
 * in the #69 walkthrough.
 */
const SECONDARY_DESTINATIONS: readonly HomeDestination[] = [
  {
    href: '/schedule',
    label: '個人の予定',
    description: '休暇・仕事などの個人予定を登録し、共有を管理する',
  },
];

function DestinationLink({
  destination,
  secondary,
}: {
  destination: HomeDestination;
  secondary: boolean;
}) {
  return (
    <Link
      href={destination.href}
      className={[styles.link, secondary ? styles.linkSecondary : ''].filter(Boolean).join(' ')}
    >
      <span className={styles.body}>
        <span className={styles.label}>{destination.label}</span>
        <span className={styles.description}>{destination.description}</span>
      </span>
      <LinkPending label={`${destination.label}へ移動中`} />
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function HomeNav() {
  return (
    <>
      <nav className={styles.section} aria-label="主な機能">
        <ul className={styles.list}>
          {PRIMARY_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <DestinationLink destination={destination} secondary={false} />
            </li>
          ))}
        </ul>
      </nav>

      <nav className={styles.section} aria-label="管理">
        <h2 className={styles.sectionHeading}>管理</h2>
        <ul className={styles.list}>
          {SECONDARY_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <DestinationLink destination={destination} secondary />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
