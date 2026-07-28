'use client';

import type { Kaynak, OlcumGirdisi } from './types';

/**
 * Panellerin lab-dönem snapshot'ına yazarken kullandığı ortak yardımcı.
 *
 * İki tasarım kararı var:
 *
 *  1. **Asıl kaydı asla bozmaz.** Snapshot yazımı başarısız olsa bile panelin
 *     kendi kaydı (lab sayımı, maliyet oturumu, verimlilik tablosu) tamamlanmış
 *     sayılır. Bu yüzden hata fırlatmaz, konsola yazıp `null` döner — kullanıcı
 *     sayımını kaybetmez.
 *  2. **Ateşle ve unut değildir.** Sonuç döndürülür ki çağıran isterse
 *     "3 ölçüm güncellendi" gibi bir geri bildirim gösterebilsin.
 */
export async function labDonemineYaz(input: {
  labId: string;
  labAdi: string;
  yil: number;
  /** 1-12 */
  ay: number;
  girdiler: OlcumGirdisi[];
  kaynak: Kaynak;
  kaynakKayitId?: string;
  girenAdi?: string;
  companyId?: string | null;
}): Promise<{ eklenen: number; guncellenen: number; degismeyen: number } | null> {
  if (!input?.labId || !input.girdiler?.length) return null;
  try {
    const { upsertLabPeriodOlcumler } = await import('@/actions/labPeriodActions');
    return await upsertLabPeriodOlcumler({
      labId: input.labId,
      labAdi: input.labAdi,
      yil: input.yil,
      ay: input.ay,
      girdiler: input.girdiler,
      baglam: {
        kaynak: input.kaynak,
        kaynakKayitId: input.kaynakKayitId,
        girenAdi: input.girenAdi,
      },
      companyId: input.companyId,
    });
  } catch (err) {
    console.error('[lab-period] Snapshot yazılamadı:', err);
    return null;
  }
}
