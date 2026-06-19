'use client';
import UrunTalepPanel from '@/components/urun-talep-panel';

export default function DepoUrunTalepPage({ params }: { params: { id: string } }) {
  return <UrunTalepPanel depotRequestId={params.id} />;
}
