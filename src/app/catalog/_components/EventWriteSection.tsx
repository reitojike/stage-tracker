import type { ReactNode } from 'react';
import { RequirementIndicator } from '@/ui/RequirementIndicator';
import styles from './EventWriteForm.module.css';

export interface EventWriteSectionProps {
  heading?: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  requirement?: 'required' | 'optional';
  danger?: boolean;
  subtle?: boolean;
  children: ReactNode;
}

/** Screen-local form grouping for the Event write routes. It intentionally
 * owns TURN 23's heading rule / optional surface vocabulary instead of
 * changing FormSection for unrelated consumers. */
export function EventWriteSection({
  heading,
  action,
  description,
  requirement,
  danger = false,
  subtle = false,
  children,
}: EventWriteSectionProps) {
  return (
    <section
      className={[
        styles.writeSection,
        subtle ? styles.subtleSection : undefined,
        danger ? styles.dangerSection : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {heading ? (
        <div
          className={[styles.sectionHeading, danger ? styles.dangerHeading : undefined]
            .filter(Boolean)
            .join(' ')}
        >
          <h2>
            {heading}
            {requirement !== undefined ? (
              <RequirementIndicator required={requirement === 'required'} />
            ) : null}
          </h2>
          {action ? <div className={styles.sectionAction}>{action}</div> : null}
        </div>
      ) : (
        <div className={styles.sectionRule} />
      )}
      {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
