'use server';

import { adminDb } from '@/lib/firebase-admin';
import { normalizeCompanyId } from '@/lib/company-scope';
import {
  DEFAULT_MIN_MAX_PERIOD_CONFIG,
  getActiveMinMaxPeriod,
  seasonalMinMaxPatch,
} from '@/lib/seasonal-min-max';
import type { MinMaxPeriodConfig, MinMaxRule } from '@/lib/types';

export interface DonemUygulamaSonucu {
  /** Yürürlükteki dönemin adı */
  aktifDonemAdi: string;
  /** Düz min/max alanları yenilenen kural sayısı */
  guncellenen: number;
  /** Taranan kural sayısı */
  taranan: number;
  hatalar: string[];
}

/**
 * Dönemsel min/max tanımlarını yürürlüğe alır.
 *
 * ## Neden gerekli
 *
 * Dönemsel değerler kuralın `donemDegerleri` haritasında durur, ama min/max
 * okuyan 46 ayrı yer dokümanın düz `min`/`max` alanlarına bakar. Düz alanlar
 * yalnızca panelde kaydederken yazılıyordu; ay değişip yeni döneme
 * girildiğinde eskimiş kalıyor, yani mevsimsel tanım sessizce yürürlükten
 * kalkıyordu. Bu aksiyon eskimiş kuralları bulup düz alanları aktif dönemin
 * değerleriyle yeniden yazar.
 *
 * Okuyucuları tek tek değiştirmek yerine bu yol seçildi: 46 çağrı yerine
 * dokunmak hem riskli hem de her birinin dönem yapılandırmasını okumasını
 * gerektirirdi.
 *
 * ## Davranış
 *
 * Idempotenttir — yalnızca gerçekten eskimiş dokümanlar yazılır, dolayısıyla
 * sık çağrılması ucuzdur (dönem geçişinde bir kez yazar, sonra hiç yazmaz).
 * Dönemsel tanımı olmayan kurallara dokunulmaz.
 */
export async function applySeasonalMinMax(
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DonemUygulamaSonucu> {
  const normalized = normalizeCompanyId(companyId);
  const sonuc: DonemUygulamaSonucu = {
    aktifDonemAdi: '',
    guncellenen: 0,
    taranan: 0,
    hatalar: [],
  };

  let config: MinMaxPeriodConfig = DEFAULT_MIN_MAX_PERIOD_CONFIG;
  try {
    const snap = await adminDb.collection('minMaxPeriodConfigs').doc(normalized).get();
    if (snap.exists) {
      const data = snap.data() as Partial<MinMaxPeriodConfig>;
      config = {
        periods: data.periods?.length ? data.periods : DEFAULT_MIN_MAX_PERIOD_CONFIG.periods,
        monthPeriodMap: data.monthPeriodMap ?? DEFAULT_MIN_MAX_PERIOD_CONFIG.monthPeriodMap,
      };
    }
  } catch (err) {
    sonuc.hatalar.push(`Dönem yapılandırması okunamadı: ${(err as Error)?.message}`);
    return sonuc;
  }
  sonuc.aktifDonemAdi = getActiveMinMaxPeriod(config).name;

  /** Şirkete ait kurumları toplar; legacy (companyId'siz) kayıtlar da dahildir. */
  const kurumlar = async (koleksiyon: 'hospitals' | 'depots'): Promise<string[]> => {
    if (isSuperAdmin) {
      return (await adminDb.collection(koleksiyon).get()).docs.map(d => d.id);
    }
    const [cs, ls] = await Promise.all([
      adminDb.collection(koleksiyon).where('companyId', '==', normalized).get(),
      adminDb.collection(koleksiyon).where('companyId', '==', '__legacy__').get(),
    ]);
    return Array.from(new Set([...cs.docs, ...ls.docs].map(d => d.id)));
  };

  try {
    const [hastaneler, depolar] = await Promise.all([kurumlar('hospitals'), kurumlar('depots')]);
    const hedefler: Array<{ koleksiyon: 'hospitals' | 'depots'; id: string }> = [
      ...hastaneler.map(id => ({ koleksiyon: 'hospitals' as const, id })),
      ...depolar.map(id => ({ koleksiyon: 'depots' as const, id })),
    ];

    // Firestore toplu yazma sınırı 500; güvenli tarafta kalmak için 400.
    let batch = adminDb.batch();
    let bekleyen = 0;
    const gonder = async () => {
      if (bekleyen === 0) return;
      await batch.commit();
      batch = adminDb.batch();
      bekleyen = 0;
    };

    for (const hedef of hedefler) {
      const kurallar = await adminDb
        .collection(hedef.koleksiyon)
        .doc(hedef.id)
        .collection('minMaxRules')
        .get();

      for (const d of kurallar.docs) {
        sonuc.taranan += 1;
        const rule = d.data() as MinMaxRule;
        const yama = seasonalMinMaxPatch(rule, config);
        if (!yama) continue;
        batch.set(
          d.ref,
          { min: yama.min, max: yama.max, aktifDonemId: yama.aktifDonemId },
          { merge: true },
        );
        sonuc.guncellenen += 1;
        if (++bekleyen >= 400) await gonder();
      }
    }
    await gonder();
  } catch (err) {
    sonuc.hatalar.push(`Kurallar güncellenemedi: ${(err as Error)?.message}`);
  }

  return sonuc;
}
