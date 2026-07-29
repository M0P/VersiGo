import { IsString, IsEnum, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';
import { PaymentFrequency } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateCostEntryDto {
  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  grossAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  netAmount?: number;

  @IsEnum(PaymentFrequency)
  frequency!: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateCostEntryDto {
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  netAmount?: number;

  @IsOptional()
  @IsEnum(PaymentFrequency)
  frequency?: PaymentFrequency;

  @IsOptional()
  @IsString()
  bookingSource?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
