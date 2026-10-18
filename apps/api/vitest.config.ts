import { defineConfig } from 'vitest/config';

// BugFix-23: pins the collected test set to the TypeScript sources. For
// `apps/api`, `tsconfig.build.json` excludes `**/*.spec.ts` (and tests), so an
// in-image `apps/api/dist` cannot contain compiled specs; the explicit
// `include` is therefore defensive and keeps this package consistent with
// `apps/worker` and `apps/web`. The guard is load-bearing for
// `packages/foundation` because its `tsconfig.json` includes all of `src` and
// compiles tests into `dist`. The Docker build context no longer receives host
// `apps/*/dist` (depth-agnostic `**/dist/` in `.dockerignore`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});