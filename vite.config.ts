import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Vite only auto-loads `VITE_`-prefixed vars into `import.meta.env`, and
  // never into `process.env`. Server-only code (e.g. AVANZA_MCP_ENABLED in
  // marketDataService.ts) reads `process.env` directly, so load `.env`
  // (unfiltered — empty prefix) into it here.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    resolve: {
      alias: {
        // Mirrors the `~/*` path mapping in tsconfig.json.
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      watch: {
        // Probe artefacts and generated meeting packs are written while the
        // server runs; watching them once crashed the server (EBUSY on a file
        // PowerPoint was still writing) and would reload nothing useful.
        ignored: ['**/.probe/**', '**/.generated/**', '**/release/**'],
      },
    },
    plugins: [
      tailwindcss(),
      // tanstackStart() must come before the React plugin.
      tanstackStart(),
      viteReact(),
    ],
  }
})
