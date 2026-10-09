import { env } from '../config/env';

export type DemoConfig = {
  demoMode: boolean;
  demoManagerEmail: string;
  demoEmployeeEmail: string;
  demoPassword: string;
};

// Demo mode only counts as on when the flag is set AND all three credentials
// are present, so a half-configured build shows no broken demo buttons.
const isDemoEnabled = (config: DemoConfig): boolean =>
  config.demoMode &&
  [config.demoManagerEmail, config.demoEmployeeEmail, config.demoPassword].every(
    (value) => Boolean(value.trim()),
  );

export const getDemoConfig = (): DemoConfig => {
  const config: DemoConfig = {
    demoMode: env.demoMode,
    demoManagerEmail: env.demoManagerEmail,
    demoEmployeeEmail: env.demoEmployeeEmail,
    demoPassword: env.demoPassword,
  };
  return { ...config, demoMode: isDemoEnabled(config) };
};

export const isDemoUser = (
  email: string | null | undefined,
  config: DemoConfig = getDemoConfig(),
): boolean => {
  if (!isDemoEnabled(config) || !email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return [config.demoManagerEmail, config.demoEmployeeEmail]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
};
