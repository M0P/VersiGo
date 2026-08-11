'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select, Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { Dialog } from '../../../components/ui/dialog';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { useI18n } from '../../../i18n';
import type { MessagePath, Messages } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type UserStatus = 'ACTIVE' | 'DISABLED' | 'PENDING_APPROVAL';
type GlobalRole = 'READ_ONLY' | 'USER' | 'ADMIN';

type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  status: UserStatus;
  email: string | null;
  hasCredential: boolean;
  oidcIssuer: string | null;
  oidcSubject: string | null;
  createdAt: string;
};

type ListResponse = {
  users: AdminUser[];
  total: number;
};

const STATUS_LABEL: Record<UserStatus, MessagePath<Messages>> = {
  ACTIVE: 'admin.users.active',
  DISABLED: 'admin.users.disabled',
  PENDING_APPROVAL: 'admin.users.pendingApproval',
};

/**
 * AP-16: admin user management. List, approval, rejection, suspension,
 * unsuspension and role assignment. Dangerous actions (rejection,
 * suspension, demotion) require confirmation. The last active
 * admin can neither be suspended nor demoted (enforced server-side;
 * the UI shows the API's error message).
 */
export default function AdminUsersPage(): ReactElement {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, GlobalRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // BugFix-16: admin password reset (POST /admin/users/:id/reset-password)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    fetch(`${API_BASE}/admin/users${query}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('admin.users.errorLoading'));
        return res.json();
      })
      .then((data: ListResponse | null) => {
        if (data) {
          setUsers(data.users);
          setTotal(data.total);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter, t]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function runAction(action: (id: string) => Promise<Response>, id: string, confirmText?: string): Promise<void> {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await action(id);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.users.actionFailed'));
      }
      loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  const approve = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/approve`, { method: 'POST', credentials: 'include' }), id);
  const reject = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/reject`, { method: 'POST', credentials: 'include' }), id,
      t('admin.users.confirmReject'));
  const disable = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/disable`, { method: 'POST', credentials: 'include' }), id,
      t('admin.users.confirmDisable'));
  const enable = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/enable`, { method: 'POST', credentials: 'include' }), id);

  // BugFix-16: admin password reset. Opens a dialog for the new password,
  // POSTs it and reloads the list. The new password is never logged.
  const openResetDialog = (user: AdminUser) => {
    setResetTarget(user);
    setResetPassword('');
    setResetConfirm('');
    setResetError(null);
    setResetSuccess(null);
  };

  async function submitReset(): Promise<void> {
    if (!resetTarget || !resetPassword) return;
    if (resetPassword !== resetConfirm) {
      setResetError(t('admin.users.resetPasswordMismatch'));
      return;
    }
    setResetting(true);
    setResetError(null);
    setResetSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        // 409 (no local credential) is the only reachable business error
        // the dialog can produce with a valid list state; everything else
        // falls back to the localized failure text (never a raw English
        // server message).
        const message =
          res.status === 409
            ? t('admin.users.resetPasswordNoCredential')
            : t('admin.users.resetPasswordFailed');
        throw new Error(message);
      }
      setResetSuccess(t('admin.users.resetPasswordSuccess'));
      setResetTarget(null);
      setResetPassword('');
      loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setResetError(message);
    } finally {
      setResetting(false);
    }
  }

  async function applyRole(id: string): Promise<void> {
    const role = roleDrafts[id];
    if (!role) return;
    const user = users.find((u) => u.id === id);
    const currentRole = user?.role;
    if (currentRole && currentRole !== role) {
      const isDowngrade = currentRole === 'ADMIN' && role !== 'ADMIN';
      const message = isDowngrade
        ? t('admin.users.confirmRoleChangeDowngrade', { from: currentRole, to: role })
        : t('admin.users.confirmRoleChange', { from: currentRole, to: role });
      if (!window.confirm(message)) return;
    }
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${id}/role`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.users.roleChangeFailed'));
      }
      setRoleDrafts((d) => { const next = { ...d }; delete next[id]; return next; });
      loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.users.title')} />
        <Loading label={t('admin.users.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('admin.users.title')} description={t('admin.users.description')} />

      {error && <Alert variant="danger">{t('common.error')}: {error}</Alert>}

      <Card>
        <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', marginBottom: 'var(--versigo-space-4)' }}>
          <div className="form-group">
            <label className="form-label">{t('admin.users.statusFilter')}</label>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as UserStatus | '')}>
              <option value="">{t('admin.users.all')}</option>
              <option value="PENDING_APPROVAL">{t('admin.users.pendingApproval')}</option>
              <option value="ACTIVE">{t('admin.users.active')}</option>
              <option value="DISABLED">{t('admin.users.disabled')}</option>
            </Select>
          </div>
          <div className="text-sm text-muted" style={{ marginBottom: 'var(--versigo-space-2)' }}>
            {t('admin.users.count', { count: total })}
          </div>
        </div>

        {users.length === 0 ? (
          <EmptyState title={t('admin.users.emptyTitle')}>
            <p>{t('admin.users.emptyBody')}</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.users.username')}</th>
                  <th>{t('admin.users.displayName')}</th>
                  <th>{t('admin.users.role')}</th>
                  <th>{t('admin.users.status')}</th>
                  <th>{t('admin.users.oidc')}</th>
                  <th>{t('admin.users.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const roleDraft = roleDrafts[u.id] ?? u.role;
                  const isDirty = roleDraft !== u.role;
                  const isBusy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td data-label={t('admin.users.username')}>
                        <code>{u.username}</code>
                        {!u.hasCredential && (
                          <span className="badge badge-warning" style={{ marginLeft: 8 }}>{t('admin.users.noPassword')}</span>
                        )}
                      </td>
                      <td data-label={t('admin.users.displayName')}>{u.displayName}</td>
                      <td data-label={t('admin.users.role')}>
                        <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', alignItems: 'center' }}>
                          <Select
                            aria-label={t('admin.users.roleAria', { username: u.username })}
                            value={roleDraft}
                            onChange={(e) => setRoleDrafts((d) => ({ ...d, [u.id]: e.target.value as GlobalRole }))}
                          >
                            <option value="READ_ONLY">{t('admin.users.readOnly')}</option>
                            <option value="USER">{t('admin.users.user')}</option>
                            <option value="ADMIN">{t('admin.users.administrator')}</option>
                          </Select>
                          {isDirty && (
                            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void applyRole(u.id)}>
                              {isBusy ? '...' : t('common.save')}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td data-label={t('admin.users.status')}>
                        <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : u.status === 'DISABLED' ? 'badge-danger' : 'badge-warning'}`}>
                          {t(STATUS_LABEL[u.status])}
                        </span>
                      </td>
                      <td data-label={t('admin.users.oidc')}>
                        {u.oidcIssuer ? (
                          <span className="badge badge-neutral" title={`${u.oidcIssuer} / ${u.oidcSubject ?? ''}`}>{t('admin.users.bound')}</span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td data-label={t('admin.users.actions')}>
                        <div className="btn-group">
                          {u.status === 'PENDING_APPROVAL' && (
                            <>
                              <Button size="sm" disabled={isBusy} onClick={() => void approve(u.id)}>{t('admin.users.approve')}</Button>
                              <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void reject(u.id)}>{t('admin.users.reject')}</Button>
                            </>
                          )}
                          {u.status === 'ACTIVE' && (
                            <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void disable(u.id)}>{t('admin.users.block')}</Button>
                          )}
                          {u.status === 'DISABLED' && (
                            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void enable(u.id)}>{t('admin.users.unblock')}</Button>
                          )}
                          {u.hasCredential && (
                            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => openResetDialog(u)}>
                              {t('admin.users.resetPassword')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resetSuccess && (
        <div style={{ marginTop: 'var(--versigo-space-4)' }}>
          <Alert variant="success">{resetSuccess}</Alert>
        </div>
      )}

      {/* BugFix-16: password reset dialog. The Dialog renders its own
          cancel button; the confirm button is passed as action. */}
      <Dialog
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={t('admin.users.resetPasswordTitle')}
        actions={
          <Button
            variant="primary"
            disabled={resetting || resetPassword.length < 12}
            onClick={() => void submitReset()}
          >
            {resetting ? t('common.saving') : t('admin.users.resetPassword')}
          </Button>
        }
      >
        {resetTarget && (
          <>
            <p style={{ marginTop: 0 }}>{t('admin.users.resetPasswordBody', { username: resetTarget.username })}</p>
            {resetError && <Alert variant="danger">{resetError}</Alert>}
            <FormField label={t('admin.users.resetPasswordLabel')} hint={t('admin.users.resetPasswordHint')}>
              <Input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </FormField>
            <FormField label={t('admin.users.resetPasswordConfirmLabel')}>
              <Input
                type="password"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </FormField>
          </>
        )}
      </Dialog>
    </AppShell>
  );
}
