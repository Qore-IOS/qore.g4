
'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Build usage URL from pieces
 */
export function buildUsageUrl(labId?: string, pointId?: string) {
  if (!labId) return '/urun-kullanim';
  return pointId ? `/urun-kullanim/${labId}/${pointId}` : `/urun-kullanim/${labId}`;
}

/**
 * Keeps URL <-> selection state in sync for the Product Usage page.
 */
export function useUsageRouteSync(
  selectedHospitalId: string,
  setSelectedHospitalId: (v: string) => void,
  selectedPointId: string,
  setSelectedPointId: (v: string) => void
) {
  const router = useRouter();
  const pathname = usePathname();
  const lastPushed = useRef<string | null>(null);

  // 1) On mount & whenever the path changes (via back/forward), reflect it to state.
  useEffect(() => {
    if (!pathname) return;

    const parts = pathname.split('/').filter(Boolean);
    const labIdFromUrl = parts[1] || '';
    const pointIdFromUrl = parts[2] || '';

    if (labIdFromUrl && labIdFromUrl !== selectedHospitalId) {
      setSelectedHospitalId(labIdFromUrl);
    }
    
    if (pointIdFromUrl !== selectedPointId) {
      setSelectedPointId(pointIdFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 2) Public callbacks to be used by the selectors.
  const onHospitalSelect = (labId: string) => {
    setSelectedHospitalId(labId);
    setSelectedPointId(''); // Clear sub-point when parent changes
    const target = buildUsageUrl(labId);
    if (lastPushed.current !== target) {
      lastPushed.current = target;
      router.push(target);
    }
  };

  const onPointSelect = (pointId: string) => {
    if (!selectedHospitalId) return; // guard
    setSelectedPointId(pointId);
    const target = buildUsageUrl(selectedHospitalId, pointId);
    if (lastPushed.current !== target) {
      lastPushed.current = target;
      router.push(target);
    }
  };

  const onPointClear = () => {
    if (!selectedHospitalId) return;
    setSelectedPointId('');
    const target = buildUsageUrl(selectedHospitalId);
    if (lastPushed.current !== target) {
      lastPushed.current = target;
      router.push(target);
    }
  };

  return {
    onHospitalSelect,
    onPointSelect,
    onPointClear,
  };
}
