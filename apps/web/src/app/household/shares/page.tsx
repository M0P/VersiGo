'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select, FormField } from '../../../components/ui/form-field';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { useCurrentUser } from '../../../hooks/use-current-user';
import { useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type Member = {
  id: string;
  username: string;
  displayName: string;
  role: 'READ_ONLY' | 'USER' | 'ADMIN';
};

type Policy = {
  id: string;
  type: string;
  insurerName: string;
  contractNumber: string;
};

type DocumentItem = {
  id: string;
  fileName: string;
  category: string | null;
};

type Share = {
  id: string;
  householdId: string;
  sourceUserId: string;
  targetUserId: string;
  scopeType: 'INSURANCE' | 'DOCUMENT' | 'CATEGORY' | 'ALL_OWNED';
  scopeRef: string | null;
  permission: 'READ' | 'WRITE';
  createdAt: string;
};

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

type CreateForm = {
  targetUserId: string;
  scopeType: Share['scopeType'];
  policyId: string;
  documentId: string;
  categoryType: string;
  permission: Share['permission'];
};

const EMPTY_FORM: CreateForm = {
  targetUserId: '',
  scopeType: 'ALL_OWNED',
  policyId: '',
  documentId: '',
  categoryType: 'HAFTPFLICHT',
  permission: 'READ',
};

export default function FamilySharingPage(): ReactElement {
  const { t } = useI18n();
  const { user: currentUser } = useCurrentUser();
  const canManage = currentUser?.role === 'USER' || currentUser?.role === 'ADMIN';

  const [shares, setShares] = useState<Share[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, Share['permission']>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function loadShares(): void {
    fetch(`${API_BASE}/households/default/shares`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('shares.loadError'));
        return res.json();
      })
      .then((data: Share[] | null) => { if (data) setShares(data); })
      .catch(() => setError(t('shares.loadError')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadShares();
    fetch(`${API_BASE}/households/default/members`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Member[]) => setMembers(data))
      .catch(() => setMembers([]));
    fetch(`${API_BASE}/households/default/policies`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Policy[]) => setPolicies(data))
      .catch(() => setPolicies([]));
  }, []);

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    setCreateError(null);
    if (!form.targetUserId) {
      setCreateError(t('shares.selectTargetFirst'));
      return;
    }
    let scopeRef: string | undefined;
    if (form.scopeType === 'INSURANCE') {
      if (!form.policyId) { setCreateError(t('shares.selectPolicyFirst')); return; }
      scopeRef = form.policyId;
    } else if (form.scopeType === 'CATEGORY') {
      scopeRef = form.categoryType;
    } else if (form.scopeType === 'DOCUMENT') {
      if (!form.documentId) { setCreateError(t('shares.selectDocumentFirst')); return; }
      scopeRef = form.documentId;
    }

    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/households/default/shares`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: form.targetUserId,
          scopeType: form.scopeType,
          scopeRef,
          permission: form.permission,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('shares.createError'));
      }
      setForm(EMPTY_FORM);
      setDocuments([]);
      loadShares();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : t('common.unknownError'));
    } finally {
      setCreating(false);
    }
  }

  async function loadDocumentsForPolicy(policyId: string): Promise<void> {
    setDocuments([]);
    if (!policyId) return;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents`, { credentials: 'include' });
      if (res.ok) {
        const data: DocumentItem[] = await res.json();
        setDocuments(data);
      }
    } catch {
      setDocuments([]);
    }
  }

  async function changePermission(shareId: string): Promise<void> {
    const permission = permissionDrafts[shareId];
    if (!permission) return;
    setError(null);
    setBusyId(shareId);
    try {
      const res = await fetch(`${API_BASE}/households/default/shares/${shareId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('shares.updateError'));
      }
      setPermissionDrafts((d) => { const next = { ...d }; delete next[shareId]; return next; });
      loadShares();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.unknownError'));
    } finally {
      setBusyId(null);
    }
  }

  async function revokeShare(share: Share): Promise<void> {
    if (!window.confirm(t('shares.revokeConfirm'))) return;
    setError(null);
    setBusyId(share.id);
    try {
      const res = await fetch(`${API_BASE}/households/default/shares/${share.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('shares.revokeError'));
      }
      loadShares();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.unknownError'));
    } finally {
      setBusyId(null);
    }
  }

  function userName(userId: string): string {
    if (userId === currentUser?.id) return `${currentUser.displayName}${t('shares.youSuffix')}`;
    const member = members.find((m) => m.id === userId);
    return member ? `${member.displayName} (${member.username})` : userId;
  }

  function scopeLabel(share: Share): string {
    const base = t(
      share.scopeType === 'ALL_OWNED'
        ? 'shares.allOwned'
        : share.scopeType === 'INSURANCE'
          ? 'shares.singlePolicy'
          : share.scopeType === 'CATEGORY'
            ? 'shares.allOfCategory'
            : 'shares.singleDocument',
    );
    if (!share.scopeRef) return base;
    if (share.scopeType === 'INSURANCE') {
      const policy = policies.find((p) => p.id === share.scopeRef);
      return policy
        ? `${policy.insurerName} – ${t(`policies.types.${policy.type}`) ?? policy.type}`
        : `${base}: ${share.scopeRef}`;
    }
    if (share.scopeType === 'CATEGORY') {
      return `${base}: ${t(`policies.types.${share.scopeRef}`) ?? share.scopeRef}`;
    }
    if (share.scopeType === 'DOCUMENT') {
      const doc = documents.find((d) => d.id === share.scopeRef);
      return doc ? `${base}: ${doc.fileName}` : `${base}: ${share.scopeRef}`;
    }
    return base;
  }

  const isBusy = (id: string): boolean => busyId === id;

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('shares.title')} />
        <Loading label={t('shares.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('shares.title')}
        description={t('shares.description')}
      />

      {error && <Alert variant="danger">{error}</Alert>}

      {canManage && (
        <Card>
          <SectionHeader title={t('shares.createTitle')} />
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            {t('shares.createHint')}
          </p>
          <form onSubmit={(e) => void handleCreate(e)} noValidate>
            <div
              className="form-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 'var(--versigo-space-4)',
              }}
            >
              <FormField label={t('shares.recipient')} required>
                <Select
                  value={form.targetUserId}
                  onChange={(e) => setForm((f) => ({ ...f, targetUserId: e.target.value }))}
                >
                  <option value="">{t('shares.selectMember')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName} ({m.username})</option>
                  ))}
                </Select>
              </FormField>

              <FormField label={t('shares.scopeField')} required>
                <Select
                  value={form.scopeType}
                  onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as Share['scopeType'] }))}
                >
                  <option value="ALL_OWNED">{t('shares.allOwned')}</option>
                  <option value="INSURANCE">{t('shares.singlePolicy')}</option>
                  <option value="CATEGORY">{t('shares.allOfCategory')}</option>
                  <option value="DOCUMENT">{t('shares.singleDocument')}</option>
                </Select>
              </FormField>

              {form.scopeType === 'INSURANCE' && (
                <FormField label={t('shares.policy')} required>
                  <Select
                    value={form.policyId}
                    onChange={(e) => setForm((f) => ({ ...f, policyId: e.target.value }))}
                  >
                    <option value="">{t('shares.selectPolicy')}</option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>{p.insurerName} – {t(`policies.types.${p.type}`) ?? p.type}</option>
                    ))}
                  </Select>
                </FormField>
              )}

              {form.scopeType === 'CATEGORY' && (
                <FormField label={t('shares.policyCategory')} required>
                  <Select
                    value={form.categoryType}
                    onChange={(e) => setForm((f) => ({ ...f, categoryType: e.target.value }))}
                  >
                    {POLICY_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`policies.types.${type}`) ?? type}</option>
                    ))}
                  </Select>
                </FormField>
              )}

              {form.scopeType === 'DOCUMENT' && (
                <>
                  <FormField label={t('shares.policy')} required>
                    <Select
                      value={form.policyId}
                      onChange={(e) => {
                        const policyId = e.target.value;
                        setForm((f) => ({ ...f, policyId, documentId: '' }));
                        void loadDocumentsForPolicy(policyId);
                      }}
                    >
                      <option value="">{t('shares.selectPolicy')}</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>{p.insurerName} – {t(`policies.types.${p.type}`) ?? p.type}</option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField
                    label={t('shares.document')}
                    required
                    hint={documents.length === 0 ? t('shares.documentHint') : undefined}
                  >
                    <Select
                      value={form.documentId}
                      onChange={(e) => setForm((f) => ({ ...f, documentId: e.target.value }))}
                    >
                      <option value="">{t('shares.selectDocument')}</option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>{d.fileName}</option>
                      ))}
                    </Select>
                  </FormField>
                </>
              )}

              <FormField label={t('shares.permission')} required>
                <Select
                  value={form.permission}
                  onChange={(e) => setForm((f) => ({ ...f, permission: e.target.value as Share['permission'] }))}
                >
                  <option value="READ">{t('shares.read')}</option>
                  <option value="WRITE">{t('shares.readWrite')}</option>
                </Select>
              </FormField>
            </div>

            {createError && <Alert variant="danger">{createError}</Alert>}

            <div style={{ marginTop: 'var(--versigo-space-4)' }}>
              <Button type="submit" variant="primary" disabled={creating || members.length === 0}>
                {creating ? t('shares.creating') : t('shares.create')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <SectionHeader title={t('shares.existing')} />
        {shares.length === 0 ? (
          <EmptyState title={t('shares.emptyTitle')}>
            <p>{t('shares.emptyBody')}</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('shares.from')}</th>
                  <th>{t('shares.to')}</th>
                  <th>{t('shares.scopeColumn')}</th>
                  <th>{t('shares.permission')}</th>
                  <th>{t('shares.created')}</th>
                  {canManage && <th>{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => {
                  const draft = permissionDrafts[share.id] ?? share.permission;
                  const isDirty = draft !== share.permission;
                  return (
                    <tr key={share.id}>
                      <td data-label={t('shares.from')}>{userName(share.sourceUserId)}</td>
                      <td data-label={t('shares.to')}>{userName(share.targetUserId)}</td>
                      <td data-label={t('shares.scopeColumn')}>{scopeLabel(share)}</td>
                      <td data-label={t('shares.permission')}>
                        {share.permission === 'READ' ? t('shares.read') : t('shares.readWrite')}
                      </td>
                      <td data-label={t('shares.created')}>{new Date(share.createdAt).toLocaleDateString()}</td>
                      {canManage && (
                        <td data-label={t('common.actions')}>
                          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', alignItems: 'center' }}>
                            <Select
                              aria-label={`${t('shares.permission')} ${share.id}`}
                              value={draft}
                              disabled={isBusy(share.id)}
                              onChange={(e) => setPermissionDrafts((d) => ({ ...d, [share.id]: e.target.value as Share['permission'] }))}
                              style={{ minWidth: 130 }}
                            >
                              <option value="READ">{t('shares.read')}</option>
                              <option value="WRITE">{t('shares.readWrite')}</option>
                            </Select>
                            {isDirty && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={isBusy(share.id)}
                                onClick={() => void changePermission(share.id)}
                              >
                                {isBusy(share.id) ? '...' : t('common.save')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={isBusy(share.id)}
                              onClick={() => void revokeShare(share)}
                            >
                              {t('shares.revoke')}
                            </Button>
                          </div>
                        </td>
                      )}
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
