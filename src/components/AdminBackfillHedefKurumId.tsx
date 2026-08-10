'use client';
import { useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';
import type { Hospital, DepoStokItem } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, DatabaseZap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';

export default function AdminBackfillHedefKurumId() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ updated: number; skipped: number }>({ updated: 0, skipped: 0 });
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const run = async () => {
    if (!confirm('Bu işlem, eski sevk edilmiş stok kayıtlarını güncelleyecektir. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?')) {
      return;
    }
    setBusy(true);
    try {
      const [labsSnap, stokSnap] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(query(scopedQuery('depoStok', currentCompanyId, isSuperAdmin), where('isShipped', '==', true), where('hedefKurumId', '==', null))),
      ]);
      const labs: Hospital[] = filterByCompanyScope(
        labsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
        currentCompanyId,
        isSuperAdmin,
      );
      const nameToId = new Map<string, string>();
      labs.forEach(l => { if (l.name) nameToId.set(l.name, l.id); });

      const docs = filterByCompanyScope(
        stokSnap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) } as DepoStokItem))
          .filter(i => !i.hedefKurumId && !!i.hedefKurum), // Double check filter
        currentCompanyId,
        isSuperAdmin,
      );

      let updated = 0, skipped = 0;
      for (let i = 0; i < docs.length; i += 400) {
        const slice = docs.slice(i, i + 400);
        const batch = writeBatch(db);
        slice.forEach(item => {
          const labId = nameToId.get((item as any).hedefKurum);
          if (labId) {
            const ref = doc(db, 'depoStok', item.id);
            batch.set(ref, { hedefKurumId: labId }, { merge: true });
            updated++;
          } else {
            skipped++;
          }
        });
        if (slice.length > 0) {
          await batch.commit();
        }
      }
      setResult({ updated, skipped });
      toast({title: "Tamamlandı", description: `${updated} kayıt güncellendi, ${skipped} kayıt atlandı.`});
    } catch(e: any) {
        console.error("Backfill failed:", e);
        toast({title: "Hata", description: `Veri taşıma işlemi başarısız oldu: ${e.message}`, variant: "destructive"});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-2 border-dashed border-amber-500/50">
      <CardHeader>
        <CardTitle className="text-base text-amber-600">Yönetim: Eski Stokları Taşı</CardTitle>
        <CardDescription>
          `hedefKurumId` alanı boş olan eski sevk edilmiş stok kayıtlarını günceller.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <p>Bu işlem, `hedefKurum` (isim) alanını kullanarak ilgili laboratuvarın `ID`'sini bulur ve kayda ekler. Bu, sistem genelinde veri tutarlılığını artırır.</p>
        <p className="text-muted-foreground">Not: Aynı ada sahip birden fazla laboratuvar varsa veya hedef kurum adı bulunamazsa, bu kayıtlar atlanır.</p>
        {result.updated + result.skipped > 0 && (
          <p className="text-xs font-medium">Son Çalıştırma Sonucu: Güncellendi: {result.updated}, Atlandı (Eşleşme Yok): {result.skipped}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={run} disabled={busy} variant="secondary">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />} 
          Veri Taşıma İşlemini Başlat
        </Button>
      </CardFooter>
    </Card>
  );
}
