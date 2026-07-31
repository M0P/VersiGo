import type { ReactElement, ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  /** Optional element id – can be referenced via aria-describedby. */
  id?: string;
  children: ReactNode;
};

const variantClass: Record<AlertVariant, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  danger: 'alert-danger',
};

/**
 * Accessible alert/notice component.
 */
export function Alert({ variant = 'info', title, id, children }: AlertProps): ReactElement {
  return (
    <div className={`alert ${variantClass[variant]}`} role="alert" id={id}>
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
