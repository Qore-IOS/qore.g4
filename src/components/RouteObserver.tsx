'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

// Paths that we should not save as the "last visited" route
const INVALID_PATHS = ['/login', '/logout', '/error'];

export function RouteObserver() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    // Do not save public, auth-related, or the root path
    if (pathname === '/' || INVALID_PATHS.some((path) => pathname.startsWith(path))) {
      return;
    }

    // Save the valid protected route to local storage
    localStorage.setItem('last_path', pathname);
  }, [pathname]);

  return null; // This component renders nothing, it's just for logic
}
