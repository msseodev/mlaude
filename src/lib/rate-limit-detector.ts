import type { ClaudeEvent, RateLimitInfo } from './types';

export class RateLimitDetector {
  private rateLimitPatterns = [
    /usage limit reached/i,
    /rate_limit_error/i,
    /rate limit/i,
    /too many requests/i,
    /overloaded/i,
    /hit your limit/i,
    /you've hit your limit/i,
    /out of .* usage/i,
  ];

  /**
   * Parse reset time from messages like "resets 11am (Asia/Seoul)" or "resets 2:30pm (US/Eastern)"
   * Returns milliseconds until the reset time, or null if not parseable.
   */
  parseResetTime(text: string): number | null {
    const match = text.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3].toLowerCase();
    const timezone = match[4].trim();

    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    try {
      const now = new Date();

      // Get current date/time components in the target timezone
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);

      const getPart = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
      const currentHour = getPart('hour');
      const currentMinute = getPart('minute');

      const resetMinutes = hours * 60 + minutes;
      const currentMinutes = currentHour * 60 + currentMinute;

      let diffMs: number;
      if (resetMinutes > currentMinutes) {
        diffMs = (resetMinutes - currentMinutes) * 60 * 1000;
      } else {
        // Reset time is tomorrow in the target timezone
        diffMs = (24 * 60 - currentMinutes + resetMinutes) * 60 * 1000;
      }

      // Add 60s buffer to avoid retrying right at the boundary
      diffMs += 60 * 1000;

      // Sanity check: at least 1 min, at most 24 hours
      if (diffMs < 60 * 1000) diffMs = 60 * 1000;
      if (diffMs > 24 * 60 * 60 * 1000) return null;

      return diffMs;
    } catch {
      // Invalid timezone or parsing error
      return null;
    }
  }

  checkExitCode(code: number | null): RateLimitInfo {
    // Exit code alone is not a reliable rate limit indicator.
    // Code 124 is timeout, not rate limit. Other non-zero codes
    // could be various errors, not necessarily rate limits.
    return {
      detected: false,
      source: null,
      message: null,
      retryAfterMs: null,
    };
  }

  checkStreamEvent(event: ClaudeEvent): RateLimitInfo {
    const notDetected: RateLimitInfo = {
      detected: false,
      source: null,
      message: null,
      retryAfterMs: null,
    };

    // Check for error-type events
    if (event.type === 'error' || (event.type === 'result' && 'is_error' in event && event.is_error)) {
      const eventStr = JSON.stringify(event);
      for (const pattern of this.rateLimitPatterns) {
        if (pattern.test(eventStr)) {
          return {
            detected: true,
            source: 'stream_event',
            message: eventStr,
            retryAfterMs: this.parseResetTime(eventStr),
          };
        }
      }
    }

    // Check subtype for rate_limit
    if ('subtype' in event && typeof event.subtype === 'string' && event.subtype === 'rate_limit') {
      const eventStr = JSON.stringify(event);
      return {
        detected: true,
        source: 'stream_event',
        message: eventStr,
        retryAfterMs: this.parseResetTime(eventStr),
      };
    }

    return notDetected;
  }

  checkText(text: string): RateLimitInfo {
    for (const pattern of this.rateLimitPatterns) {
      if (pattern.test(text)) {
        return {
          detected: true,
          source: 'text_pattern',
          message: text.slice(0, 500),
          retryAfterMs: this.parseResetTime(text),
        };
      }
    }

    return {
      detected: false,
      source: null,
      message: null,
      retryAfterMs: null,
    };
  }
}
