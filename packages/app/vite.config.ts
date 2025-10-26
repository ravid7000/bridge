import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  plugins: [nxViteTsPaths()],
  build: {
    outDir: '../../dist/packages/app',
    emptyOutDir: true
  }
})
