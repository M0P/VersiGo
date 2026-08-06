import { Controller, Get, Query } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Inject } from '@nestjs/common';
import { PAPERLESS_ADAPTER, IPaperlessAdapter, PaperlessSearchResult } from './paperless-ngx.interface';
import { Roles } from '../identity/roles.decorator';

/**
 * BugFix-07 (Q3): Live-Suche in Paperless-ngx fuer die Policy-Detailansicht.
 * Der Adapter degradiert kontrolliert (leeres Ergebnis), wenn Paperless
 * deaktiviert oder nicht erreichbar ist.
 */
class PaperlessSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  // Paperless' eigene Query-Syntax erlaubt Feldfilter (z.B. type:1) und
  // Volltextbegriffe. Wir erlauben ein breites Alphabet (kein riskantes
  // Encoding noetig – der Begriff wird vor der Weitergabe URL-encodiert),
  // beschraenken aber die Laenge auf 200 Zeichen.
  @Matches(/^[\w\s.:",'-]{0,200}$/)
  search?: string;
}

@Controller('paperless')
export class PaperlessController {
  constructor(
    @Inject(PAPERLESS_ADAPTER) private readonly paperless: IPaperlessAdapter,
  ) {}

  @Get('documents')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async search(@Query() query: PaperlessSearchQueryDto): Promise<PaperlessSearchResult[]> {
    const term = (query.search ?? '').trim();
    if (!term) return [];
    return this.paperless.searchDocuments(term);
  }
}
