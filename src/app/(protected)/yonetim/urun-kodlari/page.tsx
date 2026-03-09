'use client';
import UrunKoduPanel from '@/components/yonetim/urun-kodu-panel';
import BackButton from '@/components/BackButton';
import { useRouter } from 'next/navigation';
import { BookText } from 'lucide-react';

export default function UrunKodlariPage() {
  const router = useRouter();

  return (
    <div className="dashboard-neu-page min-h-screen p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-center">
        <BackButton fallback="/yonetim/tanimlar" />
        <button
          onClick={() => router.push('/yonetim/urun-kodlari/tanimlar')}
          className="neu-btn-universal px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
        >
          <BookText className="h-4 w-4 text-[var(--dashboard-muted)]" />
          <span>Tanımlamaları Yönet</span>
        </button>
      </div>
      <UrunKoduPanel />
    </div>
  );
}
