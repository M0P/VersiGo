import { defineConfig } from 'vitest/config';

// BugFix-23: explicit `include` keeps the compiled specs out of the test run.
// This package compiles its tests into `dist` (`tsconfig.json` includes all of
// `src`), and since Vitest 5 those CommonJS files can no longer be imported –
// they failed the whole package. Mirrors the convention of `apps/api`,
// `apps/worker` and `apps/web`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
