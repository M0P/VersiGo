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
  | 'monitoring'
  // BugFix-21: document types in the document list.
  | 'filePdf'
  | 'fileImage'
  | 'fileDocument'
  | 'fileSpreadsheet'
  | 'fileGeneric'
  // BugFix-22: origin of a Paperless assignment + insured subject kind.
  | 'linkTag'
  | 'linkManual'
  | 'linkBoth'
  | 'subjectPerson'
  | 'subjectObject';

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
  // BugFix-21: Dokumenttypen (Blatt mit umgeknickter Ecke + Typ-Merkmal)
  fileGeneric: 'M6 2h8l4 4v16H6V2Zm8 0v4h4',
  fileDocument: 'M6 2h8l4 4v16H6V2Zm8 0v4h4M9 12h6M9 15h6M9 18h4',
  fileSpreadsheet: 'M6 2h8l4 4v16H6V2Zm8 0v4h4M8.5 13h7M8.5 17h7M12 11v10',
  fileImage:
    'M6 2h8l4 4v16H6V2Zm8 0v4h4M8.6 17.2l2.4-3.2 2 2.5 1.1-1.2 1.5 1.9H8.6ZM14.4 13.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z',
  filePdf: 'M6 2h8l4 4v16H6V2Zm8 0v4h4M10 18.5v-5h1.5a1.5 1.5 0 0 1 0 3H10',
  // Monitoring: Puls-/EKG-Linie (Betriebsstatus)
  monitoring:
    'M2 12h4l3-7 4 14 3-7h6',
  // BugFix-22: Herkunft einer Paperless-Zuordnung (Tag / manuelle Verknüpfung)
  linkTag: 'M3 12 11.5 3.5H20v8.5L11.5 20 3 12Zm12.2-4.7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z',
  linkManual:
    'M9.5 14.5 14.5 9.5M8.5 7.5H7a4.5 4.5 0 0 0 0 9h1.5M15.5 7.5H17a4.5 4.5 0 0 1 0 9h-1.5',
  linkBoth:
    'M3 11.5 11 3.5h7.5V11L10.5 19 3 11.5Zm11-4.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12.5 21h-1a2.7 2.7 0 0 1 0-5.4h1M19 21h1a2.7 2.7 0 0 0 0-5.4h-1M13 18.3h5',
  // BugFix-22: versichertes Subjekt – Person oder Objekt (z. B. Kfz, Haus)
  subjectPerson:
    'M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM4.5 21c0-3.3 3.4-5.5 7.5-5.5s7.5 2.2 7.5 5.5',
  subjectObject: 'M3.5 21V9.5L12 3l8.5 6.5V21M9 21v-6h6v6',
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
