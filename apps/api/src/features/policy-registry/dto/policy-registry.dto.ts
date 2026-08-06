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
 * BugFix-05 (Befund 2): Portal-URL-Normalisierung als Defense-in-Depth.
 * Fehlt das Schema (`www.portal.de`), wird `https://` vorangestellt; `http://`
 * bleibt unveraendert. Die eigentliche Sicherheitsvalidierung (nur http/https,
 * explizites 2048-Zeichen-Laengenlimit) uebernimmt weiterhin `@IsUrl` bzw.
 * `@MaxLength` direkt dahinter – ein `javascript:`/`data:`-Eingang kann hier
 * nie entstehen, weil nur dann ein Schema ergaenzt wird, wenn KEIN Schema
 * vorhanden ist.
 */
function normalizePortalUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const hasSchema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  return hasSchema ? trimmed : `https://${trimmed}`;
}

/** Transform-Decorator-Fabrik fuer die beiden Portal-URL-Felder. */
function PortalUrlTransform(): PropertyDecorator {
  return Transform(({ value }) => normalizePortalUrl(value));
}

export class CreatePolicyDto {
  @IsEnum(InsurancePolicyType)
  type!: InsurancePolicyType;

  @IsString()
  insurerName!: string;

  @IsOptional()
  // BugFix-07 (Befund 1): Gleiche Normalisierung wie bei Portal-Links –
  // fehlt das Schema, wird https:// vorangestellt; nur http(s) ist erlaubt.
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
  // BugFix-07 (Befund 1): Gleiche Normalisierung wie bei Portal-Links –
  // fehlt das Schema, wird https:// vorangestellt; nur http(s) ist erlaubt.
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
  // BugFix-05 (Befund 2): Schema-Ergaenzung (https://) + Sicherheitsvalidierung.
  @PortalUrlTransform()
  // AP-18: Nur http(s)-URLs – verhindert javascript:/data: im Deeplink-Target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  // Maximales URL-Laengenlimit (Konsistenz mit dem 2048er-Default von @IsUrl).
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
  // BugFix-05 (Befund 2): Schema-Ergaenzung (https://) + Sicherheitsvalidierung.
  @PortalUrlTransform()
  // AP-18: Nur http(s)-URLs – verhindert javascript:/data: im Deeplink-Target.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  // Maximales URL-Laengenlimit (Konsistenz mit dem 2048er-Default von @IsUrl).
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
   * Zugangsdaten setzen (Objekt) oder loeschen (`null`).
   * Nicht angegeben => unveraendert lassen.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PortalCredentialsDto)
  credentials?: PortalCredentialsDto | null;
}
