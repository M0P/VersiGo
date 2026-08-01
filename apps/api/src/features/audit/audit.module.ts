import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Audit & Activity (AP-19): lesbarer Audit-Zugriff fuer ADMINs.
 * Das Schreiben von Audit-Events erfolgt weiterhin direkt ueber die
 * bestehenden Feature-Services; neue Aktionen nutzen `AuditService.record`.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
