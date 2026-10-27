'use server';
import type * as DocumentStore from '../lib/data/admin';


import { adminDb } from '../lib/data/admin';
import { normalizeCompanyId } from '@/lib/company-scope';
import {
  birlestir,
  bosSnapshot,
  kronolojikBirlestir,
} from '@/lib/lab-period/merge';
import {
  donemAnahtari,
  snapshotDocId,
  type Kaynak,
  type LabDonemSnapshot,
  type OlcumGirdisi,
  type YazmaBaglami,
} from '@/lib/lab-period/types';

const KOLEKSIYON = 'labPeriodSnapshots';

type AdminQuery = DocumentStore.Query;
type AdminDocSnap = DocumentStore.QueryDocumentSnapshot;

/** Şirket + `__legacy__` kapsamında sorgu çalıştırır (getScopedDocs'un Admin SDK karşılığı). */
async function kapsamliCalistir(
  base: AdminQuery,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<AdminDocSnap[]> {
  if (isSuperAdmin) return (await base.get()).docs as AdminDocSnap[];
  const normalized = normalizeCompanyId(companyId);
  const [cs, ls] = await Promise.all([
    base.where('companyId', '==', normalized).get(),
    base.where('companyId', '==', '__legacy__').get(),
  ]);
  const gorulen = new Set<string>();
  const out: AdminDocSnap[] = [];
  for (const snap of [cs, ls]) {
    for (const d of snap.docs as AdminDocSnap[]) {
      if (!gorulen.has(d.id)) {
        gorulen.add(d.id);
        out.push(d);
      }
    }
  }
  return out;
}

function millis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const sayi = Number(value);
  return Number.isFinite(sayi) ? sayi : 0;
}

/** Firestore `undefined` kabul etmez; snapshot'ı yazmadan önce temizler. */
function yazilabilir(snapshot: LabDonemSnapshot): Record<string, unknown> {
  return JSON.parse(JSON.stringify(snapshot));
}

/**
 * Verilen laboratuvarların bir dönemdeki snapshot'larını döndürür.
 *
 * Okuyan paneller için tek giriş noktasıdır: stok, cihaz üstü ve kümülatif
 * artık beş ayrı koleksiyondan değil buradan okunur.
 */
export async function getLabPeriodSnapshots(
  labIds: string[],
  yil: number,
  ay: number,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, LabDonemSnapshot>> {
  const istenen = Array.from(
    new Set((labIds || []).map(id => String(id || '').trim()).filter(Boolean)),
  );
  if (istenen.length === 0 || !Number.isFinite(yil) || !Number.isFinite(ay)) return {};

  const donem = donemAnahtari(yil, ay);
  const out: Record<string, LabDonemSnapshot> = {};
  try {
    // Doküman kimliği (şirket, lab, dönem) üçlüsünden türetildiği için doğrudan
    // getAll ile çekilir — sorgu ve indeks gerekmez.
    const normalized = normalizeCompanyId(companyId);
    const refs = istenen.flatMap(labId => {
      const kimlikler = [snapshotDocId(normalized, labId, donem)];
      // companyId'siz eski kayıtlar `__legacy__` altında durur.
      if (normalized !== '__legacy__') kimlikler.push(snapshotDocId('__legacy__', labId, donem));
      return kimlikler.map(id => adminDb.collection(KOLEKSIYON).doc(id));
    });
    if (refs.length === 0) return {};

    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() as LabDonemSnapshot;
      const labId = String(data?.labId || '').trim();
      if (!labId) continue;
      // Aynı lab için hem şirket hem legacy kayıt varsa şirket kaydı esastır.
      const mevcut = out[labId];
      if (!mevcut || (mevcut.companyId === '__legacy__' && data.companyId !== '__legacy__')) {
        out[labId] = data;
      }
    }
    return out;
  } catch (err) {
    console.error('[getLabPeriodSnapshots] Error:', err);
    return {};
  }
}

/**
 * Birden çok dönemin snapshot'larını tek çağrıda döndürür.
 * Anahtar `YYYY-MM`. Trend hesapları 6 dönem istediği için gereklidir.
 */
