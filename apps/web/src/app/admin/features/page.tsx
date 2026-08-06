import { redirect } from 'next/navigation';

/**
 * BugFix-07 (Q1): Die Feature-Verwaltung ist seit dem Merge in die
 * Systemeinstellungen Teil der /admin/settings-Seite (Feature-Karten oben,
 * Katalog darunter ohne doppelte Schluessel). /admin/features wird daher
 * auf /admin/settings umgeleitet; alte Lesezeichen bleiben gueltig.
 */
export default function AdminFeaturesPage(): never {
  redirect('/admin/settings');
}
