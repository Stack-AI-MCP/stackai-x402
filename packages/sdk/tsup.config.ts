import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/internal/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
})
