
'use client';

import React from 'react';
import BackButton from '@/components/BackButton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import Orb from '@/components/Orb';

export default function LisansVeSurumPage() {
  return (
    <div className="p-6 space-y-6 relative min-h-screen flex items-center justify-center">
      <div className="fixed inset-0 -z-10">
        <Orb
          hoverIntensity={0.5}
          rotateOnHover={true}
          hue={220}
          forceHoverState={false}
        />
      </div>
      <div className="absolute top-6 left-6">
        <BackButton fallback="/yonetim" />
      </div>
      <Card className="max-w-lg w-full">
        <CardHeader className="p-6 flex flex-col items-center gap-4">
          <Image
            src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
            alt="Qore Engine Logo"
            width={200}
            height={200}
            className="object-contain"
          />
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">Lisans ve sürüm detayları bu alanda gösterilecektir.</p>
        </CardContent>
      </Card>
    </div>
  );
}
