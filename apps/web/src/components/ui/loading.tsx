'use client';

import type { ReactElement } from 'react';
import { useI18n } from '../../i18n';

type LoadingProps = {
  label?: string;
};

/**
 * Loading spinner with optional text.
 * Without an explicit label the translated default ("Loading...") is used.
 */
export function Loading({ label }: LoadingProps): ReactElement {
  const { t } = useI18n();
  const text = label ?? t('common.loading');

  return (
    <div className="loading-page" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/**
 * An inline spinner for buttons or small spaces.
 */
export function InlineSpinner(): ReactElement {
  return <span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden="true" />;
}
