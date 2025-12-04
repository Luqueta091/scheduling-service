import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'tests/setup/setupEnv.ts')],
    minWorkers: 1,
    maxWorkers: 1,
    isolate: true,
    testTimeout: 120_000,
    reporters: 'default'
  }
});
