import { env } from '../config/env';

export type LogLevel = 'info' | 'warn' | 'error' | 'critical';

export interface LogEvent {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  error?: Error;
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'key',
  'authorization',
  'cookie',
];

class Logger {
  private sanitize(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      // console.warn(`Sanitizing key: ${key}, value: ${value}`);
      if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error) {
    const timestamp = new Date().toISOString();
    const sanitizedContext = context ? this.sanitize(context) : undefined;

    const event: LogEvent = {
      level,
      message,
      context: sanitizedContext as Record<string, unknown>,
      timestamp,
      error,
    };

    // In production, we might want to send this to a logging service
    // For now, we'll log to the console with appropriate styling
    
    if (env.VITE_APP_ENVIRONMENT === 'test') {
        // minimal logging in test
        return; 
    }

    const style = {
      info: 'color: #00bfff',
      warn: 'color: #ffa500',
      error: 'color: #ff4500',
      critical: 'color: #ff0000; font-weight: bold',
    }[level];

    console.groupCollapsed(`%c[${level.toUpperCase()}] ${message}`, style);
    console.log('Timestamp:', timestamp);
    if (sanitizedContext) console.log('Context:', sanitizedContext);
    if (error) console.error('Error:', error);
    console.groupEnd();
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>) {
    this.log('error', message, context, error);
  }

  critical(message: string, error?: Error, context?: Record<string, unknown>) {
    this.log('critical', message, context, error);
  }

  security(message: string, context?: Record<string, unknown>) {
    this.log('warn', `[SECURITY] ${message}`, context);
  }
}

export const logger = new Logger();
