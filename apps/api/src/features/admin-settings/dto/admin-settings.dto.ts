import {
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
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

// --- Global Feature Flags ---

export class CreateGlobalFeatureFlagDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateGlobalFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;
}

// --- Household Feature Flags ---

export class CreateHouseholdFeatureFlagDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateHouseholdFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;
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
