import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC preserves decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ['test/setup.ts'],
  },
});
