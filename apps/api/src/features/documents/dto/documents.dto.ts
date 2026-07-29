import { IsString, IsOptional, IsDateString, IsEnum, MinLength } from 'class-validator';
import { DocumentStorageType } from '@prisma/client';

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

  @IsOptional()
  @IsEnum(DocumentStorageType)
  storageType?: DocumentStorageType;
}
