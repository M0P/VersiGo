import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for setting/changing a UI-configurable system setting.
 * The value is always a string; the catalog validation (type, min/max,
 * allowedValues) happens server-side in SystemConfigService – the
 * allowlist applies without exception.
 */
export class UpdateSystemConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value!: string;
}

/**
 * Result of a safe connectivity check for an integration.
 * Never contains secrets or plaintext configuration values.
 */
export class ConnectivityTestResultDto {
  success!: boolean;
  message!: string;
  timestamp!: string;
}

/**
 * Admin-UI view of a catalogued setting key.
 * Secrets are masked (`secret: true`, `secretSet` instead of `effectiveValue`).
 */
export class SystemConfigEntryDto {
  key!: string;
  category!: 'runtime' | 'restart' | 'secret' | 'bootstrap';
  type!: 'boolean' | 'number' | 'string';
  group!: string;
  description!: string;
  validationHint!: string | null;
  allowedValues!: string[] | null;
  min!: number | null;
  max!: number | null;
  connectivityTestable!: boolean;
  secret!: boolean;
  /** Effective value; always null for secrets (secretSet instead). */
  effectiveValue!: string | number | boolean | null;
  /** Only for secrets: is a value set (UI or ENV)? */
  secretSet!: boolean | null;
  source!: 'UI' | 'ENV' | 'DEFAULT';
  reason!: string;
  uiValuePresent!: boolean;
  uiValueInvalid!: boolean;
  restartRequired!: boolean;
  /**
   * Only for restart settings: the validated UI value that only becomes
   * active after a restart. Until then `effectiveValue`/`source` describe
   * the actually active value – the restart value is never presented as
   * already active.
   */
  pendingRestartValue!: string | number | boolean | null;
  uiUpdatedAt!: string | null;
  uiUpdatedBy!: string | null;
}
