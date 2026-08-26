/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // The project lives in an iCloud-synced folder; sync passes churn file
      // metadata and can fire spurious watcher events in storms. Debounce so
      // only real, settled writes trigger HMR.
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
