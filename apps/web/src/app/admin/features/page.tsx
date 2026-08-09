import { redirect } from 'next/navigation';

/**
 * BugFix-07 (Q1): since the merge into the system settings, feature
 * management is part of the /admin/settings page (feature cards on top,
 * catalog below without duplicate keys). /admin/features is therefore
 * redirected to /admin/settings; old bookmarks stay valid.
 */
export default function AdminFeaturesPage(): never {
  redirect('/admin/settings');
}
