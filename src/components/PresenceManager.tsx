
'use client';

import { useEffect } from 'react';
import { startPresence } from '@/lib/presence-client';

/**
 * A client component that activates the new RTDB-based presence system when the app mounts.
 */
export default function PresenceManager() {
  useEffect(() => {
    startPresence();
  }, []);
  
  return null;
}
