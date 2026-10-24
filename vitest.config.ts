import { defineConfig } from 'vitest/config';

// Node tests load server modules directly; the browser dev server retains its source-file deny list.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
