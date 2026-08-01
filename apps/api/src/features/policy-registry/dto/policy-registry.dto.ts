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
import { Type } from 'class-transformer';

export class CreatePolicyDto {
  @IsEnum(InsurancePolicyType)
  type!: InsurancePolicyType;

  @IsString()
  insurerName!: string;

  @IsOptional()
  @IsString()
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
  @IsString()
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
 * Optionale Portal-Zugangsdaten (AP-18).
 *
 * Werden NIE im Klartext gespeichert oder zurueckgegeben: Der Service
 * verschluesselt sie AES-256-GCM in `PortalAccountLink.credentialsEncrypted`;
 * Antworten enthalten ausschliesslich `credentialsSet: true/false`.
 *
 * Die "mindestens ein Feld" -Regel wird bewusst im Service durchgesetzt
 * (`encryptCredentials`, Single Source of Truth), weil class-validator
 * (0.14.x) keine typisierten Klassenebenen-Constraints bietet. Die DTO-Schicht
 * validiert hier nur Typ und Laengen der einzelnen Felder.
 *
 * Hinweis (AP-18): Bei einem Update gilt Ersetz-Semantik – uebermittelte
 * Felder ersetzen die gespeicherten Zugangsdaten vollstaendig; ein einzelnes
 * Feld ueberschreibt damit beide gespeicherten Werte.
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
  // AP-18: Nur http(s)-URLs – verhindert javascript:/data: im Deeplink-Target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
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
  // AP-18: Nur http(s)-URLs – verhindert javascript:/data: im Deeplink-Target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
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
   * Zugangsdaten setzen (Objekt) oder loeschen (`null`).
   * Nicht angegeben => unveraendert lassen.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PortalCredentialsDto)
  credentials?: PortalCredentialsDto | null;
}
