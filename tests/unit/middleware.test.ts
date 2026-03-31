import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAuthDecision, createSessionToken } from '@/lib/auth';
import type { AuthDecisionInput } from '@/lib/auth';

describe('middleware auth decision', () => {
  const TEST_API_KEY = 'middleware-test-key-99999';

  beforeEach(() => {
    process.env.MLAUDE_API_KEY = TEST_API_KEY;
  });

  afterEach(() => {
    delete process.env.MLAUDE_API_KEY;
  });

  function makeInput(overrides: Partial<AuthDecisionInput> = {}): AuthDecisionInput {
    return {
      pathname: '/api/prompts',
      bearerToken: null,
      cookieToken: null,
      ...overrides,
    };
  }

  describe('auth disabled', () => {
    it('should return "pass" when auth is disabled', async () => {
      delete process.env.MLAUDE_API_KEY;
      const result = await getAuthDecision(makeInput({ pathname: '/api/prompts' }));
      expect(result).toBe('pass');
    });

    it('should return "pass" for page routes when auth is disabled', async () => {
      delete process.env.MLAUDE_API_KEY;
      const result = await getAuthDecision(makeInput({ pathname: '/settings' }));
      expect(result).toBe('pass');
    });
  });

  describe('excluded paths', () => {
    const excludedPaths = [
      '/login',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/check',
      '/_next/static/chunks/main.js',
      '/_next/data/build-id/page.json',
      '/icons/apple-touch-icon.png',
      '/manifest.json',
      '/sw.js',
      '/favicon.ico',
    ];

    for (const path of excludedPaths) {
      it(`should return "pass" for excluded path: ${path}`, async () => {
        const result = await getAuthDecision(makeInput({ pathname: path }));
        expect(result).toBe('pass');
      });
    }
  });

  describe('unauthenticated requests', () => {
    it('should return "deny-api" for unauthenticated API request', async () => {
      const result = await getAuthDecision(makeInput({ pathname: '/api/prompts' }));
      expect(result).toBe('deny-api');
    });

    it('should return "deny-api" for unauthenticated API sub-route', async () => {
      const result = await getAuthDecision(makeInput({ pathname: '/api/run/status' }));
      expect(result).toBe('deny-api');
    });

    it('should return "deny-page" for unauthenticated page request', async () => {
      const result = await getAuthDecision(makeInput({ pathname: '/prompts' }));
      expect(result).toBe('deny-page');
    });

    it('should return "deny-page" for root path', async () => {
      const result = await getAuthDecision(makeInput({ pathname: '/' }));
      expect(result).toBe('deny-page');
    });

    it('should return "deny-page" for settings page', async () => {
      const result = await getAuthDecision(makeInput({ pathname: '/settings' }));
      expect(result).toBe('deny-page');
    });
  });

  describe('authenticated requests', () => {
    it('should return "pass" for valid Bearer token on API route', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision(
        makeInput({ pathname: '/api/prompts', bearerToken: token })
      );
      expect(result).toBe('pass');
    });

    it('should return "pass" for valid cookie on API route', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision(
        makeInput({ pathname: '/api/prompts', cookieToken: token })
      );
      expect(result).toBe('pass');
    });

    it('should return "pass" for valid cookie on page route', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision(
        makeInput({ pathname: '/prompts', cookieToken: token })
      );
      expect(result).toBe('pass');
    });

    it('should return "pass" for valid cookie on root path', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision(
        makeInput({ pathname: '/', cookieToken: token })
      );
      expect(result).toBe('pass');
    });

    it('should return "pass" for raw API key as Bearer token', async () => {
      const result = await getAuthDecision(
        makeInput({ pathname: '/api/prompts', bearerToken: TEST_API_KEY })
      );
      expect(result).toBe('pass');
    });

    it('should deny invalid Bearer token on API', async () => {
      const result = await getAuthDecision(
        makeInput({ pathname: '/api/run', bearerToken: 'bad-token' })
      );
      expect(result).toBe('deny-api');
    });

    it('should deny invalid cookie on page', async () => {
      const result = await getAuthDecision(
        makeInput({ pathname: '/history', cookieToken: 'bad-cookie' })
      );
      expect(result).toBe('deny-page');
    });
  });
});
