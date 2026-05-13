'use client';

import { useParams } from 'next/navigation';
import TotalVerimlilikHesapDetayPanel from '@/components/total-verimlilik-hesap-detay-panel';

export default function TotalVerimlilikHesapDetayPage() {
  const params = useParams();
  const recordId = (params?.id as string) ?? '';
  const labId = (params?.labId as string) ?? '';

  return <TotalVerimlilikHesapDetayPanel recordId={recordId} labId={decodeURIComponent(labId)} />;
}
