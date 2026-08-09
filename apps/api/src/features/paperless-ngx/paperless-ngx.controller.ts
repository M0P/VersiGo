import { Controller, Get, Query } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Inject } from '@nestjs/common';
import { PAPERLESS_ADAPTER, IPaperlessAdapter, PaperlessSearchResult } from './paperless-ngx.interface';
import { Roles } from '../identity/roles.decorator';

/**
 * BugFix-07 (Q3): live search in Paperless-ngx for the policy detail view.
 * The adapter degrades in a controlled way (empty result) when Paperless
 * is disabled or unreachable.
 */
class PaperlessSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  // Paperless' own query syntax allows field filters (e.g. type:1) and
  // full-text terms. We allow a broad alphabet (no risky encoding needed -
  // the term is URL-encoded before forwarding) but limit the length to
  // 200 characters.
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
