import styles from './RequirementIndicator.module.css';

export interface RequirementIndicatorProps {
  required: boolean;
}

/**
 * Required-field marker for a form label or field-group heading (Issue
 * #128, PO decision 2026-08-26): a red "*" immediately after the label
 * text. Optional fields render nothing - the absence of "*" is read as
 * optional, the same convention as most web forms. `aria-hidden` because
 * this is a decorative echo of the native `required` attribute, which is
 * what actually carries "required" to assistive technology; it must not
 * be the only place requiredness is expressed.
 */
export function RequirementIndicator({ required }: RequirementIndicatorProps) {
  if (!required) return null;
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  );
}
