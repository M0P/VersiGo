import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/** AP-22: paginated tag search (server-side filtering in Paperless). */
export class SearchPaperlessTagsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  @Type(() => Number)
  page?: number;
}

/**
 * AP-22: create a new tag in Paperless. The name is required – a tag is
 * never created without a deliberate user action.
 */
export class CreatePaperlessTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;
}

/**
 * AP-22: assign (or change) the policy tag. Only the external tag ID is a
 * stable reference; the name is an optional display cache and is never
 * trusted for identification.
 */
export class SetPolicyPaperlessTagDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @Type(() => Number)
  tagId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tagName?: string;
}

/** AP-22: retry a failed external tag assignment (optionally one document). */
export class RetryPaperlessTaggingDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentId?: string;
}
