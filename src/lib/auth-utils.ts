import { env } from '../config/env';

export const isEmailAllowed = (email: string, allowedDomains: string[] = env.allowedEmailDomains): boolean => {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  
  // Basic email validation
  if (!email || !email.includes('@')) return false;
  
  const domain = email.split('@')[1];
  return allowedDomains.includes(domain);
};
