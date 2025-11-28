'use client';
import UrunKullanimPanel from '@/components/urun-kullanim-panel';

// This page handles all routes under /urun-kullanim/, including:
// /urun-kullanim
// /urun-kullanim/[labId]
// /urun-kullanim/[labId]/[pointId]
export default function DynamicUrunKullanimPage() {
    return <UrunKullanimPanel />;
}
