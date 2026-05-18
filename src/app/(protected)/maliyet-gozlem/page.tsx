'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const MaliyetGozlemMerkezi = dynamic(() => import('@/components/maliyet-gozlem/MaliyetGozlemMerkezi'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

export default function MaliyetGozlemPage() {
  return <MaliyetGozlemMerkezi initialTab="test" />;
}
