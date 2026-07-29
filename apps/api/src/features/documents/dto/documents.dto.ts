import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { DocumentStorageType } from '@prisma/client';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;
}

export class UpdateDocumentMetadataDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsEnum(DocumentStorageType)
  storageType?: DocumentStorageType;
}
