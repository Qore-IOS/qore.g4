'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Calendar, History, ArrowLeft } from 'lucide-react';

export default function NobetYonetimiPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/30">
              <Calendar className="h-8 w-8 text-orange-500" />
            </div>
            <h1 className="text-2xl font-bold text-orange-500">
              Nöbet Vardiyası Yönetimi
            </h1>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Vardiya Oluştur */}
          <Link href="/nobet-yonetimi/vardiya-olustur">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardContent className="flex flex-col items-center justify-center p-8 text-center">
                <div className="p-4 rounded-full bg-orange-100 dark:bg-orange-900/30 mb-4">
                  <Plus className="h-10 w-10 text-orange-500" />
                </div>
                <h2 className="text-lg font-semibold text-orange-500">
                  Vardiya Oluştur
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Yeni nöbet vardiyası tanımla
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Aktif Vardiyalar */}
          <Link href="/nobet-yonetimi/aktif-vardiyalar">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardContent className="flex flex-col items-center justify-center p-8 text-center">
                <div className="p-4 rounded-full bg-orange-100 dark:bg-orange-900/30 mb-4">
                  <Calendar className="h-10 w-10 text-orange-500" />
                </div>
                <h2 className="text-lg font-semibold text-orange-500">
                  Aktif Vardiyalar
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Devam eden vardiyaları görüntüle
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Geçmiş */}
          <Link href="/nobet-yonetimi/gecmis">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardContent className="flex flex-col items-center justify-center p-8 text-center">
                <div className="p-4 rounded-full bg-orange-100 dark:bg-orange-900/30 mb-4">
                  <History className="h-10 w-10 text-orange-500" />
                </div>
                <h2 className="text-lg font-semibold text-orange-500">
                  Geçmiş
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Tamamlanan vardiyaları incele
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
