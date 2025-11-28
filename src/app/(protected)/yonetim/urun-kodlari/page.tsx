'use client';
import UrunKoduPanel from '@/components/yonetim/urun-kodu-panel';
import BackButton from '@/components/BackButton';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { BookText } from 'lucide-react';

export default function UrunKodlariPage() {
  const router = useRouter();

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <BackButton fallback="/yonetim/tanimlar" />
        <Button onClick={() => router.push('/yonetim/urun-kodlari/tanimlar')} size="sm" variant="secondary">
            <BookText className="mr-2 h-4 w-4"/>
            Tanımlamaları Yönet
        </Button>
      </div>
      <UrunKoduPanel />
    </div>
  );
}
