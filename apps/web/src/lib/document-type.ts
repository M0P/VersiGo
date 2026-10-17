import type { IconName } from '@/components/ui/icons';

/**
 * BugFix-21: the type of a document is shown as an icon instead of the raw
 * MIME type text. The mapping is a pure function so it can be unit-tested
 * without rendering the document list.
 *
 * Sources are evaluated in this order:
 * 1. the MIME type (Paperless documents store `mime_type`, uploads store the
 *    detected MIME type),
 * 2. the file extension (a fallback for generic MIME types such as
 *    `application/octet-stream`).
 */
export type DocumentTypeKind = 'pdf' | 'image' | 'document' | 'spreadsheet' | 'other';

/** Catalog keys used as the accessible name of the type icon. */
export type DocumentTypeLabelKey =
  | 'policies.documentTypeKindPdf'
  | 'policies.documentTypeKindImage'
  | 'policies.documentTypeKindDocument'
  | 'policies.documentTypeKindSpreadsheet'
  | 'policies.documentTypeKindOther';

const MIME_KINDS: Record<string, DocumentTypeKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/rtf': 'document',
  'text/rtf': 'document',
  'text/plain': 'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
};

const EXTENSION_KINDS: Record<string, DocumentTypeKind> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
};

const ICONS: Record<DocumentTypeKind, IconName> = {
  pdf: 'filePdf',
  image: 'fileImage',
  document: 'fileDocument',
  spreadsheet: 'fileSpreadsheet',
  other: 'fileGeneric',
};

const LABEL_KEYS: Record<DocumentTypeKind, DocumentTypeLabelKey> = {
  pdf: 'policies.documentTypeKindPdf',
  image: 'policies.documentTypeKindImage',
  document: 'policies.documentTypeKindDocument',
  spreadsheet: 'policies.documentTypeKindSpreadsheet',
  other: 'policies.documentTypeKindOther',
};

/** Derives the document type from the MIME type and, as a fallback, the file name. */
export function documentTypeKind(
  mimeType: string | null | undefined,
  fileName?: string | null,
): DocumentTypeKind {
  const mime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'other';

  const byMime = MIME_KINDS[mime];
  if (byMime) return byMime;

  const name = typeof fileName === 'string' ? fileName.trim().toLowerCase() : '';
  const dot = name.lastIndexOf('.');
  if (dot > -1) {
    const byExtension = EXTENSION_KINDS[name.slice(dot + 1)];
    if (byExtension) return byExtension;
  }

  return 'other';
}

/** Icon of a document type. */
export function documentTypeIcon(kind: DocumentTypeKind): IconName {
  return ICONS[kind];
}

/** Localized, accessible name of a document type. */
export function documentTypeLabelKey(kind: DocumentTypeKind): DocumentTypeLabelKey {
  return LABEL_KEYS[kind];
}
