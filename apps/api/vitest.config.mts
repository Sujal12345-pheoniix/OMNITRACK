import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required because esbuild cannot emit the decorator metadata NestJS relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Integration files share one test database and one Redis: run files one at a time.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.e2e.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
