import { IsString, IsOptional, IsDateString, MinLength, IsInt, Min, Max, IsEnum, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentClass } from '@prisma/client';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  // AP-24 (§2): optional bei der Erstellung wählbare Klasse; ohne Angabe
  // gilt der Spalten-Default UNCLASSIFIED. Ein ungültiger Schlüssel führt
  // zu einem validierten 400-Fehler, nicht zu einem Prisma-Laufzeitfehler.
  @IsOptional()
  @IsEnum(DocumentClass)
  documentClass?: DocumentClass;
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

  // AP-24 (§2): nachträgliche Klassifikation in den Dokumentdetails.
  @IsOptional()
  @IsEnum(DocumentClass)
  documentClass?: DocumentClass;
}

// AP-24 (§2.3): Mehrfachauswahl – Änderung der Klasse mehrerer Dokumente
// in einem Schritt. Die IDs sind begrenzt, damit ein missbräuchlicher
// Aufruf keine unbegrenzte Schreiblast erzeugt.
export class BulkClassifyDocumentsDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  documentIds!: string[];

  @IsEnum(DocumentClass)
  documentClass!: DocumentClass;
}

// AP-24 (§2.3): filter for the document list. All parameters are optional
// so existing clients keep working unchanged.
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum(DocumentClass)
  documentClass?: DocumentClass;
}

// BugFix-07 (Q3): bind a Paperless document to a policy by ID.
export class CreatePaperlessLinkDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @Type(() => Number)
  paperlessDocumentId!: number;
}
