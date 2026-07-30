import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { FamilySharingController } from './family-sharing.controller';
import { FamilySharingService } from './family-sharing.service';

@Module({
  imports: [IdentityModule],
  controllers: [FamilySharingController],
  providers: [FamilySharingService],
  exports: [FamilySharingService],
})
export class FamilySharingModule {}
