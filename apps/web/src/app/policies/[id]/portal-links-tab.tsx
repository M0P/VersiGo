'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { normalizePortalUrl } from '@/lib/portal-url';

const API_BASE = getApiBaseUrl();

type PortalLink = {
  id: string;
  providerKey: string;
  portalUrl: string | null;
  usernameHint: string | null;
  accessHint: string | null;
  connector: { key: string; displayName: string; experimental: boolean; available: boolean } | null;
};

export default function PortalLinksTab({ policyId }: { policyId: string }): ReactElement {
  const { t } = useI18n();
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    providerKey: '',
    portalUrl: '',
    usernameHint: '',
    accessHint: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Gemeinsame Ladelogik fuer Mount-Effekt und Handler-Reloads. Ein
  // Monoton-zaehler (`requestSeq`) invalidiert in-flight Requests bei jedem
  // neuen Ladevorgang sowie bei Unmount/policyId-Wechsel: Nur die neueste
  // Anfrage darf Zustand schreiben – auch nach Submits/Deletes, die nach
  // einem policyId-Wechsel noch eintreffen (BugFix-05, Befund 8: kein
  // Fremddaten-Leak von Versicherung A unter B).
  const requestSeq = useRef(0);

  const reloadLinks = async () => {
    const seq = ++requestSeq.current;
    // BugFix-05 (Befund 8): State zuruecksetzen, damit beim policyId-Wechsel
    // keine Daten der vorherigen Versicherung angezeigt werden.
    setLinks([]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}`, {
        credentials: 'include',
      });
      if (seq !== requestSeq.current) return;
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.ok) {
        const data = await res.json();
        if (seq === requestSeq.current) setLinks(data.portalLinks || []);
      } else if (seq === requestSeq.current) {
        setError(t('policies.noLinksBody'));
      }
    } catch {
      if (seq === requestSeq.current) setError(t('policies.noLinksBody'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  // BugFix-05 (Befund 4): Beim Mount und bei jedem policyId-Wechsel neu laden –
  // sonst bleibt der Spinner haengen bzw. es erscheinen Daten der vorherigen
  // Versicherung. Der Cleanup invalidiert in-flight Requests des vorherigen
  // policyId bzw. nach Unmount (keine Zustands-Updates danach).
  // BugFix-05 (Befund 8): Beim policyId-Wechsel wird auch das Formular
  // zurueckgesetzt – ein offenes Formular mit Daten der Versicherung A darf
  // nicht unter B stehen bleiben (ein spaeterer Submit-Fehler wuerde sonst
  // unter B gerendert bzw. die Felder von A weiterhin anzeigen).
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
    setForm({ providerKey: '', portalUrl: '', usernameHint: '', accessHint: '' });
    setFormError(null);
    void reloadLinks();
    // policyId steuert die Datenquelle; t ist bewusst nicht in den Dependencies
    // (Sprachwechsel soll die Liste nicht neu laden).
    return () => { requestSeq.current += 1; };
  }, [policyId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // BugFix-05 (Befund 8): Seq-Token wie beim Reload/Delete – ein Submit-
    // Fehler einer aelteren Anfrage darf nach policyId-Wechsel keine
    // Fehlermeldung im (bereits zurueckgesetzten) Formular der neuen
    // Versicherung rendern. Der Erfolgspfad laeuft ueber reloadLinks(),
    // das selbst einen neuen Seq-Stand setzt.
    const seq = requestSeq.current;
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        providerKey: form.providerKey,
        // BugFix-05 (Befund 2): Schema ergaenzen, bevor gesendet wird.
        portalUrl: form.portalUrl ? normalizePortalUrl(form.portalUrl) : undefined,
        usernameHint: form.usernameHint || undefined,
        accessHint: form.accessHint || undefined,
      };
      let res;
      if (editingId) {
        res = await fetch(`${API_BASE}/households/default/policies/${policyId}/portal-links/${editingId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${API_BASE}/households/default/policies/${policyId}/portal-links`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('common.unknownError'));
      }
      // BugFix-05 (Befund 8, Review-Runde 5): Auch die Formular-Reset-Writes
      // sind seq-gesichert – ein spaeter Erfolg eines Submits von A darf nach
      // policyId-Wechsel nicht B's offenes Formular schliessen/leeren.
      if (seq === requestSeq.current) {
        setForm({ providerKey: '', portalUrl: '', usernameHint: '', accessHint: '' });
        setEditingId(null);
        setShowForm(false);
        // Erfolgs-Reload nur, wenn kein policyId-Wechsel zwischenzeitlich
        // stattfand – sonst wuerde die veraltete Closure Portal-Links von A
        // unter B laden. Der neue policyId-Effekt laedt B bereits selbst.
        reloadLinks();
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setFormError(err instanceof Error ? err.message : t('common.unknownError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (link: PortalLink) => {
    setForm({
      providerKey: link.providerKey,
      portalUrl: link.portalUrl ?? '',
      usernameHint: link.usernameHint ?? '',
      accessHint: link.accessHint ?? '',
    });
    setEditingId(link.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('policies.confirmDeletePortalLink'))) return;
    // BugFix-05 (Befund 8): Seq-Token wie beim Reload – ein Fehler einer
    // aelteren Anfrage darf nach policyId-Wechsel keine Fehlermeldung unter
    // der neuen Versicherung rendern.
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/portal-links/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      // BugFix-05 (Befund 8, Review-Runde 4): Auch der Erfolgs-Reload ist
      // seq-gesichert – nach einem policyId-Wechsel darf die veraltete Closure
      // keine Portal-Links von A unter B laden.
      if (seq === requestSeq.current) reloadLinks();
    } catch {
      if (seq === requestSeq.current) setError(t('common.unknownError'));
    }
  };

  const cancelEdit = () => {
    setForm({ providerKey: '', portalUrl: '', usernameHint: '', accessHint: '' });
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.tabs.portalLinks')}</h2>
        <Button variant="primary" onClick={() => { setEditingId(null); setForm({ providerKey: '', portalUrl: '', usernameHint: '', accessHint: '' }); setShowForm(true); }}>
          {t('policies.addPortalLink')}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--versigo-space-6)', padding: 'var(--versigo-space-4)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--versigo-space-4)' }}>
            <FormField label={t('policies.providerKey')} required>
              <Input
                value={form.providerKey}
                onChange={(e) => setForm({ ...form, providerKey: e.target.value })}
                required
                placeholder={t('policies.providerKeyPlaceholder')}
              />
            </FormField>
            <FormField label={t('policies.portalUrl')}>
              <Input
                type="url"
                value={form.portalUrl}
                onChange={(e) => setForm({ ...form, portalUrl: e.target.value })}
                placeholder={t('policies.portalUrlPlaceholder')}
              />
            </FormField>
            <FormField label={t('policies.usernameHint')}>
              <Input
                value={form.usernameHint}
                onChange={(e) => setForm({ ...form, usernameHint: e.target.value })}
                placeholder={t('policies.usernameHint')}
              />
            </FormField>
            <FormField label={t('policies.accessHint')}>
              <Input
                value={form.accessHint}
                onChange={(e) => setForm({ ...form, accessHint: e.target.value })}
                placeholder={t('policies.accessHint')}
              />
            </FormField>
          </div>
          {formError && (
            <div style={{ marginTop: 'var(--versigo-space-3)' }}>
              <Alert variant="danger">{formError}</Alert>
            </div>
          )}
          <div style={{ marginTop: 'var(--versigo-space-4)', display: 'flex', gap: 'var(--versigo-space-2)' }}>
            <Button type="submit" disabled={submitting}>
              {submitting ? <><InlineSpinner /> {t('common.saving')}</> : t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelEdit}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
          <InlineSpinner />
        </div>
      ) : links.length === 0 ? (
        <EmptyState icon="🔗" title={t('policies.noLinksTitle')}>
          <p>{t('policies.noLinksBody')}</p>
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--versigo-space-3)' }}>
          {links.map((link) => (
            <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--versigo-space-3)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--versigo-space-3)' }}>
                <span style={{ fontSize: '1.5rem' }}>🔗</span>
                <div>
                  <strong>{link.providerKey}</strong>
                  {link.connector && (
                    <span className={`badge ${link.connector.available ? 'badge-success' : 'badge-neutral'}`}
                      style={{ marginLeft: 'var(--versigo-space-2)' }}
                      title={`${t('policies.connector')}: ${link.connector.displayName}`}>
                      {link.connector.experimental ? t('policies.experimental') : t('policies.connector')}
                      {!link.connector.available ? t('policies.disabledSuffix') : ''}
                    </span>
                  )}
                  <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                    {link.portalUrl && <a href={link.portalUrl} target="_blank" rel="noopener noreferrer">{link.portalUrl}</a>}
                    {link.usernameHint && <span style={{ marginLeft: 'var(--versigo-space-2)' }}>{t('policies.usernameHint')}: {link.usernameHint}</span>}
                    {link.accessHint && <span style={{ marginLeft: 'var(--versigo-space-2)' }}>{link.accessHint}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
                {link.portalUrl && (
                  <a href={link.portalUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary" size="sm">{t('policies.openPortal')}</Button>
                  </a>
                )}
                <Button variant="secondary" size="sm" onClick={() => handleEdit(link)}>{t('policies.editPortalLink')}</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(link.id)}>{t('policies.deletePortalLink')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}