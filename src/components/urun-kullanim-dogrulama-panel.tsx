'use client';
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function UrunKullanimDogrulamaPanel() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          Ürün Kullanım Doğrulama (Geçici Panel)
        </CardTitle>
        <CardDescription>
          Bu panel şu an uyumluluk modunda çalışıyor. Asıl doğrulama bileşeni hazır olduğunda bu dosyayı kaldırabilirsiniz.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Barkod doğrulama iş akışınız etkilenmeden build alınabilsin diye bu geçici panel yüklendi.
        </p>
      </CardContent>
    </Card>
  );
}
