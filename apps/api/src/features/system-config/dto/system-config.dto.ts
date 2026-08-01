import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO zum Setzen/Aendern eines UI-konfigurierbaren System-Settings.
 * Der Wert ist immer ein String; die Katalog-Validierung (Typ, Min/Max,
 * allowedValues) erfolgt serverseitig in SystemConfigService – die
 * Allowlist gilt ausnahmslos.
 */
export class UpdateSystemConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value!: string;
}

/**
 * Ergebnis einer sicheren Connectivity-Pruefung fuer eine Integration.
 * Enthaelt niemals Secrets oder Klartext-Konfigurationswerte.
 */
export class ConnectivityTestResultDto {
  success!: boolean;
  message!: string;
  timestamp!: string;
}

/**
 * Admin-UI-Ansicht eines katalogisierten Settings-Schluessels.
 * Secrets werden maskiert (`secret: true`, `secretSet` statt `effectiveValue`).
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
  /** Effektiver Wert; bei Secrets immer null (stattdessen secretSet). */
  effectiveValue!: string | number | boolean | null;
  /** Nur bei Secrets: ist ein Wert gesetzt (UI oder ENV)? */
  secretSet!: boolean | null;
  source!: 'UI' | 'ENV' | 'DEFAULT';
  reason!: string;
  uiValuePresent!: boolean;
  uiValueInvalid!: boolean;
  restartRequired!: boolean;
  /**
   * Nur bei restart-Settings: validierter UI-Wert, der erst nach einem
   * Neustart aktiv wird. `effectiveValue`/`source` beschreiben bis dahin
   * den tatsaechlich aktiven Wert – der Neustart-Wert wird nie als bereits
   * aktiv dargestellt.
   */
  pendingRestartValue!: string | number | boolean | null;
  uiUpdatedAt!: string | null;
  uiUpdatedBy!: string | null;
}
