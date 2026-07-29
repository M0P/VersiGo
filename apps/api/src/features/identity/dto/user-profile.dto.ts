export class UserProfileDto {
  id!: string;
  email!: string;
  displayName!: string;
  memberships!: { householdId: string; role: string }[];
}
