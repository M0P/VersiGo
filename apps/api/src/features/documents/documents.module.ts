import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PaperlessNgxModule } from '../paperless-ngx/paperless-ngx.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [IdentityModule, PaperlessNgxModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
