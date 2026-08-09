import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CapabilityFlagsService } from '@versigo/foundation';

/**
 * Feature switch for family sharing (BugFix-05).
 *
 * If an admin disables `FAMILY_SHARING_ENABLED` via feature management
 * (category runtime, takes effect immediately), ALL family-sharing
 * endpoints return 403, regardless of role or household membership. The
 * share list thus stays locked even for existing members until the
 * switch is active again.
 */
@Injectable()
export class FamilySharingGuard implements CanActivate {
  constructor(private readonly capabilities: CapabilityFlagsService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    if (!(await this.capabilities.isEnabled('familySharing'))) {
      throw new ForbiddenException(
        'Family sharing is disabled (FAMILY_SHARING_ENABLED=false)',
      );
    }
    return true;
  }
}
