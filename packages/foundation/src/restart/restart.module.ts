import { Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { RestartCoordinatorService } from './restart-coordinator.service';

/**
 * Foundation-Modul fuer den Redis-gestuetzten Neustart-Koordinator
 * (BugFix-06, Teil 3.4). Global importierbar ueber `RestartFoundationModule`;
 * wird von der API (Anforderung + kontrollierter Prozess-Exit) und vom
 * Worker (Watcher fuer die Anforderung) genutzt.
 */
@Module({
  imports: [ConfigFoundationModule],
  providers: [RestartCoordinatorService],
  exports: [RestartCoordinatorService],
})
export class RestartFoundationModule {}
