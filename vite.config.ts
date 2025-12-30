import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Environment variable validation
  const requiredEnvVars = [
    'VITE_SUPABASE_PROJECT_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY'
  ];

  if (mode === 'production') {
    const missingVars = requiredEnvVars.filter(key => !env[key]);
    if (missingVars.length > 0) {
      console.warn(`Warning: Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            ui: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities']
          }
        }
      }
    }
  }
})
