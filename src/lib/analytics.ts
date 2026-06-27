import { env } from '../config/env';
import { logger } from './logger';

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

class Analytics {
  private initialized = false;
  private enabled = false;

  init() {
    if (this.initialized) return;
    
    // Check if analytics is enabled via env var
    this.enabled = env.enableAnalytics;
    this.initialized = true;

    if (this.enabled) {
      logger.info('Analytics initialized');
    }
  }

  track(eventName: string, properties?: Record<string, unknown>) {
    if (!this.initialized) this.init();
    if (!this.enabled) return;

    // In a real implementation, this would send data to an analytics provider
    // For now, we'll just log it if we're in development
    if (env.environment === 'development') {
      logger.info(`[Analytics] ${eventName}`, properties);
    }
  }

  pageView(path: string) {
    this.track('page_view', { path });
  }

  identify(userId: string, traits?: Record<string, unknown>) {
    if (!this.initialized) this.init();
    if (!this.enabled) return;

    // Don't log PII in development
    if (env.environment === 'development') {
      logger.info(`[Analytics] Identify user`, { userId, ...traits });
    }
  }
}

export const analytics = new Analytics();
