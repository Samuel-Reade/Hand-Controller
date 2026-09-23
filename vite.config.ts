/// <reference types="vitest/config" />
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// MediaPipe's wasm runtime is served from the installed @mediapipe/tasks-vision
// rather than a copy in public/: the copy was byte-identical to the package's
// wasm/ dir, weighed 34 MB in git, and could drift from the pinned version.
// Dev serves it at <base>mediapipe/wasm/; build emits it to the same path.
// The models in public/models/ are not in the npm package and stay there.
const WASM_ROUTE = 'mediapipe/wasm/'
const wasmDir = join(
  dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')),
  'wasm',
)

function mediapipeWasm(): Plugin {
  let base = '/'
  return {
    name: 'mediapipe-wasm',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const prefix = base + WASM_ROUTE
        if (!path.startsWith(prefix)) return next()
        const file = path.slice(prefix.length)
        if (!readdirSync(wasmDir).includes(file)) return next()
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        )
        res.end(readFileSync(join(wasmDir, file)))
      })
    },
    generateBundle() {
      for (const file of readdirSync(wasmDir)) {
        this.emitFile({
          type: 'asset',
          fileName: WASM_ROUTE + file,
          source: readFileSync(join(wasmDir, file)),
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  // Rally monorepo port scheme: each app owns a 3x00 dev port and a 3x01 test
  // port (community 3100/3101, vendor 3200/3201). The map is 3300/3301.
  // strictPort so a clash fails loudly instead of drifting to the next port,
  // where scripts/verify-*.mjs would not find it.
  server: { port: 3300, strictPort: true },
  preview: { port: 3301, strictPort: true },
  // The watcher ran with awaitWriteFinish (400ms) while the project lived in
  // an iCloud-synced folder, to absorb sync-driven event storms. The project
  // moved out of iCloud (DECISIONS.md, 2026-09-02), so the debounce is gone
  // and HMR fires on the write again.
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
