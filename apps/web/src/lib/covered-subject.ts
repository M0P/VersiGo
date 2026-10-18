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
