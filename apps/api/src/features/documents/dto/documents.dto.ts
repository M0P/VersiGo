import { IsString, IsOptional, IsDateString, MinLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;
}

export class UpdateDocumentMetadataDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;
}

// BugFix-07 (Q3): Paperless-Dokument per ID an eine Versicherung binden.
export class CreatePaperlessLinkDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @Type(() => Number)
  paperlessDocumentId!: number;
}