export async function getLabPeriodSnapshotsForPeriods(
  labIds: string[],
  donemler: Array<{ yil: number; ay: number }>,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, Record<string, LabDonemSnapshot>>> {
  const tekil = new Map<string, { yil: number; ay: number }>();
  (donemler || []).forEach(p => {
    if (!p || !Number.isFinite(p.yil) || !Number.isFinite(p.ay)) return;
    tekil.set(donemAnahtari(p.yil, p.ay), p);
  });
  const girisler = await Promise.all(
    Array.from(tekil.entries()).map(async ([anahtar, p]) => {
      const snapshots = await getLabPeriodSnapshots(labIds, p.yil, p.ay, companyId, isSuperAdmin);
      return [anahtar, snapshots] as const;
    }),
  );
  return Object.fromEntries(girisler);
}

/**
 * Bir panelin girdiği ölçümleri lab-dönem snapshot'ına işler.
 *
 * Kural `birlestir()` içindedir: alan boşsa gelen değer sayımı kurar, aynıysa
 * dokunulmaz, farklıysa düzenleme sayılır. Panel kaydederken bu çağrının
 * başarısız olması asıl kaydı bozmamalıdır — çağıran hatayı yutmalı, sonuç
 * `null` dönebilir.
 */
export async function upsertLabPeriodOlcumler(input: {
  labId: string;
  labAdi: string;
  yil: number;
  ay: number;
  girdiler: OlcumGirdisi[];
  baglam: YazmaBaglami;
  companyId?: string | null;
}): Promise<{ eklenen: number; guncellenen: number; degismeyen: number } | null> {
  const labId = String(input?.labId || '').trim();
  if (!labId || !Number.isFinite(input?.yil) || !Number.isFinite(input?.ay)) return null;
  const girdiler = (input.girdiler || []).filter(g => g && g.stokKodu);
  if (girdiler.length === 0) return null;

  const normalized = normalizeCompanyId(input.companyId);
  const donem = donemAnahtari(input.yil, input.ay);
  const ref = adminDb.collection(KOLEKSIYON).doc(snapshotDocId(normalized, labId, donem));

  try {
    // İki panel aynı anda kaydedebilir; okuma-birleştirme-yazma işlemi
    // transaction içinde yapılmazsa biri diğerinin ölçümünü silebilir.
    return await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const mevcut = snap.exists
        ? (snap.data() as LabDonemSnapshot)
        : bosSnapshot(normalized, labId, input.labAdi || labId, input.yil, input.ay);
      // Lab adı sonradan değişmiş olabilir.
      if (input.labAdi) mevcut.labAdi = input.labAdi;

      const sonuc = birlestir(mevcut, girdiler, {
        ...input.baglam,
        zaman: input.baglam?.zaman ?? Date.now(),
      });
      if (sonuc.eklenen === 0 && sonuc.guncellenen === 0 && snap.exists) {
        return { eklenen: 0, guncellenen: 0, degismeyen: sonuc.degismeyen };
      }
      tx.set(ref, yazilabilir(sonuc.snapshot));
      return {
        eklenen: sonuc.eklenen,
        guncellenen: sonuc.guncellenen,
        degismeyen: sonuc.degismeyen,
      };
    });
  } catch (err) {
    console.error('[upsertLabPeriodOlcumler] Error for lab', labId, donem, ':', err);
    return null;
  }
}

/* ================================================================
   Geriye dönük aktarım
   ================================================================ */

/** Bir kaynak kaydın snapshot'a çevrilmiş hali. */
interface AktarimPartisi {
  labId: string;
  labAdi: string;
  yil: number;
  ay: number;
  girdiler: OlcumGirdisi[];
  baglam: YazmaBaglami;
}

export interface AktarimOzeti {
  /** Taranan kaynak kayıt sayısı (koleksiyon başına) */
  taranan: Record<string, number>;
  /** Etkilenen lab-dönem sayısı */
  etkilenenSnapshot: number;
  eklenen: number;
  guncellenen: number;
  degismeyen: number;
  /** Yalnızca önizleme yapıldıysa true — hiçbir şey yazılmadı */
  onizleme: boolean;
  hatalar: string[];
}

