import { IsString, IsOptional, IsDateString, MinLength } from 'class-validator';

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
