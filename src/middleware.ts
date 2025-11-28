import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API whitelist: prevent auth redirects for these paths
  if (pathname.startsWith('/api/kumulatif/extract')) {
    return NextResponse.next();
  }
   if (pathname.startsWith('/api/kumulatif/extract-server')) {
    return NextResponse.next();
  }

  // ... your existing auth/routing rules ...
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