function ekle(
  hedef: AktarimPartisi[],
  labId: string,
  labAdi: string,
  yil: number,
  ay: number,
  girdiler: OlcumGirdisi[],
  kaynak: Kaynak,
  kayitId: string,
  zaman: number,
  girenAdi?: string,
) {
  const temizLab = String(labId || '').trim();
  if (!temizLab || !Number.isFinite(yil) || !Number.isFinite(ay) || ay < 1 || ay > 12) return;
  const gecerli = girdiler.filter(g => g && g.stokKodu && Number.isFinite(g.deger) && g.deger >= 0);
  if (gecerli.length === 0) return;
  hedef.push({
    labId: temizLab,
    labAdi: labAdi || temizLab,
    yil,
    ay,
    girdiler: gecerli,
    baglam: { kaynak, kaynakKayitId: kayitId, girenAdi, zaman },
  });
}

/**
 * Beş eski koleksiyonu tarayıp lab-dönem snapshot'larına aktarır.
 *
 * Yönetim panelinden elle tetiklenir. `onizleme: true` ile çalıştırıldığında
 * hiçbir şey yazmaz, yalnızca ne olacağını raporlar.
 *
 * Aktarım tekrar çalıştırılabilir: her kaynak kaydın kimliği snapshot'ta
 * saklanır ve ikinci geçişte atlanır, böylece aradaki canlı düzenlemeler
 * geri alınmaz.
 */
