import type { ReactElement, ReactNode } from 'react';

type EmptyStateProps = {
  icon?: string;
  title?: string;
  children?: ReactNode;
};

/**
 * Empty state placeholder for lists or sections with no data.
 */
export function EmptyState({ icon, title, children }: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
      {title && <div className="empty-state-title">{title}</div>}
      {children && <div className="empty-state-text">{children}</div>}
    </div>
  );
}
