import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/accept-invitation'];

/**
 * UX convenience only: send visitors without a session cookie to the sign-in page.
 * Whether the session is valid is decided by the API on every request.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.has('ot_session')) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?returnTo=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|robots.txt).*)'],
};
