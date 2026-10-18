import {
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsDateString,
  IsOptional,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * AP-24 (§3.1): optional narrowing of the AI coverage summary.
 *
 * Without `documentIds` the historic behaviour is kept (all documents of the
 * policy that are not excluded from AI processing). With `documentIds` only
 * CONTRACT documents of that policy are accepted; everything else is rejected
 * instead of silently summarizing something else.
 */
export class SummarizeCoverageDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  documentIds?: string[];

  /**
   * Set after the user confirmed that documents which cannot be read are left
   * out. Without it the API refuses the request and names the documents.
   */
  @IsOptional()
  @IsBoolean()
  acceptPartial?: boolean;
}


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

  /**
   * AP-24 (§3.2): `json` for summaries in the structured format, `markdown`
   * for rows created before AP-24.
   */
  @IsString()
  format!: 'json' | 'markdown';

  @IsString()
  summaryMarkdown!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceDocumentInfo)
  sourceDocuments!: SourceDocumentInfo[];

  @IsDateString()
  createdAt!: string;
}
