
'use client';
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/BackButton';

export default function IzinYonetimiPage() {
    return (
        <div className="p-4">
            <BackButton fallback="/yonetim/personel-yonetimi" />
            <Card className="mt-4">
                <CardHeader>
                    <CardTitle>İzin Yönetimi</CardTitle>
                    <CardDescription>Bu sayfa geliştirme aşamasındadır.</CardDescription>
                </CardHeader>
            </Card>
        </div>
    );
}
