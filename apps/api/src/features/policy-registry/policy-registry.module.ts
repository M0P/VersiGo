import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PolicyRegistryController } from './policy-registry.controller';
import { PolicyRegistryService } from './policy-registry.service';

@Module({
  imports: [IdentityModule],
  controllers: [PolicyRegistryController],
  providers: [PolicyRegistryService],
})
export class PolicyRegistryModule {}
