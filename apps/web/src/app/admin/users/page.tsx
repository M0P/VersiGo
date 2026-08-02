'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

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

const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Aktiv',
  DISABLED: 'Gesperrt',
  PENDING_APPROVAL: 'Freischaltung ausstehend',
};

/**
 * AP-16: Admin-Nutzerverwaltung. Liste, Freischaltung, Ablehnung, Sperrung,
 * Entsperrung und Rollenzuweisung. Gefaehrliche Aktionen (Ablehnung,
 * Sperrung, Herabstufung) verlangen eine Bestaetigung. Der letzte aktive
 * Admin kann weder gesperrt noch herabgestuft werden (serverseitig
 * durchgesetzt; die UI zeigt die Fehlermeldung der API).
 */
export default function AdminUsersPage(): ReactElement {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, GlobalRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    fetch(`${API_BASE}/admin/users${query}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden der Benutzer');
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
  }, [statusFilter]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function runAction(action: (id: string) => Promise<Response>, id: string, confirmText?: string): Promise<void> {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await action(id);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? 'Aktion fehlgeschlagen');
      }
      loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  const approve = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/approve`, { method: 'POST', credentials: 'include' }), id);
  const reject = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/reject`, { method: 'POST', credentials: 'include' }), id,
      'Konto wirklich ablehnen? Das Konto wird gesperrt (DISABLED).');
  const disable = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/disable`, { method: 'POST', credentials: 'include' }), id,
      'Konto wirklich sperren? Der Benutzer kann sich nicht mehr anmelden.');
  const enable = (id: string) =>
    runAction((i) => fetch(`${API_BASE}/admin/users/${i}/enable`, { method: 'POST', credentials: 'include' }), id);

  async function applyRole(id: string): Promise<void> {
    const role = roleDrafts[id];
    if (!role) return;
    const user = users.find((u) => u.id === id);
    const currentRole = user?.role;
    if (currentRole && currentRole !== role) {
      const isDowngrade = currentRole === 'ADMIN' && role !== 'ADMIN';
      const message = isDowngrade
        ? `Rolle von ${currentRole} auf ${role} aendern? Ein herabgestufter Admin verliert sofort Admin-Rechte.`
        : `Rolle von ${currentRole} auf ${role} aendern?`;
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
        throw new Error(data?.message ?? 'Rollenwechsel fehlgeschlagen');
      }
      setRoleDrafts((d) => { const next = { ...d }; delete next[id]; return next; });
      loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Benutzerverwaltung" />
        <Loading label="Lade Benutzer..." />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Benutzerverwaltung" description="Nutzer freischalten, sperren und Rollen zuweisen" />

      {error && <Alert variant="danger">Fehler: {error}</Alert>}

      <Card>
        <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', marginBottom: 'var(--versigo-space-4)' }}>
          <div className="form-group">
            <label className="form-label">Status-Filter</label>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as UserStatus | '')}>
              <option value="">Alle</option>
              <option value="PENDING_APPROVAL">Freischaltung ausstehend</option>
              <option value="ACTIVE">Aktiv</option>
              <option value="DISABLED">Gesperrt</option>
            </Select>
          </div>
          <div className="text-sm text-muted" style={{ marginBottom: 'var(--versigo-space-2)' }}>
            {total} Benutzer
          </div>
        </div>

        {users.length === 0 ? (
          <EmptyState title="Keine Benutzer gefunden">
            <p>Es gibt keine Benutzer, die diesem Filter entsprechen.</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Benutzername</th>
                  <th>Anzeigename</th>
                  <th>Rolle</th>
                  <th>Status</th>
                  <th>OIDC</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const roleDraft = roleDrafts[u.id] ?? u.role;
                  const isDirty = roleDraft !== u.role;
                  const isBusy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td data-label="Benutzername">
                        <code>{u.username}</code>
                        {!u.hasCredential && (
                          <span className="badge badge-warning" style={{ marginLeft: 8 }}>kein Passwort</span>
                        )}
                      </td>
                      <td data-label="Anzeigename">{u.displayName}</td>
                      <td data-label="Rolle">
                        <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', alignItems: 'center' }}>
                          <Select
                            aria-label={`Rolle fuer ${u.username}`}
                            value={roleDraft}
                            onChange={(e) => setRoleDrafts((d) => ({ ...d, [u.id]: e.target.value as GlobalRole }))}
                          >
                            <option value="READ_ONLY">Nur Lesen</option>
                            <option value="USER">Benutzer</option>
                            <option value="ADMIN">Administrator</option>
                          </Select>
                          {isDirty && (
                            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void applyRole(u.id)}>
                              {isBusy ? '...' : 'Speichern'}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : u.status === 'DISABLED' ? 'badge-danger' : 'badge-warning'}`}>
                          {STATUS_LABEL[u.status]}
                        </span>
                      </td>
                      <td data-label="OIDC">
                        {u.oidcIssuer ? (
                          <span className="badge badge-neutral" title={`${u.oidcIssuer} / ${u.oidcSubject ?? ''}`}>gebunden</span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td data-label="Aktionen">
                        <div className="btn-group">
                          {u.status === 'PENDING_APPROVAL' && (
                            <>
                              <Button size="sm" disabled={isBusy} onClick={() => void approve(u.id)}>Freischalten</Button>
                              <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void reject(u.id)}>Ablehnen</Button>
                            </>
                          )}
                          {u.status === 'ACTIVE' && (
                            <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void disable(u.id)}>Sperren</Button>
                          )}
                          {u.status === 'DISABLED' && (
                            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void enable(u.id)}>Entsperren</Button>
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
    </AppShell>
  );
}
