import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
  // AP-22 follow-up: trim the name before validation. A whitespace-only name
  // is invalid input (400), not a refusal by Paperless (502) – without the
  // trim the adapter would send an empty tag name and report a rejection.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
