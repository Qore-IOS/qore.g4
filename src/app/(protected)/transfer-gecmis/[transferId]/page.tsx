/**
 * @fileoverview Transfer Detail Page
 * @description Displays detailed information about a specific transfer record.
 * @module app/(protected)/transfer-gecmis/[transferId]/page
 * @version 2.0.0
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getDocsResilient, getDocResilient } from '@/lib/firestore-network-recovery';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { Loader2, FileText, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import * as XLSX from 'xlsx';
import TransferTutanakPDFButton from '@/components/exports/TransferTutanakPDFButton';
import TimestampText from '@/components/TimestampText';
import { transferGecmisLogger } from '@/lib/logger';
import type { ProductCode } from '@/lib/types';


type TransferRoot = {
  id: string; // Add id to TransferRoot type
  sourceDepotName: string;
  targetName: string;
  userName?: string;
  timestamp?: any;
  mode?: 'borc' | 'lab';
  company?: string;
};

type TransferItem = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  anaBirim?: string;
  ambalajDegeri?: number | null;
};

export default function Page() {
  const params = useParams();
  const transferId = Array.isArray(params?.transferId) ? params.transferId[0] : params?.transferId;
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [root, setRoot] = useState<TransferRoot | null>(null);
  const [items, setItems] = useState<TransferItem[]>([]);
  const [productCodeMap, setProductCodeMap] = useState<Record<string, { anaBirim?: string; ambalajDegeri?: number | null }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!transferId) return; // Güvenlik kontrolü
    (async () => {
      try {
        const ref = doc(db, 'transfers', transferId);
        const snap = await getDocResilient(ref);
        if (!snap.exists()) {
          toast({ title: 'Bulunamadı', description: 'Transfer kaydı mevcut değil.', variant: 'destructive' });
          router.back();
          return;
        }
        const rootData = { id: snap.id, ...snap.data() } as TransferRoot; // Include id in rootData
        const itemsSnap = await getDocsResilient(collection(db, 'transfers', transferId, 'items'));
        const rows = itemsSnap.docs.map(d => d.data() as TransferItem);

        const stokKodlari = Array.from(new Set(rows.map((r) => r.stokKodu).filter(Boolean)));
        const metaMap: Record<string, { anaBirim?: string; ambalajDegeri?: number | null }> = {};
        if (stokKodlari.length > 0) {
          const chunkSize = 30;
          for (let i = 0; i < stokKodlari.length; i += chunkSize) {
            const chunk = stokKodlari.slice(i, i + chunkSize);
            const q = scopedQuery('productCodes', currentCompanyId, isSuperAdmin, where('stokKodu', 'in', chunk));
            const pSnap = await getDocsResilient(q);
            pSnap.docs.forEach((d) => {
              const data = d.data() as ProductCode;
              if (data.stokKodu) {
                metaMap[data.stokKodu] = {
                  anaBirim: data.anaBirim,
                  ambalajDegeri: data.ambalajDegeri ?? null,
                };
              }
            });
          }
        }

        if (!mounted) return;
        setRoot(rootData);
        setItems(rows);
        setProductCodeMap(metaMap);
      } catch (e) {
        transferGecmisLogger.error('Transfer detayları yüklenemedi', e, {
          transferId,
        });
        toast({ title: 'Hata', description: 'Transfer detayları yüklenemedi.', variant: 'destructive' });
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [transferId, router, toast]);

  const summary = useMemo(() => {
    const m = new Map<string, { stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string; adet: number; anaBirim?: string; ambalajDegeri?: number | null }>();
    for (const it of items) {
      const key = `${it.stokKodu}||${it.lotNumarasi}||${it.miad}`;
      const prev = m.get(key);
      if (prev) prev.adet += 1;
      else m.set(key, {
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi,
        miad: it.miad,
        adet: 1,
        anaBirim: it.anaBirim || productCodeMap[it.stokKodu]?.anaBirim,
        ambalajDegeri: it.ambalajDegeri ?? productCodeMap[it.stokKodu]?.ambalajDegeri ?? null,
      });
    }
    return Array.from(m.values());
  }, [items, productCodeMap]);
  
  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-[60vh]"
        role="status"
        aria-label="Transfer detayları yükleniyor"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Yükleniyor...</span>
      </div>
    );
  }

  return (
    <div
      className="space-y-6 p-4"
      role="main"
      aria-label="Transfer detay sayfası"
    >
      <div className="flex items-center justify-between">
        <BackButton fallback="/transfer-gecmis" aria-label="Geri dön" />
         {root && transferId && (
          <TransferTutanakPDFButton
            header={{
                shipmentId: transferId,
                depotName: root.sourceDepotName,
                kurumAdi: root.targetName,
                tarih: format(root.timestamp.toDate(), 'dd.MM.yyyy'),
                saat: format(root.timestamp.toDate(), 'HH:mm'),
                karsilayan: root.userName,
                company: root.mode === 'borc' ? root.company : undefined,
            }}
            rows={summary.map(s => ({
              stokKodu: s.stokKodu,
              urun: s.stokAdi,
              lot: s.lotNumarasi,
              miad: s.miad,
              adet: s.adet,
              anaBirim: s.anaBirim,
              ambalajDegeri: s.ambalajDegeri ?? null,
            }))}
          />
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Transfer Detayı: {transferId}</CardTitle>
          <CardDescription>
            Gönderen Depo: <span className="font-medium">{root?.sourceDepotName || '-'}</span> •{' '}
            Teslim Alan: <span className="font-medium">{root?.targetName || '-'}</span>
            {root?.mode === 'borc' && root.company && ` • Firma: ${root.company}`} •{' '}
            Tarih: <span className="font-medium"><TimestampText value={root?.timestamp} format="dd.MM.yyyy HH:mm"/></span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Miad</TableHead>
                  <TableHead>Seri No</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={`${it.seriNumarasi}-${idx}`}>
                    <TableCell className="font-mono text-xs">{it.stokKodu}</TableCell>
                    <TableCell>{it.stokAdi}</TableCell>
                    <TableCell>{it.lotNumarasi}</TableCell>
                    <TableCell><TimestampText value={it.miad} /></TableCell>
                    <TableCell className="font-mono text-xs">{it.seriNumarasi}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
