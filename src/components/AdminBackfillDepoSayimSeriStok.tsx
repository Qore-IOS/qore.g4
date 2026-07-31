'use client';
import { useState } from 'react';
import { getDocs, where } from 'firebase/firestore';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { useDepots, useProductCodes } from '@/hooks/useFirebaseQueries';
import type { Depot, DepoStokItem } from '@/lib/types';
import {
  findLastDepoSayimV2Session, buildPreCountLeftoverPreview, applyPreCountLeftoverBackfill,
  type LastCountSession, type BackfillPreview,
} from '@/lib/depo-sayim-backfill';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, Search, DatabaseZap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminBackfillDepoSayimSeriStok() {
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth() as any;
  const { toast } = useToast();
  const depotsQ = useDepots();
  const productsQ = useProductCodes();
  const depots = (depotsQ.data ?? []) as Depot[];
  const productCodes = productsQ.data ?? [];

  const [depotId, setDepotId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [session, setSession] = useState<LastCountSession | null | undefined>(undefined); // undefined = not scanned yet
  const [preview, setPreview] = useState<BackfillPreview | null>(null);

  const selectedDepot = depots.find(d => d.id === depotId) || null;

  const scan = async () => {
    if (!depotId || !selectedDepot) return;
    setScanning(true);
    setSession(undefined);
    setPreview(null);
    try {
      const s = await findLastDepoSayimV2Session(depotId, currentCompanyId, isSuperAdmin);
      setSession(s);
      if (!s) return;
      const snap = await getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('depotId', '==', depotId)));
      const docs = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...d.data() })),
        currentCompanyId, isSuperAdmin,
      ) as DepoStokItem[];
      setPreview(buildPreCountLeftoverPreview(docs, productCodes, s.closedAtMillis));
    } catch (e: any) {
      console.error('[BackfillDepoSayim] tarama hatası:', e);
      toast({ title: 'Tarama başarısız', description: e?.message || 'Bilinmeyen hata.', variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const apply = async () => {
    if (!preview || !session || !selectedDepot || preview.rows.length === 0) return;
    if (!confirm(
      `${selectedDepot.name} deposunda, ${preview.totalToDeleteDocs} kayıt (${preview.totalToDeleteQty} adet) son sayım tarihinden ÖNCEKİ stok olarak silinecek. Bu sayım sonrası (mal kabul ile) gelen stoklara dokunulmayacak. Bu işlem geri alınamaz. Devam edilsin mi?`
    )) return;
    setApplying(true);
    try {
      const res = await applyPreCountLeftoverBackfill({
        rows: preview.rows,
        depot: { id: selectedDepot.id, name: selectedDepot.name || '' },
        session,
        companyId: currentCompanyId,
        user: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || currentUserProfile?.email || 'Bilinmeyen' },
      });
      toast({ title: 'Düzeltme tamamlandı', description: `${res.deletedDocs} kayıt (${res.deletedQty} adet) silindi.` });
      setPreview(null);
      setSession(undefined);
    } catch (e: any) {
      console.error('[BackfillDepoSayim] uygulama hatası:', e);
      toast({ title: 'Düzeltme başarısız', description: e?.message || 'Bilinmeyen hata.', variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card className="border-2 border-dashed border-amber-500/50">
      <CardHeader>
        <CardTitle className="text-base text-amber-600">Yönetim: Depo Sayım Seri Stok Düzeltmesi</CardTitle>
        <CardDescription>
          Depo sayımda eskiden seri numaralı ürünlerin sayım azaltması uygulanmıyordu (artık düzeltildi). Bu araç,
          seçilen depoda son sayım tarihinden ÖNCE eklenmiş, hâlâ duran bu tür stokları bulur ve siler.
          Sayım sonrası (mal kabul ile) gelen stoklar hiç dokunulmadan kalır.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={depotId} onValueChange={(v) => { setDepotId(v); setSession(undefined); setPreview(null); }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Depo seçin" />
            </SelectTrigger>
            <SelectContent>
              {depots.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={scan} disabled={!depotId || scanning} variant="outline">
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Tara
          </Button>
        </div>

        {session === null && (
          <p className="text-muted-foreground">Bu depoda "depo-sayim-v2" modunda tamamlanmış bir sayım bulunamadı.</p>
        )}

        {session && (
          <p className="text-xs text-muted-foreground">
            Son sayım: {session.closedAt.toLocaleString('tr-TR')} (bu tarihten önceki, seri numaralı ürünlere ait stoklar taranıyor)
          </p>
        )}

        {preview && preview.rows.length === 0 && (
          <p className="text-muted-foreground">Temizlenecek bir kayıt bulunamadı — bu depo için düzeltmeye gerek yok.</p>
        )}

        {preview && preview.rows.length > 0 && (
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2 text-left">Ürün</th>
                  <th className="p-2 text-left">Lot</th>
                  <th className="p-2 text-left">Miad</th>
                  <th className="p-2 text-right">Silinecek</th>
                  <th className="p-2 text-right">Kalacak (mal kabul)</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={`${r.stokKodu}-${r.lotNumarasi}-${r.miad}-${i}`} className="border-t">
                    <td className="p-2">{r.stokAdi}</td>
                    <td className="p-2 font-mono">{r.lotNumarasi || '—'}</td>
                    <td className="p-2">{r.miad || '—'}</td>
                    <td className="p-2 text-right font-semibold text-destructive">{r.toDeleteQty}</td>
                    <td className="p-2 text-right">{r.keepQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {preview && preview.rows.length > 0 && (
        <CardFooter>
          <Button onClick={apply} disabled={applying} variant="destructive">
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
            {preview.totalToDeleteDocs} kaydı sil ({preview.totalToDeleteQty} adet)
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
