
'use client';
import React, { useState, useEffect } from 'react';
import CihazTanimlamaClient from '@/components/CihazTanimlamaClient';
import { getDeviceImages } from '@/actions/stokActions';
import { Loader2 } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital } from '@/lib/types';

export default function CihazTanimlamalariPage() {
  const [imageFiles, setImageFiles] = useState<string[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [images, hospitalsSnap] = await Promise.all([
          getDeviceImages(),
          getDocs(collection(db, 'hospitals'))
        ]);
        setImageFiles(images);
        setHospitals(hospitalsSnap.docs.map(d => ({id: d.id, ...d.data()} as Hospital)));
      } catch (error) {
        console.error("Error loading data for device definitions page:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4">Veriler Yükleniyor...</p>
      </div>
    );
  }

  return <CihazTanimlamaClient images={imageFiles} hospitals={hospitals} />;
}
