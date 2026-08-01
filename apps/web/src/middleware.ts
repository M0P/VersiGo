import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/pending', '/forbidden', '/callback', '/_next', '/favicon.ico'];

// Edge-Middleware: verweigert nicht authentifizierte UI-Aufrufe (Session-Schutz
// gemaess docs/07-security-privacy.md). Prueft nur auf Vorhandensein des
// HttpOnly-Session-Cookies; die eigentliche Validierung erfolgt serverseitig
// in der API bei jedem Datenzugriff.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('insura.sid');
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
