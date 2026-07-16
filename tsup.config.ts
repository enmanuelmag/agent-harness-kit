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
  dts:       true,
  sourcemap: true,
  clean:     true,
  external:  ['better-sqlite3'],
  // tsup resolves path aliases from tsconfig.json automatically
})
