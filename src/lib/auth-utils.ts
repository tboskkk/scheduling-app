import { env } from '../config/env';

// Common temporary/disposable email domains to block
const BLOCKED_DOMAINS = [
  '10minutemail.com', 'tempmail.org', 'guerrillamail.com', 'mailinator.com',
  'throwaway.email', 'temp-mail.org', 'yopmail.com', 'maildrop.cc',
  'sharklasers.com', 'guerrillamailblock.com', 'pokemail.net', 'spam4.me'
];

// Common legitimate business email patterns
const BUSINESS_PATTERNS = [
  /^[a-zA-Z0-9.-]+\.(com|org|net|edu|gov|mil)$/,  // Standard TLDs
  /^[a-zA-Z0-9.-]+\.(co\.[a-z]{2})$/,             // Country codes like .co.uk
  /^[a-zA-Z0-9.-]+\.(corp|inc|llc|ltd)$/,         // Business suffixes
];

// Major email providers (generally acceptable for business use)
const MAJOR_PROVIDERS = [
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'protonmail.com', 'fastmail.com', 'zoho.com'
];

export const isEmailAllowed = (email: string, allowedDomains: string[] = env.allowedEmailDomains): boolean => {
  // If specific domains are configured, use the original whitelist approach
  if (allowedDomains && allowedDomains.length > 0) {
    if (!email || !email.includes('@')) return false;
    const domain = email.split('@')[1];
    return allowedDomains.includes(domain);
  }
  
  // Basic email validation
  if (!email || !email.includes('@')) return false;
  
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  
  // Block known temporary/disposable email services
  if (BLOCKED_DOMAINS.includes(domain)) return false;
  
  // Allow major email providers
  if (MAJOR_PROVIDERS.includes(domain)) return true;
  
  // Allow domains that match business patterns
  return BUSINESS_PATTERNS.some(pattern => pattern.test(domain));
};
