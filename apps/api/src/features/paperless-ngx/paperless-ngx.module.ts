import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CapabilityFlagsService } from '@insura/foundation';
import { PaperlessNgxService } from './paperless-ngx.service';
import { NoOpPaperlessAdapter } from './paperless-ngx.noop';
import type { IPaperlessAdapter } from './paperless-ngx.interface';
import { PAPERLESS_ADAPTER } from './paperless-ngx.interface';

/**
 * Provider fuer den PAPERLESS_ADAPTER-Injection-Token.
 *
 * Wenn Paperless per CapabilityFlag aktiviert ist, wird die echte
 * PaperlessNgxService-Instanz injiziert. Andernfalls wird ein
 * NoOpPaperlessAdapter injiziert, der bei jedem Aufruf null
 * bzw. leere Ergebnisse zurueckgibt und niemals Fehler wirft.
 *
 * Konsumenten sollten per @Inject(PAPERLESS_ADAPTER) injizieren,
 * um unabhaengig von der konkreten Implementierung zu bleiben.
 */
const adapterProvider = {
  provide: PAPERLESS_ADAPTER,
  useFactory: (
    capabilityFlags: CapabilityFlagsService,
    paperlessService: PaperlessNgxService,
  ): IPaperlessAdapter => {
    return capabilityFlags.isEnabled('paperless')
      ? paperlessService
      : new NoOpPaperlessAdapter();
  },
  inject: [CapabilityFlagsService, PaperlessNgxService],
};

@Module({
  imports: [HttpModule],
  providers: [PaperlessNgxService, adapterProvider],
  exports: [PAPERLESS_ADAPTER],
})
export class PaperlessNgxModule {}

export { PAPERLESS_ADAPTER } from './paperless-ngx.interface';
export type { IPaperlessAdapter, PaperlessDocumentRef, PaperlessDocumentMetadata, PaperlessSyncResult, PaperlessSearchResult } from './paperless-ngx.interface';
