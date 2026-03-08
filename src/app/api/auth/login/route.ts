import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthEnabled,
  verifyApiKey,
  createSessionToken,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    if (!isAuthEnabled()) {
      return NextResponse.json(
        { error: 'Auth not enabled' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { key } = body;

    if (!key || !(await verifyApiKey(key))) {
      return NextResponse.json(
        { error: 'Invalid key' },
        { status: 401 }
      );
    }

    const token = await createSessionToken();

    const isSecure = request.nextUrl.protocol === 'https:';

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Failed to process login' },
      { status: 500 }
    );
  }
}
