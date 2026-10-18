import type { IconName } from '@/components/ui/icons';

/**
 * BugFix-22: an insured subject is either a person or an object (car, house,
 * ...). The values mirror the `CoveredSubjectType` enum of the API.
 */
export type CoveredSubjectType = 'PERSON' | 'OBJECT';

export const COVERED_SUBJECT_TYPES: CoveredSubjectType[] = ['PERSON', 'OBJECT'];

export const DEFAULT_COVERED_SUBJECT_TYPE: CoveredSubjectType = 'PERSON';

/**
 * Unknown or missing values fall back to `PERSON` – the database default and
 * the historical meaning of the field, so legacy responses stay renderable.
 */
export function normalizeCoveredSubjectType(
  value: string | null | undefined,
): CoveredSubjectType {
  return value === 'OBJECT' ? 'OBJECT' : 'PERSON';
}

const SUBJECT_ICONS: Record<CoveredSubjectType, IconName> = {
  PERSON: 'subjectPerson',
  OBJECT: 'subjectObject',
};

export function coveredSubjectIcon(type: CoveredSubjectType): IconName {
  return SUBJECT_ICONS[type];
}

const SUBJECT_LABEL_KEYS: Record<CoveredSubjectType, string> = {
  PERSON: 'policies.subjectTypePERSON',
  OBJECT: 'policies.subjectTypeOBJECT',
};

export function coveredSubjectLabelKey(type: CoveredSubjectType): string {
  return SUBJECT_LABEL_KEYS[type];
}

/** A birth date only makes sense for a person, not for an insured object. */
export function isBirthDateRelevant(type: CoveredSubjectType): boolean {
  return type === 'PERSON';
}

// --- AP-24 (§5): type-dependent field labels -------------------------------
//
// The name field used to be statically called "Personenname" even when an
// object (car, house, ...) was being recorded. Every wording of that field –
// label, placeholder and accessible name – is therefore derived from the
// selected type and switches immediately when the type changes.

const NAME_LABEL_KEYS: Record<CoveredSubjectType, string> = {
  PERSON: 'policies.subjectNamePERSON',
  OBJECT: 'policies.subjectNameOBJECT',
};

const NAME_PLACEHOLDER_KEYS: Record<CoveredSubjectType, string> = {
  PERSON: 'policies.subjectNamePlaceholderPERSON',
  OBJECT: 'policies.subjectNamePlaceholderOBJECT',
};

/** i18n key of the name field label ("Name der Person" / "Bezeichnung des Objekts"). */
export function coveredSubjectNameLabelKey(type: CoveredSubjectType): string {
  return NAME_LABEL_KEYS[type];
}

export function coveredSubjectNamePlaceholderKey(type: CoveredSubjectType): string {
  return NAME_PLACEHOLDER_KEYS[type];
}

/**
 * AP-24 (§5.2): the relation field stays technically optional, but the label
 * no longer spells that out.
 *
 * For an object the word "Beziehung" is misleading – an insured car has no
 * relation to the policyholder in the family sense. Objects therefore use
 * "Rolle des Objekts" (e.g. Zweitwagen, Mietobjekt), which is documented in
 * the user documentation rather than being implied by the label.
 */
const RELATION_LABEL_KEYS: Record<CoveredSubjectType, string> = {
  PERSON: 'policies.subjectRelationPERSON',
  OBJECT: 'policies.subjectRelationOBJECT',
};

const RELATION_PLACEHOLDER_KEYS: Record<CoveredSubjectType, string> = {
  PERSON: 'policies.subjectRelationPlaceholderPERSON',
  OBJECT: 'policies.subjectRelationPlaceholderOBJECT',
};

export function coveredSubjectRelationLabelKey(type: CoveredSubjectType): string {
  return RELATION_LABEL_KEYS[type];
}

export function coveredSubjectRelationPlaceholderKey(type: CoveredSubjectType): string {
  return RELATION_PLACEHOLDER_KEYS[type];
}
