import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli:   'src/cli.ts',
    index: 'src/index.ts',
  },
  outDir:    'dist',
  format:    'esm',
  target:    'node22',
  platform:  'node',
  sourcemap: true,
  clean:     true,
  // tsup resolves path aliases from tsconfig.json automatically
})
