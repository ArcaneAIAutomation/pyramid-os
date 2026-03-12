import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@pyramid-os/society-engine': path.resolve(
        __dirname,
        '../society-engine/src/index.ts',
      ),
    },
  },
});
