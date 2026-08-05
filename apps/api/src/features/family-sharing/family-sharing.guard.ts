import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CapabilityFlagsService } from '@versigo/foundation';

/**
 * Feature-Schalter fuer Familien-Freigaben (BugFix-05).
 *
 * Deaktiviert ein Admin `FAMILY_SHARING_ENABLED` ueber die Feature-
 * Verwaltung (Kategorie runtime, wirkt sofort), liefern ALLE
 * Family-Sharing-Endpunkte 403, unabhaengig von Rolle oder
 * Household-Mitgliedschaft. Die Freigabe-Liste bleibt damit auch fuer
 * bestehende Mitglieder gesperrt, bis der Schalter wieder aktiv ist.
 */
@Injectable()
export class FamilySharingGuard implements CanActivate {
  constructor(private readonly capabilities: CapabilityFlagsService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    if (!(await this.capabilities.isEnabled('familySharing'))) {
      throw new ForbiddenException(
        'Familien-Freigaben sind deaktiviert (FAMILY_SHARING_ENABLED=false)',
      );
    }
    return true;
  }
}
