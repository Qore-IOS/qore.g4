'use client';
import UrunTalepGecmisPanel from '@/components/urun-talep-gecmis-panel';

export default function DepoUrunTalepGecmisPage({ params }: { params: { id: string } }) {
  return <UrunTalepGecmisPanel depotId={params.id} />;
}
