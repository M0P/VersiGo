import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SettingsFoundationModule } from '@versigo/foundation';
import { PaperlessNgxService } from './paperless-ngx.service';
import { PaperlessController } from './paperless-ngx.controller';
import { PAPERLESS_ADAPTER } from './paperless-ngx.interface';

/**
 * Provider for the PAPERLESS_ADAPTER injection token.
 *
 * Since AP-17 the activation of Paperless is decided per call via the
 * central settings resolution (PAPERLESS_ENABLED). The adapter degrades
 * itself in a controlled way (null/empty results) when Paperless is
 * disabled or incompletely configured. A separate NoOp adapter is
 * therefore no longer needed.
 *
 * Consumers should inject via @Inject(PAPERLESS_ADAPTER) to stay
 * independent of the concrete implementation.
 */
const adapterProvider = {
  provide: PAPERLESS_ADAPTER,
  useFactory: (paperlessService: PaperlessNgxService) => paperlessService,
  inject: [PaperlessNgxService],
};

@Module({
  imports: [HttpModule, SettingsFoundationModule],
  controllers: [PaperlessController],
  providers: [PaperlessNgxService, adapterProvider],
  exports: [PAPERLESS_ADAPTER],
})
export class PaperlessNgxModule {}

export { PAPERLESS_ADAPTER } from './paperless-ngx.interface';
export type { IPaperlessAdapter, PaperlessDocumentRef, PaperlessDocumentMetadata, PaperlessSyncResult, PaperlessSearchResult } from './paperless-ngx.interface';
