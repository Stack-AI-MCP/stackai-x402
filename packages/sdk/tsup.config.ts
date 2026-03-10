import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/internal/index.ts', 'src/client/index.ts', 'src/hooks/index.ts', 'src/moltbook/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
})