export async function backfillLabPeriodSnapshots(
  companyId?: string | null,
  isSuperAdmin?: boolean,
  secenekler?: { onizleme?: boolean },
): Promise<AktarimOzeti> {
  const onizleme = secenekler?.onizleme === true;
  const ozet: AktarimOzeti = {
    taranan: {},
    etkilenenSnapshot: 0,
    eklenen: 0,
    guncellenen: 0,
    degismeyen: 0,
    onizleme,
    hatalar: [],
  };
  const partiler: AktarimPartisi[] = [];
  const normalized = normalizeCompanyId(companyId);

  // Lab adlarını tek seferde çöz — kaynak kayıtların hepsi adı taşımıyor.
  const labAdlari = new Map<string, string>();
  try {
    const hospitals = await kapsamliCalistir(
      adminDb.collection('hospitals'),
      companyId,
      isSuperAdmin,
    );
    hospitals.forEach(d => {
      const data = d.data() as any;
      labAdlari.set(d.id, String(data?.name || data?.ad || d.id));
    });
  } catch (err) {
    ozet.hatalar.push(`Laboratuvar adları okunamadı: ${(err as Error)?.message}`);
  }
  const adiniBul = (labId: string) => labAdlari.get(labId) || labId;

  /* 1) Lab sayım paneli — hospitals/{labId}/stockCounts */
  try {
    const snap = await adminDb.collectionGroup('stockCounts').get();
    ozet.taranan['Lab Sayım'] = snap.size;
    snap.docs.forEach(d => {
      const data = d.data() as any;
      const labId = String(data?.laboratoryId || d.ref.parent.parent?.id || '').trim();
      if (!labId) return;
      if (!isSuperAdmin && !labAdlari.has(labId)) return; // kapsam dışı tenant
      // stockCounts.month 0-indekslidir.
      const yil = Number(data?.year);
      const ay = Number(data?.month) + 1;
      const girdiler: OlcumGirdisi[] = [];
      ((data?.items || []) as any[]).forEach(it => {
        const kod = String(it?.stokKodu || '').trim();
        if (!kod) return;
        const sayilan = Number(it?.counted);
        if (Number.isFinite(sayilan)) girdiler.push({ stokKodu: kod, alan: 'stok', deger: sayilan });
        const acikTest = Number(it?.openTestQty);
        if (Number.isFinite(acikTest) && acikTest > 0) {
          girdiler.push({ stokKodu: kod, alan: 'cihazUstu', deger: acikTest });
        }
      });
      ekle(
        partiler, labId, String(data?.laboratoryName || adiniBul(labId)), yil, ay, girdiler,
        'lab-sayim', d.id, millis(data?.finishedAt) || millis(data?.startedAt),
        String(data?.createdByName || ''),
      );
    });
  } catch (err) {
    ozet.hatalar.push(`Lab sayımları okunamadı: ${(err as Error)?.message}`);
  }

  /* 2) Maliyet sayım paneli — maliyetSayimSessions (yalnızca lab konumları) */
  try {
    const docs = await kapsamliCalistir(
      adminDb.collection('maliyetSayimSessions'),
      companyId,
      isSuperAdmin,
    );
    ozet.taranan['Maliyet Sayım'] = docs.length;
    docs.forEach(d => {
      const data = d.data() as any;
      if (String(data?.locationType || '') !== 'lab') return;
      const labId = String(data?.locationId || '').trim();
      const yil = Number(data?.year);
      // maliyetSayimSessions.month, panelin getMonth() değeridir → 0-indeksli.
      const ay = Number(data?.month) + 1;
      const girdiler: OlcumGirdisi[] = [];
      ((data?.items || []) as any[]).forEach(it => {
        const kod = String(it?.stokKodu || '').trim();
        if (!kod) return;
        const stok = Number(it?.stokAdedi);
        if (Number.isFinite(stok)) girdiler.push({ stokKodu: kod, alan: 'stok', deger: stok });
        const cihaz = Number(it?.cihazUstuAdedi);
        if (Number.isFinite(cihaz) && cihaz > 0) {
          girdiler.push({ stokKodu: kod, alan: 'cihazUstu', deger: cihaz });
        }
      });
      ekle(
        partiler, labId, String(data?.locationName || adiniBul(labId)), yil, ay, girdiler,
        'maliyet-sayim', d.id, millis(data?.createdAt), String(data?.createdByName || ''),
      );
    });
  } catch (err) {
    ozet.hatalar.push(`Maliyet sayımları okunamadı: ${(err as Error)?.message}`);
  }

  /* 3) Total verimlilik — ay başı stok/cihaz üstü + kümülatif */
  try {
    const docs = await kapsamliCalistir(
      adminDb.collection('totalEfficiencyRecords'),
      companyId,
      isSuperAdmin,
    );
    ozet.taranan['Total Verimlilik'] = docs.length;
    for (const d of docs) {
      const data = d.data() as any;
      const yil = Number(data?.year);
      const ay = Number(data?.month) + 1; // panel getMonth() kullanır → 0-indeksli
      let rows: any[] = [];
      if (data?.rowsChunked === true) {
        const chunks = await d.ref.collection('rowChunks').orderBy('index', 'asc').get();
        rows = chunks.docs.flatMap(c => ((c.data() as any)?.rows || []) as any[]);
      } else {
        rows = (data?.rows || []) as any[];
      }
      // Satırlar lab kırılımı taşır; lab başına toplanır.
      const labBazli = new Map<string, OlcumGirdisi[]>();
      rows.forEach(r => {
        const labId = String(r?.labId || '').trim();
        const kod = String(r?.stokKodu || '').trim();
        if (!labId || !kod) return;
        const liste = labBazli.get(labId) || [];
        const stokKutu = Number(r?.baslangicStokuKutu);
        if (Number.isFinite(stokKutu)) liste.push({ stokKodu: kod, alan: 'stok', deger: stokKutu });
        const cihazTest = Number(r?.ayBasiCihazUstuTest);
        if (Number.isFinite(cihazTest) && cihazTest > 0) {
          liste.push({ stokKodu: kod, alan: 'cihazUstu', deger: cihazTest });
        }
        const kumulatif = Number(r?.kumulatifTotal);
        if (Number.isFinite(kumulatif) && kumulatif > 0) {
          liste.push({ stokKodu: kod, alan: 'kumulatif', deger: kumulatif });
        }
        labBazli.set(labId, liste);
      });
      labBazli.forEach((girdiler, labId) => {
        ekle(
          partiler, labId, adiniBul(labId), yil, ay, girdiler,
          'total-verimlilik', d.id, millis(data?.updatedAt) || millis(data?.createdAt),
          String(data?.createdByName || ''),
        );
      });
    }
  } catch (err) {
    ozet.hatalar.push(`Total verimlilik kayıtları okunamadı: ${(err as Error)?.message}`);
  }

  /* 4) Cihaz üstü hesaplama geçmişi */
  try {
    const docs = await kapsamliCalistir(
      adminDb.collection('cihazUstuGecmisi'),
      companyId,
      isSuperAdmin,
    );
    ozet.taranan['Cihaz Üstü Hesaplama'] = docs.length;
    docs.forEach(d => {
      const data = d.data() as any;
      const labId = String(data?.hospitalId || '').trim();
      const girdiler: OlcumGirdisi[] = ((data?.items || []) as any[])
        .map(it => ({
          stokKodu: String(it?.productId || '').trim(),
          alan: 'cihazUstu' as const,
          deger: Number(it?.value) || 0,
        }))
        .filter(g => g.stokKodu && g.deger > 0);
      ekle(
        partiler, labId, String(data?.hospitalName || adiniBul(labId)),
        Number(data?.year), Number(data?.month), girdiler,
        'cihaz-ustu-hesaplama', d.id, millis(data?.createdAt),
        String(data?.createdByName || ''),
      );
    });
  } catch (err) {
    ozet.hatalar.push(`Cihaz üstü geçmişi okunamadı: ${(err as Error)?.message}`);
  }

  /* 5) Kümülatif hesaplama geçmişi */
  try {
    const docs = await kapsamliCalistir(
      adminDb.collection('kumulatifHesaplamaGecmisi'),
      companyId,
      isSuperAdmin,
    );
    ozet.taranan['Kümülatif Hesaplama'] = docs.length;
    docs.forEach(d => {
      const data = d.data() as any;
      const labId = String(data?.hospitalId || '').trim();
      const girdiler: OlcumGirdisi[] = ((data?.items || []) as any[])
        .map(it => ({
          stokKodu: String(it?.productId || '').trim(),
          alan: 'kumulatif' as const,
          deger: Number(it?.total) || 0,
          kirilim: {
            routine: Number(it?.routine) || 0,
            rerun: Number(it?.rerun) || 0,
            calib: Number(it?.calib) || 0,
            control: Number(it?.control) || 0,
          },
        }))
        .filter(g => g.stokKodu && g.deger > 0);
      ekle(
        partiler, labId, String(data?.hospitalName || adiniBul(labId)),
        Number(data?.year), Number(data?.month), girdiler,
        'kumulatif-hesaplama', d.id, millis(data?.createdAt),
        String(data?.createdByName || ''),
      );
    });
  } catch (err) {
    ozet.hatalar.push(`Kümülatif geçmişi okunamadı: ${(err as Error)?.message}`);
  }

  /* Lab-dönem başına grupla ve kronolojik uygula */
  const gruplar = new Map<string, AktarimPartisi[]>();
  partiler.forEach(p => {
    const anahtar = `${p.labId}__${donemAnahtari(p.yil, p.ay)}`;
    gruplar.set(anahtar, [...(gruplar.get(anahtar) || []), p]);
  });

  for (const [, grup] of gruplar) {
    const ilk = grup[0];
    const ref = adminDb
      .collection(KOLEKSIYON)
      .doc(snapshotDocId(normalized, ilk.labId, donemAnahtari(ilk.yil, ilk.ay)));
    try {
      const snap = await ref.get();
      const mevcut = snap.exists
        ? (snap.data() as LabDonemSnapshot)
        : bosSnapshot(normalized, ilk.labId, ilk.labAdi, ilk.yil, ilk.ay);

      const sonuc = kronolojikBirlestir(
        mevcut,
        grup.map(p => ({ girdiler: p.girdiler, baglam: p.baglam })),
      );
      ozet.eklenen += sonuc.eklenen;
      ozet.guncellenen += sonuc.guncellenen;
      ozet.degismeyen += sonuc.degismeyen;
      if (sonuc.eklenen > 0 || sonuc.guncellenen > 0) {
        ozet.etkilenenSnapshot += 1;
        if (!onizleme) await ref.set(yazilabilir(sonuc.snapshot));
      }
    } catch (err) {
      ozet.hatalar.push(
        `${ilk.labId} / ${donemAnahtari(ilk.yil, ilk.ay)} aktarılamadı: ${(err as Error)?.message}`,
      );
    }
  }

  return ozet;
}
