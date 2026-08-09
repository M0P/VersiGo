import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/pending', '/forbidden', '/callback', '/_next', '/favicon.ico', '/runtime-config.js'];

// Edge middleware: denies unauthenticated UI calls (session protection per
// docs/07-security-privacy.md). Only checks for the presence of the
// HttpOnly session cookie; the actual validation happens server-side in
// the API on every data access.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('versigo.sid');
  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image).*)'],
};
