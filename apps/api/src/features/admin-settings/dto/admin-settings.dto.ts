import {
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';

// --- Global Integration Settings ---

export class CreateGlobalSettingDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsString()
  valuePlain?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

export class UpdateGlobalSettingDto {
  @IsOptional()
  @IsString()
  valuePlain?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

// --- Household Integration Settings ---

export class CreateHouseholdSettingDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsString()
  valuePlain?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

export class UpdateHouseholdSettingDto {
  @IsOptional()
  @IsString()
  valuePlain?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

// --- Connectivity Test ---

export class ConnectivityTestDto {
  @IsString()
  integrationKey!: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  apiToken?: string;
}

// --- Connectivity Test Result ---

export class ConnectivityTestResultDto {
  success!: boolean;
  message!: string;
  timestamp!: string;
}

// --- Dienste-Neustart (BugFix-06, Teil 3.4) ---

export class RestartServicesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
