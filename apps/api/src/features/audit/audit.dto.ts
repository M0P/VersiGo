import { IsString, Length, IsOptional, IsInt, Min, Max, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filter fuer die Audit-Event-Liste (AP-19).
 * Zeitfilter sind ISO-8601-Zeitstempel (z. B. 2026-08-01T12:00:00Z);
 * die Filter sind optional und begrenzt, um grosse Listen zu vermeiden.
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
