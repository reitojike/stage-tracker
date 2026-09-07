import type { ReactNode } from 'react';
import { RequirementIndicator } from './RequirementIndicator';
import styles from './FormSection.module.css';

export interface FormSectionProps {
  heading: ReactNode;
  /** 'section' (default): unboxed heading + content, organizational
   * grouping only, no fieldset semantics. 'fieldset': a genuine
   * <fieldset>+<legend> a11y grouping for a related set of inputs - still
   * unboxed (no border/padding "box"), grouping is conveyed by typography
   * and semantic HTML only (Issue #128: prototype的なboxed fieldsetを
   * defaultから外すが、意味のあるgroupingのfieldset/legendは維持する). */
  as?: 'section' | 'fieldset';
  /** Shows a RequirementIndicator next to the heading/legend text, for a
   * sub-group whose overall presence is itself required/optional (e.g. the
   * create form's 初回公演回 subgroup, or a temporal-mode choice group). */
  requirement?: 'required' | 'optional';
  /** Supplemental caption rendered under the heading. */
  description?: ReactNode;
  /** Escape hatch for a page-specific heading treatment (e.g. a danger-zone
   * heading color) without teaching this shared primitive about "danger". */
  headingClassName?: string;
  /** Escape hatch for page-specific spacing/layout on the outer
   * section/fieldset itself (e.g. extra margin before a danger zone). */
  className?: string;
  children: ReactNode;
}

export function FormSection({
  heading,
  as = 'section',
  requirement,
  description,
  headingClassName,
  className,
  children,
}: FormSectionProps) {
  const requirementIndicator =
    requirement !== undefined ? (
      <RequirementIndicator required={requirement === 'required'} />
    ) : null;
  const description_ = description ? <p className={styles.description}>{description}</p> : null;
  const body = <div className={styles.body}>{children}</div>;

  if (as === 'fieldset') {
    return (
      <fieldset className={[styles.fieldset, className].filter(Boolean).join(' ')}>
        <legend className={[styles.legend, headingClassName].filter(Boolean).join(' ')}>
          {heading}
          {requirementIndicator}
        </legend>
        {description_}
        {body}
      </fieldset>
    );
  }

  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')}>
      <h2 className={[styles.heading, headingClassName].filter(Boolean).join(' ')}>
        {heading}
        {requirementIndicator}
      </h2>
      {description_}
      {body}
    </section>
  );
}
