'use client';

/**
 * Ceomed muhasebe irsaliyesi giriş kuyruğu paneli.
 *
 * Gönderim tam otomatiktir: teknik/aplikasyon formu kapandığında iş kuyruğa
 * düşer, on-prem worker Ceomed uygulamasına yazar. Otomasyonun sessiz kalabildiği
 * tek yer başarısızlıklardır — worker'ın log dosyası şirket ağındaki bir makinede
 * durur ve kimse bakmaz. Bu panel `blocked` ve `failed` işleri gerekçesiyle
 * görünür kılar; aksi hâlde muhasebeye düşmeyen bir irsaliye haftalar sonra
 * mutabakatta fark edilir.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';

import {
  IRSALIYE_GIRIS_COLLECTION,
  type IrsaliyeGirisSatiri,
  type IrsaliyeGirisStatus,
} from '@/lib/ceomed/irsaliye-giris';

type JobRow = {
  id: string;
  status: IrsaliyeGirisStatus;
  irsaliyeNo?: string;
  cariKodu?: string;
  tarih?: string;
  aciklama?: string;
  labName?: string | null;
  cihazAdi?: string | null;
  formType?: 'teknik_servis' | 'aplikasyon';
  satirlar?: IrsaliyeGirisSatiri[];
  blockedDetail?: string | null;
  lastError?: string | null;
  attemptCount?: number;
  ceomedIrsaliyeNo?: string | null;
  companyId?: string | null;
  createdAt?: { toDate?: () => Date } | null;
};

const STATUS_META: Record<IrsaliyeGirisStatus, { label: string; icon: React.ElementType; className: string }> = {
  pending:    { label: 'Kuyrukta',   icon: Clock,        className: 'text-amber-600 dark:text-amber-400' },
  processing: { label: 'Yazılıyor',  icon: Loader2,      className: 'text-blue-600 dark:text-blue-400' },
  sent:       { label: 'Gönderildi', icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  failed:     { label: 'Başarısız',  icon: XCircle,      className: 'text-red-600 dark:text-red-400' },
  blocked:    { label: 'Eksik veri', icon: AlertTriangle, className: 'text-orange-600 dark:text-orange-400' },
};

/** Önce müdahale gerektirenler: bozuk işin listenin dibinde kaybolması işe yaramaz. */
const STATUS_ORDER: IrsaliyeGirisStatus[] = ['blocked', 'failed', 'processing', 'pending', 'sent'];

export default function CeomedIrsaliyeGirisKuyrugu() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState<string | null>(null);
  const [showSent, setShowSent] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, IRSALIYE_GIRIS_COLLECTION)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<JobRow, 'id'>) }))
          .filter((row) => matchesCompanyScope(row, currentCompanyId, isSuperAdmin));
        setJobs(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  const siraliJobs = useMemo(() => {
    const gorunur = showSent ? jobs : jobs.filter((j) => j.status !== 'sent');
    return [...gorunur].sort((a, b) => {
      const fark = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (fark !== 0) return fark;
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
  }, [jobs, showSent]);

  const sayim = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const j of jobs) acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, [jobs]);

  /**
   * İşi yeniden kuyruğa alır. Yalnızca `blocked` ve `failed` için açıktır:
   * `sent` bir işi yeniden kuyruğa almak muhasebeye MÜKERRER irsaliye gönderir.
   */
  const yenidenKuyruga = async (job: JobRow) => {
    if (job.status !== 'blocked' && job.status !== 'failed') return;
    setRequeuing(job.id);
    try {
      await updateDoc(doc(db, IRSALIYE_GIRIS_COLLECTION, job.id), {
        status: 'pending',
        attemptCount: 0,
        lastError: null,
        blockedReason: null,
        blockedDetail: null,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: 'Kuyruğa alındı',
        description: `${job.irsaliyeNo || job.id} yeniden denenecek.`,
      });
    } catch (e: any) {
      toast({ title: 'Hata', description: e?.message || 'Yeniden kuyruğa alınamadı.', variant: 'destructive' });
    } finally {
      setRequeuing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Ceomed irsaliye kuyruğu yükleniyor…
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Ceomed Muhasebe İrsaliyesi Kuyruğu</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {STATUS_ORDER.map((s) => {
            const meta = STATUS_META[s];
            const adet = sayim[s] || 0;
            if (adet === 0) return null;
            return (
              <span key={s} className={`flex items-center gap-1 ${meta.className}`}>
                <meta.icon className="h-3.5 w-3.5" />
                {meta.label}: {adet}
              </span>
            );
          })}
          <Button variant="ghost" size="sm" onClick={() => setShowSent((v) => !v)}>
            {showSent ? 'Gönderilenleri gizle' : 'Gönderilenleri göster'}
          </Button>
        </div>
      </div>

      {siraliJobs.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          {showSent
            ? 'Kuyrukta kayıt yok.'
            : 'Bekleyen veya hatalı iş yok. Yedek parça kullanılan her form kapanışında burada bir kayıt oluşur.'}
        </p>
      ) : (
        <div className="divide-y">
          {siraliJobs.map((job) => {
            const meta = STATUS_META[job.status] || STATUS_META.pending;
            const mudahaleGerek = job.status === 'blocked' || job.status === 'failed';
            const gerekce = job.blockedDetail || job.lastError;

            return (
              <div key={job.id} className="flex flex-wrap items-start gap-3 p-4">
                <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${meta.className}`}>
                  <meta.icon className={`h-4 w-4 ${job.status === 'processing' ? 'animate-spin' : ''}`} />
                  {meta.label}
                </span>

                <div className="min-w-[240px] flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{job.irsaliyeNo || '(form no yok)'}</span>
                    <span className="text-muted-foreground">
                      {job.cariKodu || '(cari kodu yok)'} • {job.labName || '—'}
                    </span>
                    {job.tarih && <span className="text-xs text-muted-foreground">{job.tarih}</span>}
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    {(job.satirlar || []).map((s) => (
                      <span key={s.actionId || s.stokKodu} className="mr-3 inline-block">
                        {s.stokKodu || '(kodsuz)'} × {s.miktar}
                        {s.lot ? ` • ${s.lotKaynagi === 'seri_no' ? 'seri' : 'lot'}: ${s.lot}` : ''}
                      </span>
                    ))}
                  </div>

                  {job.aciklama && (
                    <div className="mt-1 text-xs text-muted-foreground">İşlemi yapan: {job.aciklama}</div>
                  )}

                  {gerekce && (
                    <p className="mt-2 rounded bg-muted/60 p-2 text-xs text-foreground/80">
                      {gerekce}
                      {job.status === 'failed' && job.attemptCount ? ` (${job.attemptCount} deneme)` : ''}
                    </p>
                  )}

                  {job.status === 'sent' && job.ceomedIrsaliyeNo && (
                    <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                      Ceomed irsaliye no: {job.ceomedIrsaliyeNo}
                    </div>
                  )}
                </div>

                {mudahaleGerek && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={requeuing === job.id}
                    onClick={() => yenidenKuyruga(job)}
                  >
                    {requeuing === job.id
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                    Yeniden dene
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="border-t p-3 text-xs text-muted-foreground">
        &quot;Eksik veri&quot; genellikle laboratuvara Ceomed cari kodu girilmemiş olmasından kaynaklanır —
        Yönetim → Laboratuvarlar ekranından tanımlayıp yeniden deneyin.
      </p>
    </div>
  );
}
