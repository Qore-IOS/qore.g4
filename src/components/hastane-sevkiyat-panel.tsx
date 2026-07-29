'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Minus,
  TrendingDown,
  TrendingUp,
  ChevronRight,
  Loader2,
  PackageSearch,
  Send,
  Star,
  Truck,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { withCompanyScope, filterByCompanyScope } from '@/lib/company-scope';
import { generateId } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useDepots } from '@/hooks/useFirebaseQueries';
import type { MinMaxRule, ProductCode } from '@/lib/types';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';
import {
  aylikKutudanGunluk,
  aylikMaxKutu,
  dagitimYap,
  hesaplaOneri,
  hesaplaRiskliSevk,
  hesaplaTuketimTrendi,
  type DemandBasis,
  type OneriSonucu,
  type OneriTipi,
  type RiskliSevkSonucu,
  type SevkLotu,
} from '@/lib/lojistik/supplier-order-advisor';
import { miadaKalanGun } from '@/lib/lojistik/miad';
import { alanHaritasi } from '@/lib/lab-period/merge';
import type { OlcumAlani } from '@/lib/lab-period/types';
import type { DepoLotu } from '@/actions/stokActions';

/* ——— Lojistik görünümüyle ortak tasarım ——— */
const PANEL_CLASS =
  'rounded-[26px] border border-emerald-950/10 bg-white/85 shadow-[0_24px_55px_-32px_rgba(6,78,59,0.35)] backdrop-blur-xl dark:border-fuchsia-400/15 dark:bg-[#160e1e]/80 dark:shadow-[0_28px_65px_-34px_rgba(0,0,0,0.85)]';
const FIELD_LABEL_CLASS =
  'mb-1.5 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]';
const CONTROL_CLASS =
  'min-h-11 rounded-xl border-emerald-950/10 bg-white/85 font-bold text-[#29473f] dark:border-fuchsia-300/20 dark:bg-[#160e1e]/85 dark:text-[#d6bfe3]';
const PRIMARY_BTN_CLASS =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-fuchsia-500 dark:hover:bg-fuchsia-600 dark:focus-visible:ring-fuchsia-300/30';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const DEFAULT_MAX_GUN = 30;

const DEMAND_BASIS_OPTIONS: Array<{ value: DemandBasis; label: string }> = [
  { value: 'buyuk', label: 'En büyüğü' },
  { value: 'minmax', label: 'Min/Max tanımı' },
  { value: 'tuketim', label: 'Gerçek tüketim' },
];

/** Bu bandın altındaki değişim "yatay" sayılır (%). */
const DEGISIM_ESIGI = 8;

/**
 * Önceki 3 ay ortalamasına göre değişim çipi.
 *
 * Tedarikçi sipariş panelindekiyle aynı eşik ve aynı görünüm kullanılır;
 * iki tabloda aynı ürünün eğilimi farklı okunmasın.
 */
function DegisimChip({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>;
  }
  const stable = Math.abs(value) < DEGISIM_ESIGI;
  const up = value > 0;
  const cls = stable
    ? 'border-emerald-950/10 bg-white/70 text-[#587169] dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#a994b5]'
    : up
      ? 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200'
      : 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/15 dark:text-sky-200';
  const Icon = stable ? Minus : up ? TrendingUp : TrendingDown;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${cls}`}
      title={`Önceki 3 ay ortalamasına göre ${up ? 'artış' : 'azalış'}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {value > 0 ? '+' : ''}{fmt(value, 0)}%
    </span>
  );
}

const ONERI_STILI: Record<OneriTipi, { chip: string; kisa: string }> = {
  'acil-siparis': {
    chip: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/20 dark:text-rose-200',
    kisa: 'ACİL SEVK',
  },
  siparis: {
    chip: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/20 dark:text-emerald-200',
    kisa: 'SEVK ET',
  },
  yeterli: {
    chip: 'border-emerald-950/10 bg-white/70 text-[#587169] dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#a994b5]',
    kisa: 'GEREK YOK',
  },
  'fazla-stok': {
    chip: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/20 dark:text-amber-200',
    kisa: 'FAZLA STOK',
  },
  'veri-yok': {
    chip: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-400/30 dark:bg-slate-500/20 dark:text-slate-200',
    kisa: 'VERİ GİRİLMELİ',
  },
};
const ONERI_OZET_SIRASI: OneriTipi[] = ['acil-siparis', 'siparis', 'veri-yok', 'fazla-stok', 'yeterli'];

const normCode = (value: unknown): string => {
  const code = String(value ?? '').trim();
  return code.replace(/^0+/, '') || code;
};
const fmt = (value: number, digits = 2) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: digits });

interface SevkSatiri {
  key: string;
  labId: string;
  labAdi: string;
  stokKodu: string;
  stokAdi: string;
  /** Laboratuvarın dönem sayımından gelen stoğu */
  labStok: number;
  cihazUstuTest: number;
  cihazUstuKutu: number;
  testAdedi: number;
  /** Seçili dönemden ÖNCEKİ 3 dönemin kümülatif ortalaması; veri yoksa null */
  onceki3AyOrt: number | null;
  /** Seçili dönemin o ortalamaya göre değişimi (%); hesaplanamıyorsa null */
  degisimYuzde: number | null;
  oneri: OneriSonucu;
  /** Ana depo stoğu yettiği kadarıyla sevk edilecek adet */
  sevkAdedi: number;
  /** Depo stoğu yetmediği için karşılanamayan */
  karsilanamayan: number;
  /** Bu ürün için ana depodaki toplam stok */
  anaDepoStok: number;
  /** Kurumun tanımlı max adedi (0 = tanımsız) */
  kurumMax: number;
  /** Sevk edilecek lotların miad riski */
  risk: RiskliSevkSonucu;
  /** Bu satıra ayrılan lotlar (FEFO) */
  sevkLotlari: AyrilanLot[];
}

