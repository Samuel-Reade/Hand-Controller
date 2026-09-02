/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The watcher ran with awaitWriteFinish (400ms) while the project lived in
  // an iCloud-synced folder, to absorb sync-driven event storms. The project
  // moved out of iCloud (DECISIONS.md, 2026-09-02), so the debounce is gone
  // and HMR fires on the write again.
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
