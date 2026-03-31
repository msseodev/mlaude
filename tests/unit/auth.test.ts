import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  verifyApiKey,
  isAuthEnabled,
  getAuthDecision,
} from '@/lib/auth';

describe('auth', () => {
  const TEST_API_KEY = 'test-secret-key-12345';

  beforeEach(() => {
    process.env.MLAUDE_API_KEY = TEST_API_KEY;
  });

  afterEach(() => {
    delete process.env.MLAUDE_API_KEY;
  });

  describe('createSessionToken', () => {
    it('should return a hex string', async () => {
      const token = await createSessionToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe('verifySessionToken', () => {
    it('should return true for valid token', async () => {
      const token = await createSessionToken();
      const result = await verifySessionToken(token);
      expect(result).toBe(true);
    });

    it('should return false for invalid/tampered token', async () => {
      const result = await verifySessionToken('deadbeef1234567890abcdef');
      expect(result).toBe(false);
    });

    it('should return false for empty string', async () => {
      const result = await verifySessionToken('');
      expect(result).toBe(false);
    });
  });

  describe('verifyApiKey', () => {
    it('should return true for matching key', async () => {
      const result = await verifyApiKey(TEST_API_KEY);
      expect(result).toBe(true);
    });

    it('should return false for wrong key', async () => {
      const result = await verifyApiKey('wrong-key');
      expect(result).toBe(false);
    });
  });

  describe('isAuthEnabled', () => {
    it('should return false when env var not set', () => {
      delete process.env.MLAUDE_API_KEY;
      expect(isAuthEnabled()).toBe(false);
    });

    it('should return true when env var is set', () => {
      process.env.MLAUDE_API_KEY = TEST_API_KEY;
      expect(isAuthEnabled()).toBe(true);
    });

    it('should return false when env var is empty string', () => {
      process.env.MLAUDE_API_KEY = '';
      expect(isAuthEnabled()).toBe(false);
    });
  });

  describe('getAuthDecision', () => {
    it('should return "pass" when auth disabled', async () => {
      delete process.env.MLAUDE_API_KEY;
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /login', async () => {
      const result = await getAuthDecision({
        pathname: '/login',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /api/auth/login', async () => {
      const result = await getAuthDecision({
        pathname: '/api/auth/login',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /api/auth/check', async () => {
      const result = await getAuthDecision({
        pathname: '/api/auth/check',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /_next/static/chunk.js', async () => {
      const result = await getAuthDecision({
        pathname: '/_next/static/chunk.js',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /manifest.json', async () => {
      const result = await getAuthDecision({
        pathname: '/manifest.json',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /favicon.ico', async () => {
      const result = await getAuthDecision({
        pathname: '/favicon.ico',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /sw.js', async () => {
      const result = await getAuthDecision({
        pathname: '/sw.js',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for excluded path /icons/icon.png', async () => {
      const result = await getAuthDecision({
        pathname: '/icons/icon.png',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "deny-api" for unauthenticated API request', async () => {
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('deny-api');
    });

    it('should return "deny-page" for unauthenticated page request', async () => {
      const result = await getAuthDecision({
        pathname: '/prompts',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('deny-page');
    });

    it('should return "pass" for valid Bearer token on API', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: token,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for raw API key as Bearer token', async () => {
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: TEST_API_KEY,
        cookieToken: null,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for valid cookie on page', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision({
        pathname: '/prompts',
        bearerToken: null,
        cookieToken: token,
      });
      expect(result).toBe('pass');
    });

    it('should return "pass" for valid cookie on API', async () => {
      const token = await createSessionToken();
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: null,
        cookieToken: token,
      });
      expect(result).toBe('pass');
    });

    it('should return "deny-page" for invalid cookie on page', async () => {
      const result = await getAuthDecision({
        pathname: '/prompts',
        bearerToken: null,
        cookieToken: 'invalid-token',
      });
      expect(result).toBe('deny-page');
    });

    it('should return "deny-api" for invalid Bearer token on API', async () => {
      const result = await getAuthDecision({
        pathname: '/api/prompts',
        bearerToken: 'invalid-token',
        cookieToken: null,
      });
      expect(result).toBe('deny-api');
    });

    it('should return "deny-page" for root path without auth', async () => {
      const result = await getAuthDecision({
        pathname: '/',
        bearerToken: null,
        cookieToken: null,
      });
      expect(result).toBe('deny-page');
    });
  });
});
