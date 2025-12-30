import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'

if (!env.supabaseUrl || !env.supabaseKey) {
  throw new Error(
    'Supabase environment variables are missing. Define VITE_SUPABASE_PROJECT_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabase = createClient(env.supabaseUrl, env.supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
})
