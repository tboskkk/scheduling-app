import { env } from '../config/env';

export type DemoConfig = {
  demoMode: boolean;
  demoManagerEmail: string;
  demoEmployeeEmail: string;
  demoPassword: string;
};

export const getDemoConfig = (): DemoConfig => ({
  demoMode: env.demoMode,
  demoManagerEmail: env.demoManagerEmail,
  demoEmployeeEmail: env.demoEmployeeEmail,
  demoPassword: env.demoPassword,
});

export const isDemoUser = (
  email: string | null | undefined,
  config: DemoConfig = getDemoConfig(),
): boolean => {
  if (!config.demoMode || !email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return [config.demoManagerEmail, config.demoEmployeeEmail]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
};
