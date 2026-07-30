import { IsString, IsBoolean, IsArray, ValidateNested, IsDateString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class StartExtractionDto {
  @IsString()
  policyId!: string;
}

export class SetDocumentExclusionDto {
  @IsString()
  documentId!: string;

  @IsBoolean()
  excluded!: boolean;
}

export class AiHealthCheckResponseDto {
  @IsBoolean()
  connected!: boolean;

  @IsString()
  provider!: string;
}

export class SourceDocumentInfo {
  @IsString()
  id!: string;

  @IsString()
  fileName!: string;
}

export class CoverageSummaryResponseDto {
  @IsString()
  id!: string;

  @IsString()
  policyId!: string;

  @IsString()
  providerKey!: string;

  @IsOptional()
  @IsString()
  model!: string | null;

  @IsString()
  summaryMarkdown!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceDocumentInfo)
  sourceDocuments!: SourceDocumentInfo[];

  @IsDateString()
  createdAt!: string;
}
