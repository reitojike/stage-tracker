import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * `docs/v2/oracle-routes-ui.md` §3 の `TextInput`/`TextArea`
 * （「ラベル付き入力（ペア設計）」「フィールド直下に `role="alert"` 表示、
 * `aria-invalid`/`aria-describedby` 自動配線」）に相当する最小の
 * feature-local 実装。
 *
 * `packages/ui` にはまだこの粒度のフォーム入力 primitive が無く、この
 * タスクは `packages/ui` を編集できない（許可された編集範囲は
 * `apps/web/src/app/schedule/` / `apps/web/src/lib/actions/` /
 * 必要なら `packages/domain/src/` のみ）ため、feature-local な最小実装を
 * ここに置く。汎用 primitive 化は2つ目の consumer が現れた時点で
 * `packages/ui` へ抽出する価値がある（decisions.md の `packages/ui`
 * 抽出方針と同じ判断軸）。
 */

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean | undefined;
  readonly error?: string | undefined;
  readonly helperText?: string | undefined;
  readonly children: ReactNode;
}

function FieldShell({
  id,
  label,
  required,
  error,
  helperText,
  children,
}: FieldShellProps) {
  const helperId = `${id}-helper`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {helperText ? (
        <p id={helperId} className="text-body-sm text-muted-foreground">
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-body-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BaseInputProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly required?: boolean | undefined;
  readonly error?: string | undefined;
  readonly helperText?: string | undefined;
  readonly defaultValue?: string | undefined;
};

export function TextField(
  props: BaseInputProps & {
    readonly type?: "text" | "date" | "datetime-local" | "email";
  },
) {
  const {
    id,
    name,
    label,
    required,
    error,
    helperText,
    defaultValue,
    type = "text",
  } = props;
  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      error={error}
      helperText={helperText}
    >
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "h-9 rounded-control border border-input bg-background px-2 text-body",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error ? "border-destructive" : null,
        )}
      />
    </FieldShell>
  );
}

export function TextAreaField(props: BaseInputProps) {
  const { id, name, label, required, error, helperText, defaultValue } = props;
  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      error={error}
      helperText={helperText}
    >
      <textarea
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "rounded-control border border-input bg-background px-2 py-1.5 text-body",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error ? "border-destructive" : null,
        )}
      />
    </FieldShell>
  );
}

interface CheckboxFieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly helperText?: string | undefined;
  readonly defaultChecked?: boolean | undefined;
}

export function CheckboxField({
  id,
  name,
  label,
  helperText,
  defaultChecked,
}: CheckboxFieldProps) {
  const helperId = `${id}-helper`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-describedby={helperText ? helperId : undefined}
          className="size-[var(--size-checkbox-box)] rounded-badge border border-input"
        />
        <label htmlFor={id} className="text-body-sm text-foreground">
          {label}
        </label>
      </div>
      {helperText ? (
        <p id={helperId} className="text-body-sm text-muted-foreground">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
