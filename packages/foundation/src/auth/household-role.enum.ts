// Re-Export der Prisma-HouseholdRole als Foundation-Typ, damit Feature-Slices
// ausserhalb der Identity-Domain keine harte Prisma-Abhaengigkeit benoetigen.
export enum HouseholdRoleValue {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}
