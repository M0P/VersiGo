import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * BugFix-22 source guards for UI requirements that are hard to express as a
 * pure-function test:
 *
 *  1. the duplicate "Portallink" field is gone from the master-data forms –
 *     the portal-link mask is the single place for a portal URL (a legacy
 *     value is pre-filled there instead),
 *  2. the relation is no longer a mandatory field for insured persons/objects,
 *  3. the documents list offers sorting and shows the origin as an icon,
 *  4. the Paperless deep link appears only once per document row (as the
 *     button target) and no longer as visible URL text,
 *  5. the cost increase accepts a gross OR a net amount (one of them is
 *     enough) and never displays a missing amount as 0.
 *
 * The repository has no browser/e2e harness, so these string-level guards are
 * the automated part of the verification; the visual result was reviewed by
 * reading the components (see the review reports).
 */
function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('master data must not render an insurer portal URL field (BugFix-22)', () => {
  it.each([
    ['new policy', '../app/policies/new/page.tsx'],
    ['edit policy', '../app/policies/[id]/edit/page.tsx'],
  ])('%s: no insurerPortalUrl input', (_name, path) => {
    const source = read(path);
    expect(source).not.toContain('insurerPortalUrl');
  });
});

describe('covered persons: relation is optional (BugFix-22, AP-24 §5.2)', () => {
  const source = read('../app/policies/[id]/covered-persons-tab.tsx');

  it('renders the relation field without a required marker', () => {
    // AP-24 (§5.2): the label is kind-dependent now ("Beziehung" for a
    // person, "Rolle des Objekts" for an object) and no longer carries an
    // "(Optional)" suffix – the field stays technically optional.
    const start = source.indexOf('coveredSubjectRelationLabelKey(');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 400);
    expect(block).not.toContain('required');
    expect(block).not.toContain('common.optional');
  });

  it('derives the name field label from the subject kind instead of a static text', () => {
    // AP-24 (§5.1): "Personenname" must not be shown for an object.
    expect(source).not.toContain("t('policies.personName')");
    expect(source).toContain('coveredSubjectNameLabelKey(');
    expect(source).toContain('coveredSubjectNamePlaceholderKey(');
  });

  it('offers the subject kind (person/object) and hides the birth date for objects', () => {
    expect(source).toContain('COVERED_SUBJECT_TYPES');
    expect(source).toContain('isBirthDateRelevant');
    expect(source).toContain('coveredSubjectIcon');
  });
});

describe('cost increase: gross or net is enough (BugFix-22)', () => {
  const source = read('../app/policies/[id]/costs-overview-card.tsx');

  it('validates through the tested helper instead of a required gross field', () => {
    expect(source).toContain('parseCostAmounts(');
    expect(source).toContain("t('costs.amountHint')");
    // Both amount fields are marked as optional now (label is on its own
    // line because the field also carries a `hint` for the AI prefill).
    expect(source).toContain("label={`${t('costs.grossAmount')} (${t('common.optional')})`}");
    expect(source).toContain("label={`${t('costs.netAmount')} (${t('common.optional')})`}");
  });

  it('renders a missing gross amount as "-" and can clear it while editing', () => {
    // BugFix-22: net-only entries must not be displayed as 0.
    expect(source).toContain('e.grossAmount != null ?');
    expect(source).toContain('entry.grossAmount != null ?');
  });
});

describe('portal links adopt the legacy master-data URL (BugFix-22)', () => {
  const source = read('../app/policies/[id]/portal-links-tab.tsx');

  it('pre-fills the portal URL of a new link from the policy', () => {
    expect(source).toContain('newPortalLinkForm(legacyPortalUrl)');
    expect(source).toContain('data.insurerPortalUrl');
    expect(source).toContain("t('policies.portalUrlLegacyHint')");
  });
});

describe('documents tab: sorting + icon-only origin (BugFix-22)', () => {
  const source = read('../app/policies/[id]/documents-tab.tsx');

  it('sorts the list through the tested helper', () => {
    expect(source).toContain('sortDocuments(visibleDocuments, sortKey)');
    expect(source).toContain('DOCUMENT_SORT_KEYS');
    // The sort order is a real control, not a silently fixed default.
    expect(source).toContain("t('policies.documentsSort')");
  });

  it('shows the origin as an icon instead of a text badge', () => {
    expect(source).toContain('documentOriginIcon(');
    expect(source).toContain('documentOriginKind(');
    // The localized origin label is only used as the accessible name/tooltip,
    // it is no longer rendered inside a (space-consuming) text badge.
    expect(source).toContain('aria-label={label}');
    expect(source).not.toMatch(/className="badge[\s\S]{0,160}documentOriginLabelKey/);
    // The wide "automatic assignment" badge in the action row is gone; the
    // explanation lives on as the tooltip of the origin icon, so the hint must
    // never be rendered as a text child of an element again.
    expect(source).not.toMatch(/\{t\('policies\.paperlessAutoManagedHint'\)\}/);
    expect(source).toContain("title={kind === 'auto' ? t('policies.paperlessAutoManagedHint') : label}");
  });

  it('renders the date prominently and the deep link only as a button target', () => {
    // BugFix-22: the document date gets its own line in the base font size
    // instead of being appended to the small metadata line.
    expect(source).toContain("fontSize: 'var(--versigo-font-size-base)'");
    // The full Paperless URL as visible link text is gone – the URL lives only
    // in the href of the "open in Paperless" button.
    expect(source).not.toContain("wordBreak: 'break-all'");
    expect(source.split('href={doc.deepLink}').length - 1).toBe(1);
  });
});