/** Ayrılan lot + ham miad değeri (çözülemediğinde ekranda gösterilir). */
type AyrilanLot = SevkLotu & { miadMetni: string };

async function fetchMinMaxRules(
  parentCollection: 'depots' | 'hospitals',
  id: string,
): Promise<Record<string, MinMaxRule>> {
  const snap = await getDocs(collection(db, parentCollection, id, 'minMaxRules'));
  return snap.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
    const r = d.data() as MinMaxRule;
    const code = String(r?.stokKodu || d.id || '').trim();
    if (code) acc[code] = { ...r, stokKodu: code };
    return acc;
  }, {});
}

/**
 * Hastane Sevkiyat paneli.
 *
 * Tedarikçi sipariş paneliyle AYNI öneri motorunu kullanır; fark, hesabın
 * saha bütünü yerine **her laboratuvar için ayrı** yapılması ve sonucun ana
 * depoda fiilen bulunan stokla sınırlanmasıdır. Depo stoğu kıtken dağıtım
 * aciliyet sırasına göre yapılır (bkz. `dagitimYap`).
 */
export default function HastaneSevkiyatPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentUser, currentCompanyId, isSuperAdmin } = useAuth();

  const { data: depots = [], isLoading: depotsLoading } = useDepots();

  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [yeterlilikGun, setYeterlilikGun] = useState<number | string>(30);
  const [demandBasis, setDemandBasis] = useState<DemandBasis>('buyuk');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hazirla, setHazirla] = useState(false);

  useEffect(() => {
    if (currentUserProfile?.role && currentUserProfile.role !== 'lojistik_sorumlusu') {
      router.replace('/dashboard');
    }
  }, [currentUserProfile?.role, router]);

  const anaDepo = useMemo(() => depots.find(d => d.isAnaDepo), [depots]);
  const labIds = useMemo(
    () => (anaDepo ? (anaDepo.linkedLaboratoryIds || []).filter(Boolean) : []),
    [anaDepo],
  );

  // Ağır veriler yalnızca kullanıcı "Sevkiyatı hazırla" dedikten sonra yüklenir.
  const enabled = hazirla && labIds.length > 0;

  const { data: productCodes = [], isLoading: productsLoading } = useQuery({
    queryKey: ['productCodes', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const { getProductCodesAction } = await import('@/actions/stokActions');
      return (await getProductCodesAction(currentCompanyId, isSuperAdmin ?? false)) as ProductCode[];
    },
    enabled: enabled && (!!currentCompanyId || isSuperAdmin === true),
    staleTime: 60 * 60 * 1000,
  });

  const { data: labInfoById } = useQuery({
    queryKey: ['sevkiyat', 'labInfo', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin));
      const rows = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })),
        currentCompanyId,
        isSuperAdmin,
      );
      const map = new Map<string, string>();
      rows.forEach((h: any) => map.set(h.id, String(h?.name || h?.ad || h.id)));
      return map;
    },
    enabled: enabled && (!!currentCompanyId || isSuperAdmin === true),
    staleTime: 60 * 60 * 1000,
  });

  // `useQueries` her render'da yeni bir dizi döndürür; sonucu `combine` ile
  // sadeleştirmek yapısal paylaşımı devreye sokar ve aşağıdaki memo'ların
  // her render'da yeniden hesaplanmasını engeller.
  const { rulesByLab, rulesLoading } = useQueries({
    queries: labIds.map(id => ({
      queryKey: ['sevkiyat', 'minMaxRules', 'hospital', id],
      queryFn: () => fetchMinMaxRules('hospitals', id),
      staleTime: 30 * 60 * 1000,
      enabled,
    })),
    combine: results => ({
      rulesByLab: results.map(r => r.data),
      rulesLoading: results.some(r => r.isLoading),
    }),
  });

  const [anaDepoStokByCode, setAnaDepoStokByCode] = useState<Map<string, number>>(new Map());
  const [anaDepoLotlariByCode, setAnaDepoLotlariByCode] = useState<Map<string, AyrilanLot[]>>(new Map());
  const [labStokByLab, setLabStokByLab] = useState<Map<string, Map<string, number>>>(new Map());
  const [cihazUstuByLab, setCihazUstuByLab] = useState<Map<string, Map<string, number>>>(new Map());
  const [kumulatifByLab, setKumulatifByLab] = useState<Map<string, Map<string, number>>>(new Map());
  const [seriByLab, setSeriByLab] = useState<Map<string, Map<string, Array<number | null>>>>(new Map());
  const [seriDonemleri, setSeriDonemleri] = useState<string[]>([]);
  const [sayimEksik, setSayimEksik] = useState<{ counted: number; total: number }>({ counted: 0, total: 0 });
  const [veriLoading, setVeriLoading] = useState(false);

  // Dönem değişince hazırlanmış veri geçersizdir.
  useEffect(() => {
    setHazirla(false);
  }, [selectedYear, selectedMonth, anaDepo?.id]);

  useEffect(() => {
    if (!enabled || !anaDepo) return;
    let cancelled = false;
    const monthIndex = selectedMonth - 1;
    const load = async () => {
      setVeriLoading(true);
      try {
        const stok = await import('@/actions/stokActions');
        const labPeriod = await import('@/actions/labPeriodActions');
        const periods = [5, 4, 3, 2, 1, 0].map(back => {
          const d = new Date(selectedYear, monthIndex - back, 1);
          return { year: d.getFullYear(), monthIndex: d.getMonth() };
        });

        // Saha verisi (stok / cihaz üstü / kümülatif) artık tek kaynaktan
        // okunur: veri hangi panelden girilmiş olursa olsun lab-dönem
        // snapshot'ında durur.
        const [depoStok, depoLotlari, snapshotlar] = await Promise.all([
          anaDepo.ceomedEnabled
            ? stok.getCeomedDepoStockByCode(anaDepo.id, currentCompanyId, isSuperAdmin)
            : stok.getDepotStockByCode(anaDepo.id, currentCompanyId, isSuperAdmin),
          stok.getDepotLotsByCode(
            anaDepo.id,
            Boolean(anaDepo.ceomedEnabled),
            currentCompanyId,
            isSuperAdmin,
          ),
          labPeriod.getLabPeriodSnapshotsForPeriods(
            labIds,
            periods.map(p => ({ yil: p.year, ay: p.monthIndex + 1 })),
            currentCompanyId,
            isSuperAdmin,
          ),
        ]);
        if (cancelled) return;

        const depoMap = new Map<string, number>();
        for (const [rawCode, qty] of Object.entries(depoStok || {})) {
          const code = normCode(rawCode);
          if (code) depoMap.set(code, (depoMap.get(code) || 0) + (Number(qty) || 0));
        }

        // Lotlar FEFO sırasında tutulur; miadı okunamayanlar en sona düşer.
        const lotMap = new Map<string, AyrilanLot[]>();
        for (const [rawCode, lotlar] of Object.entries(
          (depoLotlari || {}) as Record<string, DepoLotu[]>,
        )) {
          const code = normCode(rawCode);
          if (!code) continue;
          const liste = (lotlar || []).map(l => ({
            lot: l.lot || '—',
            miadMetni: l.miad || '',
            miatGun: miadaKalanGun(l.miad),
            adet: Number(l.adet) || 0,
          }));
          liste.sort((a, b) => {
            if (a.miatGun === null) return b.miatGun === null ? 0 : 1;
            if (b.miatGun === null) return -1;
            return a.miatGun - b.miatGun;
          });
          lotMap.set(code, [...(lotMap.get(code) || []), ...liste]);
        }

        const keyOf = (p: { year: number; monthIndex: number }) =>
          `${p.year}-${String(p.monthIndex + 1).padStart(2, '0')}`;

        /** Bir dönemin snapshot'larından `labId -> stokKodu -> değer` çıkarır. */
        const alandanLabMap = (donemKey: string, alan: OlcumAlani) => {
          const donemSnap = snapshotlar[donemKey] || {};
          const outer = new Map<string, Map<string, number>>();
          Object.entries(donemSnap).forEach(([labId, snap]) => {
            const inner = new Map<string, number>();
            Object.entries(alanHaritasi(snap, alan)).forEach(([rawCode, deger]) => {
              const code = normCode(rawCode);
              if (code) inner.set(code, (inner.get(code) || 0) + deger);
            });
            outer.set(labId, inner);
          });
          return outer;
        };

        const secilenDonem = keyOf(periods[periods.length - 1]);
        const perPeriod = periods.map(p => {
          const anahtar = keyOf(p);
          const donemSnap = snapshotlar[anahtar] || {};
          return {
            // Dönemde hiç kümülatif girilmemişse ortalamayı 0'la aşağı çekme.
            hasData: Object.values(donemSnap).some(
              s => Object.keys(s?.kumulatif || {}).length > 0,
            ),
            byLab: alandanLabMap(anahtar, 'kumulatif'),
          };
        });

        // Lab × ürün için 6 aylık seri (veri olmayan ay null).
        const seri = new Map<string, Map<string, Array<number | null>>>();
        labIds.forEach(labId => {
          const codes = new Set<string>();
          perPeriod.forEach(p => p.byLab.get(labId)?.forEach((_, code) => codes.add(code)));
          const inner = new Map<string, Array<number | null>>();
          codes.forEach(code => {
            inner.set(
              code,
              perPeriod.map(p => (p.hasData ? p.byLab.get(labId)?.get(code) || 0 : null)),
            );
          });
          seri.set(labId, inner);
        });

        // Seçili dönemde stok ölçümü olan lablar "sayımı yapılmış" sayılır —
        // sayım hangi panelden girilmiş olursa olsun snapshot'ta durur.
        const sayilanLablar = Object.values(snapshotlar[secilenDonem] || {}).filter(
          s => Object.keys(s?.stok || {}).length > 0,
        ).length;

        setAnaDepoStokByCode(depoMap);
        setAnaDepoLotlariByCode(lotMap);
        setLabStokByLab(alandanLabMap(secilenDonem, 'stok'));
        setCihazUstuByLab(alandanLabMap(secilenDonem, 'cihazUstu'));
        setKumulatifByLab(perPeriod[perPeriod.length - 1].byLab);
        setSeriByLab(seri);
        setSeriDonemleri(
          periods.map(p => `${String(p.monthIndex + 1).padStart(2, '0')}-${p.year}`),
        );
        setSayimEksik({ counted: sayilanLablar, total: labIds.length });
      } catch (e) {
        console.error('[hastane-sevkiyat] Veriler okunamadı:', e);
        if (!cancelled) toast({ title: 'Hata', description: 'Sevkiyat verileri okunamadı.', variant: 'destructive' });
      } finally {
        if (!cancelled) setVeriLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [enabled, anaDepo, labIds, selectedMonth, selectedYear, currentCompanyId, isSuperAdmin, toast]);

  const productByStockCode = useMemo(
    () =>
      productCodes.reduce<Record<string, ProductCode>>((acc, product) => {
        const code = (product.stokKodu ?? '').trim();
        if (code) acc[code] = product;
        return acc;
      }, {}),
    [productCodes],
  );

  const daysInPeriod = useMemo(
    () => new Date(selectedYear, selectedMonth, 0).getDate() || 30,
    [selectedYear, selectedMonth],
  );

  /**
   * Her (lab, ürün) için öneriyi hesaplar, sonra ürün bazında ana depo stoğunu
   * aciliyete göre laboratuvarlara dağıtır.
   */
  const rows = useMemo<SevkSatiri[]>(() => {
    if (!anaDepo || !enabled) return [];
    const hedefGun = Number(yeterlilikGun);
    const gunGecerli = Number.isFinite(hedefGun) && hedefGun > 0;
    const labNames = labInfoById ?? new Map<string, string>();
    const eksikSayim = Math.max(0, sayimEksik.total - sayimEksik.counted);

    // 1) Kurum × ürün bazında ihtiyaç
    type AraSatir = Omit<SevkSatiri, 'sevkAdedi' | 'karsilanamayan' | 'risk' | 'sevkLotlari'>;
    const araSatirlar: AraSatir[] = [];
    labIds.forEach((labId, index) => {
      const rules = rulesByLab[index];
      if (!rules) return;
      const labAdi = labNames.get(labId) || labId;
      const labStokMap = labStokByLab.get(labId);
      const cihazMap = cihazUstuByLab.get(labId);
      const kumMap = kumulatifByLab.get(labId);
      const seriMap = seriByLab.get(labId);

      Object.values(rules).forEach(rule => {
        const code = String(rule.stokKodu || '').trim();
        if (!code) return;
        const canonical = normCode(code);
        const product = productByStockCode[code];
        const ambalaj = Number(product?.ambalajDegeri) || 0;

        const max = Number(rule.max ?? 0);
        const maxGun = Number(rule.maxGun ?? 0) > 0 ? Number(rule.maxGun) : DEFAULT_MAX_GUN;
        // Saha ihtiyacı aylık tutulur ve tam kutuya yukarı yuvarlanır —
        // tedarikçi sipariş paneliyle aynı kural, aynı ürün iki tabloda
        // farklı ihtiyaç göstermesin.
        const gunlukMinMax = aylikKutudanGunluk(aylikMaxKutu(max, maxGun));

        const testAdedi = kumMap?.get(canonical) || 0;

        // "Son 3 Ay Ort." seçili dönemden ÖNCEKİ 3 dönemi baz alır (seri
        // eskiden yeniye 6 dönem; son eleman seçili dönemin kendisi).
        const oncekiSeri = (seriMap?.get(canonical) || []).slice(2, 5);
        const oncekiVerili = oncekiSeri.filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        );
        const onceki3AyOrt = oncekiVerili.length > 0
          ? oncekiVerili.reduce((sum, v) => sum + v, 0) / oncekiVerili.length
          : null;
        const degisimYuzde =
          onceki3AyOrt === null || onceki3AyOrt <= 0
            ? null
            : ((testAdedi - onceki3AyOrt) / onceki3AyOrt) * 100;
        const gunlukTuketim = ambalaj > 0 ? testAdedi / ambalaj / daysInPeriod : 0;

        const testSerisi = seriMap?.get(canonical);
        const trend = hesaplaTuketimTrendi(
          seriDonemleri.map((donem, i) => {
            const test = testSerisi ? testSerisi[i] : null;
            return {
              donem,
              kutu: test === null || test === undefined || ambalaj <= 0 ? null : test / ambalaj,
            };
          }),
        );

        const labStok = labStokMap?.get(canonical) || 0;
        const cihazUstuTest = cihazMap?.get(canonical) || 0;
        const cihazUstuKutu = ambalaj > 0 ? Math.round(cihazUstuTest / ambalaj) : 0;

        if (gunlukMinMax <= 0 && gunlukTuketim <= 0) return;

        // Laboratuvar perspektifi: "ana depo stoğu" o labın kendi stoğudur;
        // saha/yoldaki kavramları burada geçerli değil.
        const oneri = hesaplaOneri({
          gunlukMinMax,
          gunlukTuketim,
          basis: demandBasis,
          trend,
          hedefGun: gunGecerli ? hedefGun : 0,
          anaDepoStok: labStok,
          sahaStok: 0,
          cihazUstuKutu,
          acikSiparis: 0,
          // Kurumun taşıyabileceği tavan: sevk sonrası eldeki toplam bunu aşmasın.
          kurumMax: max,
          sayimEksikLab: eksikSayim,
          toplamLab: sayimEksik.total,
        });

        araSatirlar.push({
          key: `${labId}:${code}`,
          labId,
          labAdi,
          stokKodu: code,
          stokAdi: product?.stokAdi || code,
          labStok,
          cihazUstuTest,
          cihazUstuKutu,
          testAdedi,
          onceki3AyOrt,
          degisimYuzde,
          oneri,
          anaDepoStok: anaDepoStokByCode.get(canonical) || 0,
          kurumMax: max,
        });
      });
    });

    // 2) Ürün bazında sınırlı depo stoğunu aciliyete göre dağıt
    const grupByCode = new Map<string, typeof araSatirlar>();
    araSatirlar.forEach(satir => {
      const canonical = normCode(satir.stokKodu);
      const list = grupByCode.get(canonical) || [];
      list.push(satir);
      grupByCode.set(canonical, list);
    });

    const sonuc: SevkSatiri[] = [];
    grupByCode.forEach((grup, canonical) => {
      const depoStok = anaDepoStokByCode.get(canonical) || 0;
      const { paylar } = dagitimYap(
        grup.map(s => ({
          id: s.key,
          ihtiyac: s.oneri.oneriAdet,
          kapsamaGun: s.oneri.kapsamaGun,
        })),
        depoStok,
      );
      const payByKey = new Map(paylar.map(p => [p.id, p]));

      // 3) Lotlar depodan FEFO ile ayrılır ve aynı aciliyet sırasıyla kurumlara
      // yazılır: en acil kurum en yakın miatlı lotu alır. Böylece hem miada
      // yakın stok en hızlı tüketen kuruma gider hem de her satırın gerçekte
      // hangi lotu aldığı — dolayısıyla riski — belli olur.
      const havuz = (anaDepoLotlariByCode.get(canonical) || []).map(l => ({ ...l }));
      let havuzIndex = 0;
      const lotlarByKey = new Map<string, AyrilanLot[]>();
      [...grup]
        .sort((a, b) => (payByKey.get(a.key)?.sira ?? 0) - (payByKey.get(b.key)?.sira ?? 0))
        .forEach(satir => {
          let kalan = payByKey.get(satir.key)?.sevkAdedi ?? 0;
          const ayrilan: AyrilanLot[] = [];
          while (kalan > 0 && havuzIndex < havuz.length) {
            const lot = havuz[havuzIndex];
            const alinan = Math.min(kalan, lot.adet);
            if (alinan > 0) {
              ayrilan.push({
                lot: lot.lot,
                miadMetni: lot.miadMetni,
                miatGun: lot.miatGun,
                adet: alinan,
              });
              lot.adet -= alinan;
              kalan -= alinan;
            }
            if (lot.adet <= 0) havuzIndex += 1;
          }
          lotlarByKey.set(satir.key, ayrilan);
        });

      grup.forEach(satir => {
        const pay = payByKey.get(satir.key);
        const sevkLotlari = lotlarByKey.get(satir.key) ?? [];
        sonuc.push({
          ...satir,
          sevkAdedi: pay?.sevkAdedi ?? 0,
          karsilanamayan: pay?.karsilanamayan ?? 0,
          sevkLotlari,
          risk: hesaplaRiskliSevk({
            lotlar: sevkLotlari,
            gunlukIhtiyac: satir.oneri.gunlukIhtiyac,
            // Kurumda önce tüketilecek stok: sayım stoğu + cihaz üstü.
            mevcutStok: satir.labStok + satir.cihazUstuKutu,
          }),
        });
      });
    });

    const oncelik: Record<OneriTipi, number> = {
      'acil-siparis': 0, siparis: 1, 'veri-yok': 2, 'fazla-stok': 3, yeterli: 4,
    };
    return sonuc.sort(
      (a, b) =>
        oncelik[a.oneri.tip] - oncelik[b.oneri.tip] ||
        b.sevkAdedi - a.sevkAdedi ||
        a.labAdi.localeCompare(b.labAdi, 'tr') ||
        a.stokAdi.localeCompare(b.stokAdi, 'tr'),
    );
  }, [
    anaDepo, enabled, yeterlilikGun, labIds, rulesByLab, labInfoById,
    labStokByLab, cihazUstuByLab, kumulatifByLab, seriByLab, seriDonemleri,
    productByStockCode, anaDepoStokByCode, anaDepoLotlariByCode, demandBasis,
    daysInPeriod, sayimEksik,
  ]);

  const sevkEdilecek = useMemo(() => rows.filter(r => r.sevkAdedi > 0), [rows]);
  const toplamSevk = useMemo(() => sevkEdilecek.reduce((s, r) => s + r.sevkAdedi, 0), [sevkEdilecek]);
  const toplamKarsilanamayan = useMemo(() => rows.reduce((s, r) => s + r.karsilanamayan, 0), [rows]);
  const toplamRiskli = useMemo(() => rows.reduce((s, r) => s + r.risk.riskliAdet, 0), [rows]);
  const maxKirpilanSatir = useMemo(
    () => rows.filter(r => r.oneri.maxKirpma > 0).length,
    [rows],
  );
  const oneriOzeti = useMemo(() => {
    const sayac: Record<OneriTipi, number> = {
      'acil-siparis': 0, siparis: 0, yeterli: 0, 'fazla-stok': 0, 'veri-yok': 0,
    };
    rows.forEach(r => { sayac[r.oneri.tip] += 1; });
    return sayac;
  }, [rows]);

  const periodKey = `${String(selectedMonth).padStart(2, '0')}-${selectedYear}`;
  /** "Son 3 Ay Ort." sütununun hangi dönemleri kapsadığı — başlıkta yazılır. */
  const onceki3AyLabel = useMemo(
    () => seriDonemleri.slice(2, 5).join(', '),
    [seriDonemleri],
  );
  const dataLoading = enabled && (productsLoading || rulesLoading || veriLoading);

  /** Sevk listesini laboratuvar bazında `hospitalShipmentPlans` altına kaydeder. */
  const handleKaydet = async () => {
    if (sevkEdilecek.length === 0) return;
    setIsSaving(true);
    try {
      const byLab = new Map<string, SevkSatiri[]>();
      sevkEdilecek.forEach(r => {
        const list = byLab.get(r.labId) || [];
        list.push(r);
        byLab.set(r.labId, list);
      });

      await Promise.all(
        Array.from(byLab.entries()).map(([labId, satirlar]) => {
          const id = generateId();
          return setDoc(
            doc(db, 'hospitalShipmentPlans', id),
            withCompanyScope(
              {
                status: 'bekliyor' as const,
                labId,
                labAdi: satirlar[0].labAdi,
                donem: periodKey,
                yeterlilikGun: Number(yeterlilikGun),
                ihtiyacKaynagi: demandBasis,
                anaDepoId: anaDepo?.id || '',
                anaDepoAdi: anaDepo?.name || '',
                items: satirlar.map(s => ({
                  stokKodu: s.stokKodu,
                  stokAdi: s.stokAdi,
                  labStok: s.labStok,
                  cihazUstuKutu: s.cihazUstuKutu,
                  kurumMax: s.kurumMax,
                  gerekliAdet: s.oneri.gerekliAdet,
                  sevkAdedi: s.sevkAdedi,
                  karsilanamayan: s.karsilanamayan,
                  maxKirpma: s.oneri.maxKirpma,
                  riskliAdet: s.risk.riskliAdet,
                  // Sevk anındaki lot ayrımı sonradan denetlenebilsin diye saklanır.
                  lotlar: s.sevkLotlari.map(l => ({
                    lot: l.lot,
                    miad: l.miadMetni,
                    miatGun: l.miatGun,
                    adet: l.adet,
                  })),
                })),
                toplamKalem: satirlar.length,
                toplamAdet: satirlar.reduce((sum, s) => sum + s.sevkAdedi, 0),
                toplamRiskliAdet: satirlar.reduce((sum, s) => sum + s.risk.riskliAdet, 0),
                createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmiyor',
                createdById: currentUserProfile?.uid || currentUser?.uid || '',
                createdAt: serverTimestamp(),
              },
              currentUserProfile?.companyId,
            ),
          );
        }),
      );
      toast({
        title: 'Sevkiyat planı oluşturuldu',
        description: `${byLab.size} laboratuvar için ${toplamSevk} kutu planlandı.`,
      });
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sevkiyat planı kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1700px] px-1 py-2 sm:px-2 sm:py-4">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-[#587169] transition-colors hover:bg-white/60 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:text-[#a994b5] dark:hover:bg-white/5 dark:hover:text-fuchsia-200"
            onClick={() => router.push(LOJISTIK_HOME_PATH)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Lojistik ana sayfa
          </button>
          <div className="mt-2 flex items-center gap-2 text-emerald-600 dark:text-fuchsia-300">
            <Truck className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-extrabold uppercase tracking-[0.18em]">Lojistik çalışma alanı</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#0f2a24] dark:text-[#f4ecfa] sm:text-4xl">
            Sevkiyatlar
          </h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#587169] dark:text-[#a994b5] sm:text-base">
            Ana depoya bağlı laboratuvarların dönemsel ihtiyacını hesaplar ve depodaki stoğu
            aciliyet sırasına göre dağıtır.
          </p>
        </div>
        <button
          type="button"
          onClick={handleKaydet}
          disabled={isSaving || sevkEdilecek.length === 0}
          className={`${PRIMARY_BTN_CLASS} self-start py-2 xl:self-auto`}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Sevkiyatı Oluştur
          {sevkEdilecek.length > 0 && (
            <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-extrabold">
              {sevkEdilecek.length}
            </span>
          )}
        </button>
      </header>

      {!depotsLoading && !anaDepo && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          <Star className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Ana depo seçilmemiş.</p>
            <p className="font-medium">Yönetim → Tanımlar → Depo Yönetimi üzerinden bir depoyu <b>Ana Depo</b> olarak işaretleyin.</p>
          </div>
        </div>
      )}

      {/* Seçim alanı */}
      <section className={`${PANEL_CLASS} mb-5 p-5`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Dönem (Ay)</label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Dönem (Yıl)</label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Ana Depo</label>
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-950/10 bg-white/60 px-3 text-sm font-bold text-[#29473f] dark:border-fuchsia-300/20 dark:bg-white/[0.035] dark:text-[#d6bfe3]">
              {anaDepo ? (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="truncate">{anaDepo.name}</span>
                </span>
              ) : (
                <span className="font-semibold text-[#587169] dark:text-[#a994b5]">Seçilmedi</span>
              )}
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setHazirla(true)}
              disabled={!anaDepo || labIds.length === 0 || dataLoading}
              className={`${PRIMARY_BTN_CLASS} w-full py-2`}
            >
              {dataLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
              Sevkiyatı Hazırla
            </button>
          </div>
        </div>
        {anaDepo && (
          <p className="mt-3 text-xs font-semibold text-[#587169] dark:text-[#a994b5]">
            Kapsam: <b className="text-[#29473f] dark:text-[#d6bfe3]">{anaDepo.name}</b> → {labIds.length} bağlı laboratuvar
          </p>
        )}
      </section>

      {/* Sevk tablosu */}
      <section className={`${PANEL_CLASS} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">
            <Truck className="h-5 w-5 text-emerald-600 dark:text-fuchsia-300" />
            Sevk Listesi
            <span className="font-semibold text-[#587169] dark:text-[#a994b5]">— {periodKey}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor="kaynak" className="whitespace-nowrap text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">İhtiyaç Kaynağı</label>
              <Select value={demandBasis} onValueChange={(v) => setDemandBasis(v as DemandBasis)}>
                <SelectTrigger id="kaynak" className={`w-40 ${CONTROL_CLASS}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEMAND_BASIS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="yeterlilik" className="whitespace-nowrap text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">Yeterlilik Gün</label>
              <Input
                id="yeterlilik"
                type="number"
                min={1}
                className={`w-24 ${CONTROL_CLASS}`}
                value={yeterlilikGun}
                onChange={(e) => setYeterlilikGun(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>
        </div>

        {depotsLoading ? (
          <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" /> Depolar yükleniyor…
          </div>
        ) : !anaDepo ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <Star className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Önce bir ana depo tanımlayın.</p>
          </div>
        ) : labIds.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <Truck className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Ana depoya bağlı laboratuvar yok.</p>
            <p className="mt-2 max-w-lg text-sm text-[#587169] dark:text-[#a994b5]">Depo Yönetimi&apos;nden bu depoya laboratuvar bağlayın.</p>
          </div>
        ) : !enabled ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <PackageSearch className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Dönemi seçip &quot;Sevkiyatı Hazırla&quot; deyin.</p>
          </div>
        ) : dataLoading ? (
          <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" /> Veriler hazırlanıyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <PackageSearch className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Hesaplanacak satır yok</p>
            <p className="mt-2 max-w-lg text-sm text-[#587169] dark:text-[#a994b5]">Bağlı laboratuvarlarda min/max tanımlı ürün bulunamadı.</p>
          </div>
        ) : (
          <>
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full min-w-[1560px] border-separate border-spacing-0 text-left">
                <thead className="sticky top-0 z-10 bg-[#f7fcf9]/95 text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] backdrop-blur dark:bg-[#160e1e]/95 dark:text-[#a994b5]">
                  <tr>
                    <th className="px-5 py-4">Laboratuvar</th>
                    <th className="px-4 py-4">Ürün</th>
                    <th className="px-4 py-4 text-right">Lab Stok</th>
                    <th className="px-4 py-4 text-right">Cihaz Üstü</th>
                    <th className="px-4 py-4 text-right">
                      Tüketim
                      <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">kümülatif test · {periodKey}</span>
                    </th>
                    <th className="px-4 py-4 text-right">
                      Son 3 Ay Ort.
                      <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">
                        {onceki3AyLabel || 'veri yok'}
                      </span>
                    </th>
                    <th className="px-4 py-4 text-right">
                      Değişim
                      <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">3 ay ort.'ya göre</span>
                    </th>
                    <th className="px-4 py-4 text-right" title="Kurumun tanımlı max adedi">Kurum Max</th>
                    <th className="px-4 py-4 text-right">Kapsama</th>
                    <th className="px-4 py-4 text-right">Gerekli</th>
                    <th className="px-4 py-4 text-right">Ana Depo</th>
                    <th
                      className="px-4 py-4 text-right"
                      title="Sevk edilen lotların miadı dolmadan tüketilemeyecek kısmı"
                    >
                      Riskli
                    </th>
                    <th className="px-5 py-4 text-right">Sevk</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const isOpen = expandedKey === row.key;
                    return (
                      <React.Fragment key={row.key}>
                        <tr
                          className={`cursor-pointer text-sm transition-colors hover:bg-emerald-50/70 dark:hover:bg-fuchsia-300/[0.055] ${row.sevkAdedi > 0 ? '' : 'opacity-60'}`}
                          onClick={() => setExpandedKey(isOpen ? null : row.key)}
                          title="Hesap detayını aç/kapat"
                        >
                          <td className="border-t border-emerald-950/10 px-5 py-3.5 font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            <span className="flex items-center gap-1.5">
                              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-emerald-600 transition-transform dark:text-fuchsia-300 ${isOpen ? 'rotate-90' : ''}`} />
                              <span className="truncate">{row.labAdi}</span>
                            </span>
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 font-semibold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            {row.stokAdi}
                            <span className="block font-mono text-[10px] font-bold text-[#70857e] dark:text-[#8e7c9a]">{row.stokKodu}</span>
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">{row.labStok}</td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            {row.cihazUstuKutu > 0 ? row.cihazUstuKutu : <span className="text-[#70857e] dark:text-[#8e7c9a]">0</span>}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            {row.testAdedi > 0 ? fmt(row.testAdedi, 0) : <span className="text-[#70857e] dark:text-[#8e7c9a]">0</span>}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            {row.onceki3AyOrt === null ? (
                              <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>
                            ) : (
                              fmt(row.onceki3AyOrt, 0)
                            )}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right dark:border-fuchsia-300/15">
                            <DegisimChip value={row.degisimYuzde} />
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-semibold dark:border-fuchsia-300/15">
                            {row.kurumMax > 0 ? (
                              <span
                                className={
                                  row.oneri.maxKirpma > 0
                                    ? 'font-black text-amber-700 dark:text-amber-300'
                                    : 'text-[#70857e] dark:text-[#8e7c9a]'
                                }
                                title={
                                  row.oneri.maxKirpma > 0
                                    ? `Tavan nedeniyle ${row.oneri.maxKirpma} kutu düşüldü`
                                    : undefined
                                }
                              >
                                {row.kurumMax}
                              </span>
                            ) : (
                              <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>
                            )}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold dark:border-fuchsia-300/15">
                            {row.oneri.kapsamaGun === null ? (
                              <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>
                            ) : (
                              <span className={row.oneri.tip === 'acil-siparis' ? 'text-rose-700 dark:text-rose-300' : 'text-[#29473f] dark:text-[#d6bfe3]'}>
                                {fmt(row.oneri.kapsamaGun, 0)} gün
                              </span>
                            )}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                            {row.oneri.oneriAdet}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-semibold text-[#70857e] dark:border-fuchsia-300/15 dark:text-[#8e7c9a]">
                            {row.anaDepoStok}
                          </td>
                          <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums dark:border-fuchsia-300/15">
                            {row.sevkAdedi === 0 ? (
                              <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>
                            ) : row.risk.riskliAdet > 0 ? (
                              <span
                                className="font-black text-amber-700 dark:text-amber-300"
                                title={`En yakın miad ${row.risk.enYakinMiatGun} gün`}
                              >
                                ⚠ {row.risk.riskliAdet}
                              </span>
                            ) : row.risk.degerlendirilemeyenAdet > 0 ? (
                              <span
                                className="font-bold text-[#70857e] dark:text-[#8e7c9a]"
                                title="Miad bilgisi olmayan lotlar sevk ediliyor"
                              >
                                ?
                              </span>
                            ) : (
                              <span className="font-bold text-emerald-600 dark:text-fuchsia-300">0</span>
                            )}
                          </td>
                          <td className="border-t border-emerald-950/10 px-5 py-3.5 text-right dark:border-fuchsia-300/15">
                            <span className="flex flex-col items-end gap-1">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${ONERI_STILI[row.oneri.tip].chip}`}>
                                {row.oneri.guvenilirlik !== 'yuksek' && <AlertTriangle className="h-3 w-3 shrink-0" />}
                                {ONERI_STILI[row.oneri.tip].kisa}
                              </span>
                              {row.sevkAdedi > 0 && (
                                <span className="text-lg font-black tabular-nums text-emerald-600 dark:text-fuchsia-300">{row.sevkAdedi}</span>
                              )}
                              {row.karsilanamayan > 0 && (
                                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                                  depoda {row.karsilanamayan} eksik
                                </span>
                              )}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={13} className="border-t border-emerald-950/10 bg-emerald-50/45 px-5 py-4 dark:border-fuchsia-300/15 dark:bg-fuchsia-300/[0.04]">
                              <div className="rounded-2xl border border-emerald-950/10 bg-white/70 p-4 dark:border-fuchsia-300/15 dark:bg-white/[0.04]">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black ${ONERI_STILI[row.oneri.tip].chip}`}>
                                    {row.oneri.baslik.replace('SİPARİŞ', 'SEVK')}
                                  </span>
                                  {row.sevkAdedi > 0 && (
                                    <span className="text-xl font-black tabular-nums text-emerald-600 dark:text-fuchsia-300">{row.sevkAdedi} kutu</span>
                                  )}
                                  <span className="text-[11px] font-bold text-[#70857e] dark:text-[#8e7c9a]">
                                    güvenilirlik: {row.oneri.guvenilirlik === 'yuksek' ? 'yüksek' : row.oneri.guvenilirlik === 'orta' ? 'orta' : 'düşük'}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm font-semibold leading-6 text-[#29473f] dark:text-[#d6bfe3]">
                                  {row.oneri.aciklama}
                                </p>
                                {row.karsilanamayan > 0 && (
                                  <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    Ana depoda yeterli stok yok: {row.oneri.oneriAdet} gerekiyordu, {row.sevkAdedi} sevk edilebiliyor.
                                    Depoda bu üründen toplam {row.anaDepoStok} kutu var ve daha acil laboratuvarlara öncelik verildi.
                                  </p>
                                )}
                                {row.sevkLotlari.length > 0 && (
                                  <div className="mt-3 border-t border-emerald-950/10 pt-3 dark:border-fuchsia-300/15">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">
                                      Ayrılan lotlar (miadı yakından uzağa)
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {row.sevkLotlari.map((lot, i) => {
                                        const riskli =
                                          row.risk.detay.find(d => d.lot === lot.lot)?.riskliAdet ?? 0;
                                        return (
                                          <span
                                            key={`${lot.lot}-${i}`}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                              riskli > 0
                                                ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/20 dark:text-amber-200'
                                                : 'border-emerald-950/10 bg-white/70 text-[#29473f] dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#d6bfe3]'
                                            }`}
                                          >
                                            <span className="font-mono">{lot.lot}</span>
                                            <span>· {lot.adet} kutu</span>
                                            <span
                                              className="opacity-70"
                                              title={lot.miadMetni || undefined}
                                            >
                                              ·{' '}
                                              {lot.miatGun !== null
                                                ? `${lot.miatGun} gün`
                                                : lot.miadMetni
                                                  ? `miad okunamadı (${lot.miadMetni})`
                                                  : 'miad girilmemiş'}
                                            </span>
                                            {riskli > 0 && <span>· {riskli} riskli</span>}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    {row.risk.riskliAdet > 0 ? (
                                      <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        Kurum günde {fmt(row.oneri.gunlukIhtiyac)} kutu tüketiyor ve sevkten
                                        önce elinde {row.labStok + row.cihazUstuKutu} kutu var; bu hızla{' '}
                                        {row.risk.riskliAdet} kutu miadı dolmadan kullanılamaz. Daha uzak miatlı
                                        lot varsa onu sevk edin veya adedi düşürün.
                                      </p>
                                    ) : row.risk.degerlendirilemeyenAdet > 0 ? (
                                      <p className="mt-2 text-xs font-semibold text-[#587169] dark:text-[#a994b5]">
                                        {row.risk.degerlendirilemeyenAdet} kutunun miadı okunamadığı için miad
                                        riski hesaplanamadı ve bu lotlar FEFO sıralamasında en sona alındı.
                                        Depodaki lot kaydını kontrol edin.
                                      </p>
                                    ) : (
                                      <p className="mt-2 text-xs font-semibold text-[#587169] dark:text-[#a994b5]">
                                        Sevk edilen tüm lotlar miadı dolmadan tüketilebiliyor.
                                      </p>
                                    )}
                                  </div>
                                )}
                                {row.oneri.uyarilar.length > 0 && (
                                  <ul className="mt-2 space-y-1">
                                    {row.oneri.uyarilar.map((u, i) => (
                                      <li key={i} className="flex items-start gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        {u}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-950/10 px-5 py-3 text-sm dark:border-fuchsia-300/15">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-[#587169] dark:text-[#a994b5]">
                <span>{rows.length} satır</span>
                {ONERI_OZET_SIRASI.map(tip => {
                  const adet = oneriOzeti[tip];
                  if (!adet) return null;
                  return (
                    <span key={tip} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${ONERI_STILI[tip].chip}`}>
                      {ONERI_STILI[tip].kisa}: {adet}
                    </span>
                  );
                })}
                {sayimEksik.total > 0 && (
                  <span className={sayimEksik.counted < sayimEksik.total ? 'text-amber-700 dark:text-amber-300' : ''}>
                    · saha sayımı {sayimEksik.counted}/{sayimEksik.total} lab
                  </span>
                )}
              </span>
              <span className="font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">Toplam Sevk: {toplamSevk} kutu</span>
            </div>
            {toplamKarsilanamayan > 0 && (
              <p className="flex items-start gap-1.5 border-t border-emerald-950/10 px-5 py-2.5 text-xs font-semibold text-rose-700 dark:border-fuchsia-300/15 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Ana depo stoğu {toplamKarsilanamayan} kutu yetersiz. Dağıtım aciliyet sırasına göre yapıldı;
                  eksik kalan laboratuvarlar için tedarikçi siparişi gerekebilir.
                </span>
              </p>
            )}
            {toplamRiskli > 0 && (
              <p className="flex items-start gap-1.5 border-t border-emerald-950/10 px-5 py-2.5 text-xs font-semibold text-amber-700 dark:border-fuchsia-300/15 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Sevk edilecek lotların {toplamRiskli} kutusu kurumda miadı dolmadan tüketilemeyecek.
                  Satırı açıp hangi lotun riskli olduğunu görebilir, daha uzak miatlı lot varsa onu tercih
                  edebilirsiniz.
                </span>
              </p>
            )}
            {maxKirpilanSatir > 0 && (
              <p className="flex items-start gap-1.5 border-t border-emerald-950/10 px-5 py-2.5 text-xs font-semibold text-[#587169] dark:border-fuchsia-300/15 dark:text-[#a994b5]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {maxKirpilanSatir} satırda hedef gün daha fazlasını isterdi; kurumların tanımlı max adedi
                  aşılmasın diye sevk miktarı düşürüldü.
                </span>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
