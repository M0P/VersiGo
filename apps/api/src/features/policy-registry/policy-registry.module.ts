import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PortalConnectorsModule } from '../portal-connectors/portal-connectors.module';
import { PolicyRegistryController } from './policy-registry.controller';
import { PolicyRegistryService } from './policy-registry.service';

@Module({
  imports: [IdentityModule, PortalConnectorsModule],
  controllers: [PolicyRegistryController],
  providers: [PolicyRegistryService],
})
export class PolicyRegistryModule {}
