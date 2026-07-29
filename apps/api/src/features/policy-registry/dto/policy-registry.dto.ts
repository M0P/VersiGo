import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsNumber,
  Min,
  IsBoolean,
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

export class CreatePortalAccountLinkDto {
  @IsString()
  providerKey!: string;

  @IsOptional()
  @IsString()
  portalUrl?: string;

  @IsOptional()
  @IsString()
  usernameHint?: string;

  @IsOptional()
  @IsBoolean()
  mailboxCapability?: boolean;

  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;
}

export class UpdatePortalAccountLinkDto {
  @IsOptional()
  @IsString()
  providerKey?: string;

  @IsOptional()
  @IsString()
  portalUrl?: string;

  @IsOptional()
  @IsString()
  usernameHint?: string;

  @IsOptional()
  @IsBoolean()
  mailboxCapability?: boolean;

  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;
}
