import type { ReactElement, ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

/**
 * Consistent page header with title, optional description, and action buttons.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps): ReactElement {
  return (
    <div className="page-header">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="btn-group">{actions}</div>}
      </div>
    </div>
  );
}

type SectionHeaderProps = {
  title: string;
  actions?: ReactNode;
};

/**
 * Section header for sub-sections within a page.
 */
export function SectionHeader({ title, actions }: SectionHeaderProps): ReactElement {
  return (
    <div className="section-header">
      <div className="flex justify-between items-center gap-4">
        <h2>{title}</h2>
        {actions && <div className="btn-group">{actions}</div>}
      </div>
    </div>
  );
}
