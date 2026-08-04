import type { ReactElement } from 'react';

/**
 * Minimal inline SVG icon set for the navigation shell.
 * Icons are decorative (aria-hidden) – links carry accessible labels.
 */
export type IconName =
  | 'home'
  | 'policies'
  | 'costs'
  | 'sharing'
  | 'settings'
  | 'admin'
  | 'users'
  | 'audit'
  | 'monitoring';

const ICON_PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  policies:
    'M6 2h9l5 5v15H6V2Zm9 0v5h5M9 12h7M9 16h7',
  costs:
    'M12 2v20M17 6.5c0-2-2-3-5-3s-5 1-5 3 1.5 2.8 5 3.5c3.5.7 5 1.7 5 3.5s-2 3-5 3-5-1-5-3',
  sharing:
    'M4 12v7h16v-7M12 3v13M7 7l5-4 5 4',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.5-3.5c0 .7-.1 1.4-.3 2l2 1.5-2 3.5-2.4-.9c-.9.7-2 1.3-3.3 1.6L14 22h-4l-.5-2.3c-1.3-.3-2.4-.9-3.3-1.6l-2.4.9-2-3.5 2-1.5c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2l-2-1.5 2-3.5 2.4.9c.9-.7 2-1.3 3.3-1.6L10 2h4l.5 2.3c1.3.3 2.4.9 3.3 1.6l2.4-.9 2 3.5-2 1.5c.2.6.3 1.3.3 2Z',
  admin:
    'M12 2l9 4v6c0 5-3.8 9.4-9 10-5.2-.6-9-5-9-10V6l9-4Zm-3 9a3 3 0 1 1 6 0 3 3 0 0 1-6 0Zm-1.5 6a4.5 4.5 0 0 1 9 0',
  users:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 1 0 0 7.75',
  // Audit-Log: Dokument/Liste mit Zeile (Ereignisprotokoll)
  audit:
    'M8 2h8v3H8V2ZM4 5h16v17H4V5Zm4 4v2m8-2v2m-8 5h8M4 9h2m12 0h2',
  // Monitoring: Puls-/EKG-Linie (Betriebsstatus)
  monitoring:
    'M2 12h4l3-7 4 14 3-7h6',
};

type IconProps = {
  name: IconName;
  size?: number;
};

/**
 * Renders a decorative inline SVG icon.
 */
export function Icon({ name, size = 20 }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
