import { Controller, Get, Param, Query } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditEventsQueryDto } from './audit.dto';

/**
 * Audit event API (AP-19). Global ADMINs only.
 * - `GET /admin/audit/events` – filtered, paginated list (without diffJson contents)
 * - `GET /admin/audit/events/:id` – detail incl. redacted diffJson
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
