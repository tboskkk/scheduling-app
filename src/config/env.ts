/// <reference types="vite/client" />

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  environment: import.meta.env.VITE_APP_ENVIRONMENT || 'development',
  enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
  allowedEmailDomains: (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || '').split(',').filter(Boolean),
};

export const validateEnv = (config = env) => {
  const required = ['supabaseUrl', 'supabaseKey'];
  const missing = required.filter((key) => !config[key as keyof typeof config]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (config.supabaseUrl && !config.supabaseUrl.startsWith('https://')) {
    throw new Error('Supabase URL must use HTTPS');
  }
};
