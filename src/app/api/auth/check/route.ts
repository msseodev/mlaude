import { NextRequest, NextResponse } from 'next/server';
import { isAuthEnabled, verifySessionToken, COOKIE_NAME } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authEnabled = isAuthEnabled();

  if (!authEnabled) {
    return NextResponse.json({ authenticated: true, authEnabled: false });
  }

  // Check Bearer token
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (await verifySessionToken(token)) {
      return NextResponse.json({ authenticated: true, authEnabled: true });
    }
  }

  // Check cookie
  const cookieToken = request.cookies.get(COOKIE_NAME)?.value ?? '';
  if (cookieToken && (await verifySessionToken(cookieToken))) {
    return NextResponse.json({ authenticated: true, authEnabled: true });
  }

  return NextResponse.json({ authenticated: false, authEnabled: true });
}
