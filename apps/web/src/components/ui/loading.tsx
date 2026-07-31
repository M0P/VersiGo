import type { ReactElement } from 'react';

type LoadingProps = {
  label?: string;
};

/**
 * Loading spinner with optional text.
 */
export function Loading({ label = 'Lade...' }: LoadingProps): ReactElement {
  return (
    <div className="loading-page" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * An inline spinner for buttons or small spaces.
 */
export function InlineSpinner(): ReactElement {
  return <span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden="true" />;
}
