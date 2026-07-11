import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'app-out/main',
      rollupOptions: {
        input: resolve(__dirname, 'main-process/main.ts'),
        external: ['sql.js']
      }
    }
  },
  preload: {
    build: {
      outDir: 'app-out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main-process/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'app-out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [react()]
  }
})
