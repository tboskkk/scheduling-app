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
      chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // React core libraries
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor'
            }
            
            // Router
            if (id.includes('react-router')) {
              return 'router'
            }
            
            // Supabase
            if (id.includes('@supabase')) {
              return 'supabase'
            }
            
            // PDF renderer (likely large)
            if (id.includes('@react-pdf/renderer')) {
              return 'pdf-renderer'
            }
            
            // DnD Kit
            if (id.includes('@dnd-kit')) {
              return 'dnd-kit'
            }
            
            // TanStack Query
            if (id.includes('@tanstack/react-query')) {
              return 'react-query'
            }
            
            // Zustand
            if (id.includes('zustand')) {
              return 'zustand'
            }
            
            // Other node_modules
            if (id.includes('node_modules')) {
              return 'vendor'
            }
          }
        }
      }
    }
  }
})
