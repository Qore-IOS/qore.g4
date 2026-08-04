'use client';

/**
 * Yönetim aracı: Seri No Defteri'ni geriye dönük doldurma.
 *
 * Defter (`serialLedger`) `ürün kodu + seri no` başına tek satır tutar. Bu araç,
 * defter devreye alınmadan ÖNCE oluşmuş tüm kayıtları (depo/laboratuvar stoğu,
 * transferler, tüketimler, depo sayım oturumları ve eski `serialHistory`
 * olayları) tarayıp defteri yeniden inşa eder.
 *
 * İşlem idempotenttir: aynı olay için deterministik belge kimliği kullanılır,
 * tekrar çalıştırmak mükerrer kayıt üretmez. Önce "Önizle" ile hiçbir şey
 * yazmadan sayılar görülebilir.
 */
import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, DatabaseZap, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { SerialLedgerBackfillResult } from '@/actions/serialLedgerActions';

export default function AdminBackfillSerialLedger() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [result, setResult] = useState<SerialLedgerBackfillResult | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);

  const run = async (dryRun: boolean) => {
    if (!currentUser) return;
    if (!dryRun && !confirm(
      'Seri No Defteri mevcut kayıtlardan yeniden inşa edilecek. İşlem idempotenttir '
      + '(tekrar çalıştırmak mükerrer kayıt üretmez) ve stok belgelerine dokunmaz. Devam edilsin mi?'
    )) return;

    setBusy(dryRun ? 'preview' : 'apply');
    try {
      const idToken = await currentUser.getIdToken();
      const { backfillSerialLedger } = await import('@/actions/serialLedgerActions');
      const res = await backfillSerialLedger({ idToken, dryRun });
      setResult(res);
      setWasDryRun(dryRun);
      toast({
        title: dryRun ? 'Önizleme tamamlandı' : 'Defter dolduruldu',
        description: `${res.ledgerRows} birim, ${res.ledgerEvents} olay${
          res.freedByCount > 0 ? ` — ${res.freedByCount} birim sayımdan düşülmüş olarak serbest bırakıldı.` : '.'
        }`,
      });
    } catch (error: any) {
      console.error('[AdminBackfillSerialLedger]', error);
      toast({ title: 'İşlem başarısız', description: error?.message || 'Bilinmeyen hata.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-2 border-dashed border-sky-500/50">
      <CardHeader>
        <CardTitle className="text-base text-sky-600">Yönetim: Seri No Defteri Doldurma</CardTitle>
        <CardDescription>
          Her benzersiz fiziksel ürün (ürün kodu + seri no) için tek bir defter satırı oluşturur ve
          geçmişte hangi işlemlerden geçtiğini (mal kabul → transfer → sipariş karşılama → tüketim →
          imha → borç → sayımdan düşüm) kaydeder. Barkod okutulduğunda ürünün daha önce işlem görüp
          görmediği bu defterden sorgulanır. Depo sayımıyla düşülen seriler <strong>serbest</strong>{' '}
          işaretlenir ve yeniden mal kabul/transfer/tüketim yapılabilir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result && (
          <div className="rounded border bg-muted/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              {wasDryRun ? 'Önizleme (hiçbir şey yazılmadı)' : 'Uygulandı'}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Defter satırı</dt><dd className="font-semibold">{result.ledgerRows}</dd></div>
              <div><dt className="text-muted-foreground">Olay</dt><dd className="font-semibold">{result.ledgerEvents}</dd></div>
              <div><dt className="text-muted-foreground">Sayımdan serbest</dt><dd className="font-semibold">{result.freedByCount}</dd></div>
              <div><dt className="text-muted-foreground">Taranan stok</dt><dd>{result.scannedDepotStock}</dd></div>
              <div><dt className="text-muted-foreground">Taranan transfer</dt><dd>{result.scannedTransfers}</dd></div>
              <div><dt className="text-muted-foreground">Taranan tüketim</dt><dd>{result.scannedConsumptions}</dd></div>
              <div><dt className="text-muted-foreground">Sayım düşümü</dt><dd>{result.scannedCountDeductions}</dd></div>
            </dl>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Bu işlem yalnızca <code>serialLedger</code> koleksiyonuna yazar; stok belgeleri (<code>depoStok</code>)
          değiştirilmez.
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => run(true)} disabled={busy !== null} variant="outline">
          {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Önizle
        </Button>
        <Button onClick={() => run(false)} disabled={busy !== null}>
          {busy === 'apply' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
          Defteri Doldur
        </Button>
      </CardFooter>
    </Card>
  );
}
