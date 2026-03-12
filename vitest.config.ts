import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pyramid-os/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@pyramid-os/logger': path.resolve(__dirname, 'packages/logger/src/logger.ts'),
      '@pyramid-os/data-layer': path.resolve(__dirname, 'packages/data-layer/src/index.ts'),
      '@pyramid-os/orchestration': path.resolve(__dirname, 'packages/orchestration/src/index.ts'),
      '@pyramid-os/society-engine': path.resolve(__dirname, 'packages/society-engine/src/index.ts'),
      '@pyramid-os/api': path.resolve(__dirname, 'packages/api/src/index.ts'),
      '@pyramid-os/blueprint': path.resolve(__dirname, 'packages/blueprint/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
