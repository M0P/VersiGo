import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// --- Shared form-field wrapper ---

type FormFieldProps = {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
};

/**
 * Groups a form label, input element, error, and hint text into one consistent field.
 * The error state is communicated to the child via aria-invalid on the child itself.
 *
 * Accessibility: The label is associated with the input via htmlFor, and aria-describedby
 * is injected into the child so assistive technologies announce hints/errors.
 *
 * Note: The field accepts exactly one child (a single form control such as
 * Input, Select, or Textarea). The child's own `id` is used when present,
 * otherwise one is derived from the label.
 */
export function FormField({ label, error, hint, required, children }: FormFieldProps): ReactElement {
  // Use the child's own id when present (e.g. "login-identifier"), otherwise
  // derive one from the label. This keeps htmlFor, aria-describedby, and the
  // error/hint element ids consistent for assistive technologies.
  const child = Children.only(children);
  const childId = isValidElement(child) ? (child.props as { id?: string }).id : undefined;
  const fieldId = childId ?? label.replace(/\s+/g, '-').toLowerCase();
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  // Inject accessibility attributes into the single child element
  const enhancedChild = isValidElement(child)
    ? cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: string }>, {
        id: fieldId,
        'aria-describedby': error ? errorId : hint ? hintId : undefined,
        'aria-invalid': error ? 'true' : undefined,
      })
    : child;

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={fieldId}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--versigo-danger)', marginLeft: 2 }}>*</span>}
      </label>
      {enhancedChild}
      {hint && !error && (
        <span className="form-hint" id={hintId}>{hint}</span>
      )}
      {error && (
        <span className="form-error" id={errorId} role="alert">{error}</span>
      )}
    </div>
  );
}

// --- Input ---

type InputProps = {
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>;

/**
 * Styled text input with error state support.
 */
export function Input({ error, className = '', ...props }: InputProps): ReactElement {
  return (
    <input
      className={`form-input ${className}`.trim()}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${(props.id ?? 'input')}-error` : undefined}
      {...props}
    />
  );
}

// --- Select ---

type SelectProps = {
  error?: string;
} & SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Styled select dropdown with error state support.
 */
export function Select({ error, className = '', children, ...props }: SelectProps): ReactElement {
  return (
    <select
      className={`form-select ${className}`.trim()}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    >
      {children}
    </select>
  );
}

// --- Textarea ---

type TextareaProps = {
  error?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Styled textarea with error state support.
 */
export function Textarea({ error, className = '', ...props }: TextareaProps): ReactElement {
  return (
    <textarea
      className={`form-textarea ${className}`.trim()}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
}
