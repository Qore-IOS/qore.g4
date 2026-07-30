'use client';

/**
 * Dönemsel min/max'ın yürürlüğe alınmasını oturumda bir kez tetikler.
 *
 * `applySeasonalMinMax` tüm kurumların kurallarını tarar; idempotent olsa da
 * her panel açılışında çalıştırmak gereksiz okuma yapar. Dönem ayda bir
 * değiştiği için oturumda tek çağrı yeterlidir: uygulama açıkken ay değişse
 * bile bir sonraki açılışta yakalanır.
 *
 * Hata yutulur — dönem uygulaması başarısız olsa bile panel kendi işine devam
 * etmeli, kullanıcı sipariş ekranını kaybetmemeli.
 */
let calisti = false;
let sonAnahtar = '';

export async function donemiYururlugeAl(
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<void> {
  // Şirket değişirse (süper admin geçişi) yeniden çalışsın.
  const anahtar = `${companyId ?? ''}|${isSuperAdmin ? '1' : '0'}`;
  if (calisti && anahtar === sonAnahtar) return;
  calisti = true;
  sonAnahtar = anahtar;
  try {
    const { applySeasonalMinMax } = await import('@/actions/minMaxActions');
    const sonuc = await applySeasonalMinMax(companyId, isSuperAdmin);
    if (sonuc.guncellenen > 0) {
      console.info(
        `[min-max] ${sonuc.aktifDonemAdi} dönemi uygulandı: ${sonuc.guncellenen} kural güncellendi.`,
      );
    }
  } catch (err) {
    console.error('[min-max] Dönem uygulanamadı:', err);
  }
}
