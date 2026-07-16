'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { MlStyles, useContainerMode, type Mode } from '@/components/maliyet/ml-primitives';
import { MlHome } from '@/components/maliyet/ml-screens';

export default function CostDashboardPage() {
  const router = useRouter();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mode: Mode = useContainerMode(rootRef);

  return (
    <div ref={rootRef} className="ml-root" style={{ minHeight: '100vh', width: '100%' }}>
      <MlStyles />
      <div style={{ padding: mode === 'mobile' ? '16px 14px 40px' : '24px 30px 48px' }}>
        <MlHome
          mode={mode}
          go={(r: string) => router.push(r === 'gecmis' ? '/cost-dashboard/gecmis' : '/maliyet-sayim')}
          goGozlem={() => router.push('/maliyet-gozlem')}
        />
      </div>
    </div>
  );
}
