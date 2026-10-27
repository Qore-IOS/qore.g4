'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/data/client';
import { doc, onSnapshot, setDoc } from '../lib/data/client';

export interface IconMappings {
  dock: Record<string, string>;       // dock item key -> icon filename
  mobile: Record<string, string>;     // dock item key -> icon filename
  envanter: Record<string, string>;   // category name -> icon filename
}

const EMPTY: IconMappings = { dock: {}, mobile: {}, envanter: {} };

export function useIconMappings() {
  const [mappings, setMappings] = useState<IconMappings>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const unsub = onSnapshot(
        doc(db, 'settings', 'iconMappings'),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as Partial<IconMappings>;
            setMappings({
              dock: data.dock || {},
              mobile: data.mobile || {},
              envanter: data.envanter || {},
            });
          } else {
            setMappings(EMPTY);
          }
          setLoading(false);
        },
        () => {
          setMappings(EMPTY);
          setLoading(false);
        }
      );
      return unsub;
    } catch {
      setMappings(EMPTY);
      setLoading(false);
    }
  }, []);

  const updateMapping = useCallback(
    async (category: keyof IconMappings, key: string, iconFile: string | null) => {
      const next = { ...mappings };
      if (iconFile) {
        next[category] = { ...next[category], [key]: iconFile };
      } else {
        const copy = { ...next[category] };
        delete copy[key];
        next[category] = copy;
      }
      setMappings(next);
      await setDoc(doc(db, 'settings', 'iconMappings'), next, { merge: true });
    },
    [mappings]
  );

  return { mappings, loading, updateMapping };
}

/** Get icon src for a given mapping value */
export function getIconSrc(iconFile: string): string {
  return `/icons/${iconFile}`;
}
