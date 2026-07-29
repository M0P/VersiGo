import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CostTrackingController, CostTrackingHouseholdController } from './cost-tracking.controller';
import { CostTrackingService } from './cost-tracking.service';

@Module({
  imports: [IdentityModule],
  controllers: [CostTrackingController, CostTrackingHouseholdController],
  providers: [CostTrackingService],
})
export class CostTrackingModule {}
