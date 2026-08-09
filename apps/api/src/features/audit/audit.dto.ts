import { IsString, Length, IsOptional, IsInt, Min, Max, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filters for the audit event list (AP-19).
 * Time filters are ISO-8601 timestamps (e.g. 2026-08-01T12:00:00Z);
 * the filters are optional and limited to avoid large lists.
 */
export class ListAuditEventsQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  entityType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  action?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  actorUserId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
