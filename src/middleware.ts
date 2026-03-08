import { NextRequest, NextResponse } from 'next/server';
import { getAuthDecision, COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Extract session cookie
  const cookieToken = request.cookies.get(COOKIE_NAME)?.value ?? null;

  const decision = await getAuthDecision({ pathname, bearerToken, cookieToken });

  if (decision === 'pass') {
    return NextResponse.next();
  }

  if (decision === 'deny-api') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // deny-page: redirect to login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('returnUrl', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)'],
};
