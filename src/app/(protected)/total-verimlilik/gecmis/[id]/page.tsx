'use client';

import { useParams } from 'next/navigation';
import TotalVerimlilikGecmisDetayPanel from '@/components/total-verimlilik-gecmis-detay-panel';

export default function TotalVerimlilikGecmisDetayPage() {
  const params = useParams();
  const recordId = (params?.id as string) ?? '';

  return <TotalVerimlilikGecmisDetayPanel recordId={recordId} />;
}
