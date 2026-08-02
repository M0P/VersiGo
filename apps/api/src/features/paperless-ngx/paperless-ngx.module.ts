import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SettingsFoundationModule } from '@versigo/foundation';
import { PaperlessNgxService } from './paperless-ngx.service';
import { PAPERLESS_ADAPTER } from './paperless-ngx.interface';

/**
 * Provider fuer den PAPERLESS_ADAPTER-Injection-Token.
 *
 * Seit AP-17 wird die Aktivierung von Paperless pro Aufruf ueber die
 * zentrale Settings-Aufloesung (PAPERLESS_ENABLED) entschieden. Der
 * Adapter degradiert selbst kontrolliert (null/leere Ergebnisse), wenn
 * Paperless deaktiviert oder unvollstaendig konfiguriert ist. Ein
 * separater NoOp-Adapter ist daher nicht mehr noetig.
 *
 * Konsumenten sollten per @Inject(PAPERLESS_ADAPTER) injizieren,
 * um unabhaengig von der konkreten Implementierung zu bleiben.
 */
const adapterProvider = {
  provide: PAPERLESS_ADAPTER,
  useFactory: (paperlessService: PaperlessNgxService) => paperlessService,
  inject: [PaperlessNgxService],
};

@Module({
  imports: [HttpModule, SettingsFoundationModule],
  providers: [PaperlessNgxService, adapterProvider],
  exports: [PAPERLESS_ADAPTER],
})
export class PaperlessNgxModule {}

export { PAPERLESS_ADAPTER } from './paperless-ngx.interface';
export type { IPaperlessAdapter, PaperlessDocumentRef, PaperlessDocumentMetadata, PaperlessSyncResult, PaperlessSearchResult } from './paperless-ngx.interface';
