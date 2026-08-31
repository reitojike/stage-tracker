import type { ReactNode } from 'react';
import styles from './SchedulePageHeading.module.css';

/** Local write-screen heading: the TURN 23 rule belongs to these schedule
 * forms, not the shared PageHeading vocabulary. */
export function SchedulePageHeading({ children }: { children: ReactNode }) {
  return <h1 className={styles.heading}>{children}</h1>;
}
