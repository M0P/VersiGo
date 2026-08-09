import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Audit & activity (AP-19): read-only audit access for ADMINs.
 * Writing audit events still happens directly via the
 * existing feature services; new actions use `AuditService.record`.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
