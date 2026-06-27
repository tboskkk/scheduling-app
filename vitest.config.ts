import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setupEnv.ts'],
    env: {
      VITE_SUPABASE_PROJECT_URL: process.env.VITE_SUPABASE_PROJECT_URL ?? 'https://placeholder.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder-anon-key',
    },
  },
})
