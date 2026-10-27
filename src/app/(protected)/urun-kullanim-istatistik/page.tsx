'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import UrunKullanimIstatistikPanel from '@/components/urun-kullanim-istatistik-panel';
import { db } from '../../../lib/data/client';
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp
} from '../../../lib/data/client';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { DateRangeFilterBar } from '@/components/common/DateRangeFilterBar';

// Types from your app schema
import type {
  Hospital,
  ProductCode,
  DepoStokItem,
  ConsumptionRecord
} from '@/lib/types';

export default function UrunKullanimIstatistikPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hospitalStockItems, setHospitalStockItems] = useState<DepoStokItem[]>([]);
  const [tuketimKayitlari, setTuketimKayitlari] = useState<ConsumptionRecord[]>([]);

  // İstatistik penceresi — varsayılan son 180 gün. Tüketim her gün artar.
  const dateFilter = useDateRangeFilter({
    defaultDays: 180,
    storageKey: 'urun-kullanim-istatistik:range',
  });

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [
        hospitalsSnap,
        productCodesSnap,
        hospitalStockSnap,
        consumptionSnap
      ] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        // Hospitals' on-hand stock (items shipped to hospitals)
        getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true))),
        getDocs(scopedQuery(
          'tuketimKayitlari',
          currentCompanyId,
          isSuperAdmin,
          ...dateFilter.constraints('consumptionTimestamp'),
        ))
      ]);

      setHospitals(filterByCompanyScope(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)), currentCompanyId, isSuperAdmin));
      setProductCodes(filterByCompanyScope(productCodesSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)), currentCompanyId, isSuperAdmin));

      setHospitalStockItems(
        filterByCompanyScope(
          hospitalStockSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        )
      );

      // Normalize Firestore Timestamp -> Date for consumption
      const normalizedConsumption = consumptionSnap.docs.map(d => {
        const raw = d.data() as any;
        if (raw?.consumptionTimestamp instanceof Timestamp) {
          raw.consumptionTimestamp = raw.consumptionTimestamp.toDate();
        }
        return { id: d.id, ...raw } as ConsumptionRecord;
      });
      setTuketimKayitlari(filterByCompanyScope(normalizedConsumption, currentCompanyId, isSuperAdmin));
    } catch (err) {
      console.error('UrunKullanimIstatistikPage fetch error:', err);
      toast({
        title: 'Veri Yükleme Hatası',
        description: 'İstatistikler için gerekli veriler alınamadı.',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin, dateFilter.range]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Panel prop #1: hospitalStockCounts -> group by hospital name
  const hospitalStockCounts: Record<string, DepoStokItem[]> = useMemo(() => {
    const map: Record<string, DepoStokItem[]> = {};
    for (const item of hospitalStockItems) {
      const key = (item as any).hedefKurum || '';
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }, [hospitalStockItems]);

  // Panel prop #2: urunKullanimKayitlari -> map tuketimKayitlari to the legacy DepoStok-like shape
  const urunKullanimKayitlariLike: DepoStokItem[] = useMemo(() => {
    return tuketimKayitlari.map((k) => {
      const fallbackDate = k.consumptionTimestamp
      ? (typeof k.consumptionTimestamp === 'object' && 'toDate' in k.consumptionTimestamp
          ? (k.consumptionTimestamp as { toDate: () => Date }).toDate()
          : new Date(k.consumptionTimestamp as string | number | Date))
      : null;
      return {
        id: (k as any).id || `${k.stokKodu}-${k.seriNumarasi || ''}-${k.lotNumarasi || ''}`,
        stokKodu: k.stokKodu,
        stokAdi: k.stokAdi,
        seriNumarasi: (k as any).seriNumarasi || '',
        lotNumarasi: (k as any).lotNumarasi || '',
        miad: (k as any).miad || '',
        hedefKurum: (k as any).laboratoryName || '',
        sevkTarihi: fallbackDate,
      } as DepoStokItem;
    });
  }, [tuketimKayitlari]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <DateRangeFilterBar
        range={dateFilter.range}
        setRange={dateFilter.setRange}
        label="Tüketim penceresi"
      />
      <UrunKullanimIstatistikPanel
        hospitals={hospitals}
        urunKullanimKayitlari={tuketimKayitlari}
        productCodes={productCodes}
        toast={(opts: any) => toast(opts)}
      />
    </div>
  );
}
