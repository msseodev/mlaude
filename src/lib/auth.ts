const SESSION_HMAC_PAYLOAD = 'mlaude-session-v1';
const COOKIE_NAME = 'mlaude_session';
const COOKIE_MAX_AGE = 604800; // 7 days

export type AuthDecision = 'pass' | 'deny-api' | 'deny-page';

export interface AuthDecisionInput {
  pathname: string;
  bearerToken: string | null;
  cookieToken: string | null;
}

function getApiKey(): string {
  return process.env.MLAUDE_API_KEY ?? '';
}

export function isAuthEnabled(): boolean {
  const key = getApiKey();
  return key.length > 0;
}

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getHmacKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(getApiKey());
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Creates a session token by HMAC-signing a fixed payload with the API key.
 *
 * The token is static per API key: the same key always produces the same token.
 * Changing the API key invalidates all existing sessions.
 * This is an intentional trade-off for simplicity in a local automation tool.
 */
export async function createSessionToken(): Promise<string> {
  const encoder = new TextEncoder();
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(SESSION_HMAC_PAYLOAD));
  return hexEncode(signature);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  if (!token) {
    return false;
  }
  try {
    const expected = await createSessionToken();
    return await timingSafeEqual(token, expected);
  } catch {
    return false;
  }
}

export async function verifyApiKey(key: string): Promise<boolean> {
  const expected = getApiKey();
  return await timingSafeEqual(key, expected);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i];
  }
  return result === 0;
}

const EXCLUDED_PATHS = [
  '/login',
  '/api/auth/',
  '/_next/',
  '/icons/',
  '/manifest.json',
  '/sw.js',
  '/favicon.ico',
];

function isExcludedPath(pathname: string): boolean {
  return EXCLUDED_PATHS.some(
    (excluded) => pathname === excluded || pathname.startsWith(excluded)
  );
}

export async function getAuthDecision(input: AuthDecisionInput): Promise<AuthDecision> {
  if (!isAuthEnabled()) {
    return 'pass';
  }

  if (isExcludedPath(input.pathname)) {
    return 'pass';
  }

  const isApi = input.pathname.startsWith('/api/');

  // Check bearer token (primarily for API routes, but accept it anywhere)
  if (input.bearerToken) {
    if (await verifyApiKey(input.bearerToken)) {
      return 'pass';
    }
    if (await verifySessionToken(input.bearerToken)) {
      return 'pass';
    }
  }

  // Check cookie token
  if (input.cookieToken) {
    const valid = await verifySessionToken(input.cookieToken);
    if (valid) {
      return 'pass';
    }
  }

  return isApi ? 'deny-api' : 'deny-page';
}

export { COOKIE_NAME, COOKIE_MAX_AGE };
