import { SetMetadata } from '@nestjs/common';

/** Metadata key used by SessionAuthGuard to skip session checks. */
export const PUBLIC_ROUTE_KEY = 'isPublicRoute';

/**
 * Mark a route handler (or entire controller) as publicly accessible,
 * bypassing the global {@link SessionAuthGuard}.
 */
export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
