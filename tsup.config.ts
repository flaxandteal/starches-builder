import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  define: {
    __STARCHES_BUILDER_VERSION__: JSON.stringify(pkg.version),
  },
});
