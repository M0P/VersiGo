import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsNumber,
  Min,
  IsBoolean,
  IsObject,
  MaxLength,
  ValidateNested,
  IsUrl,
} from 'class-validator';
import { InsurancePolicyType, PolicyStatus, PaymentFrequency, PolicySource, SyncStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';

/**
 * BugFix-05 (finding 2): portal URL normalization as defense in depth.
 * If the scheme is missing (`www.portal.de`), `https://` is prepended; `http://`
 * remains unchanged. The actual security validation (only http/https,
 * explicit 2048-character length limit) is still done by `@IsUrl` or
 * `@MaxLength` right behind it – a `javascript:`/`data:` input can never
 * arise here because a scheme is only prepended when NO scheme is
 * present.
 */
function normalizePortalUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const hasSchema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  return hasSchema ? trimmed : `https://${trimmed}`;
}

/** Transform decorator factory for the two portal URL fields. */
function PortalUrlTransform(): PropertyDecorator {
  return Transform(({ value }) => normalizePortalUrl(value));
}

export class CreatePolicyDto {
  @IsEnum(InsurancePolicyType)
  type!: InsurancePolicyType;

  @IsString()
  insurerName!: string;

  @IsOptional()
  // BugFix-07 (finding 1): same normalization as for portal links –
  // if the scheme is missing, https:// is prepended; only http(s) is allowed.
  @PortalUrlTransform()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  insurerPortalUrl?: string;

  @IsString()
  contractNumber!: string;

  @IsOptional()
  @IsString()
  tariffName?: string;

  @IsOptional()
  @IsEnum(PolicyStatus)
  status?: PolicyStatus;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  noticePeriod?: number;

  @IsOptional()
  @IsEnum(PaymentFrequency)
  paymentFrequency?: PaymentFrequency;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  premiumAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  deductibleAmount?: number;

  @IsOptional()
  @IsString()
  coverageSummaryShort?: string;

  @IsOptional()
  @IsEnum(PolicySource)
  source?: PolicySource;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsEnum(InsurancePolicyType)
  type?: InsurancePolicyType;

  @IsOptional()
  @IsString()
  insurerName?: string;

  @IsOptional()
  // BugFix-07 (finding 1): same normalization as for portal links –
  // if the scheme is missing, https:// is prepended; only http(s) is allowed.
  @PortalUrlTransform()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  insurerPortalUrl?: string;

  @IsOptional()
  @IsString()
  contractNumber?: string;

  @IsOptional()
  @IsString()
  tariffName?: string;

  @IsOptional()
  @IsEnum(PolicyStatus)
  status?: PolicyStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  noticePeriod?: number;

  @IsOptional()
  @IsEnum(PaymentFrequency)
  paymentFrequency?: PaymentFrequency;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  premiumAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  deductibleAmount?: number;

  @IsOptional()
  @IsString()
  coverageSummaryShort?: string;

  @IsOptional()
  @IsEnum(PolicySource)
  source?: PolicySource;
}

export class CreateCoveredPersonDto {
  @IsString()
  personName!: string;

  @IsString()
  relationType!: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;
}

export class UpdateCoveredPersonDto {
  @IsOptional()
  @IsString()
  personName?: string;

  @IsOptional()
  @IsString()
  relationType?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;
}

/**
 * Optional portal credentials (AP-18).
 *
 * Are NEVER stored or returned in plaintext: the service encrypts them
 * with AES-256-GCM into `PortalAccountLink.credentialsEncrypted`;
 * responses contain only `credentialsSet: true/false`.
 *
 * The "at least one field" rule is deliberately enforced in the service
 * (`encryptCredentials`, Single Source of Truth), because class-validator
 * (0.14.x) offers no typed class-level constraints. The DTO layer only
 * validates type and lengths of the individual fields here.
 *
 * Note (AP-18): updates use replace semantics – submitted fields replace
 * the stored credentials completely; a single field therefore overwrites
 * both stored values.
 */
export class PortalCredentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  portalUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  portalPassword?: string;
}

export class CreatePortalAccountLinkDto {
  @IsString()
  providerKey!: string;

  @IsOptional()
  // BugFix-05 (finding 2): scheme completion (https://) + security validation.
  @PortalUrlTransform()
  // AP-18: only http(s) URLs – prevents javascript:/data: in the deeplink target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  // Maximum URL length limit (consistent with the 2048 default of @IsUrl).
  @MaxLength(2048)
  portalUrl?: string;

  @IsOptional()
  @IsString()
  usernameHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  connectorKey?: string;

  @IsOptional()
  @IsBoolean()
  mailboxCapability?: boolean;

  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PortalCredentialsDto)
  credentials?: PortalCredentialsDto;
}

export class UpdatePortalAccountLinkDto {
  @IsOptional()
  @IsString()
  providerKey?: string;

  @IsOptional()
  // BugFix-05 (finding 2): scheme completion (https://) + security validation.
  @PortalUrlTransform()
  // AP-18: only http(s) URLs – prevents javascript:/data: in the deeplink target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  // Maximum URL length limit (consistent with the 2048 default of @IsUrl).
  @MaxLength(2048)
  portalUrl?: string;

  @IsOptional()
  @IsString()
  usernameHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  connectorKey?: string;

  @IsOptional()
  @IsBoolean()
  mailboxCapability?: boolean;

  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;

  /**
   * Sets credentials (object) or deletes them (`null`).
   * Not provided => leave unchanged.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PortalCredentialsDto)
  credentials?: PortalCredentialsDto | null;
}
