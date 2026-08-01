import { Controller, Get, Param, Query } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditEventsQueryDto } from './audit.dto';

/**
 * Audit-Event-API (AP-19). Nur globale ADMINs.
 * - `GET /admin/audit/events` – gefilterte, paginierte Liste (ohne diffJson-Inhalte)
 * - `GET /admin/audit/events/:id` – Detail inkl. redigiertem diffJson
 */
@Controller('admin/audit')
@Roles(GlobalRole.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  async listEvents(
    @Query() query: ListAuditEventsQueryDto,
  ): Promise<ReturnType<AuditService['listEvents']>> {
    return this.audit.listEvents(query);
  }

  @Get('events/:id')
  async getEvent(
    @Param('id') id: string,
  ): Promise<ReturnType<AuditService['getEvent']>> {
    return this.audit.getEvent(id);
  }
}
