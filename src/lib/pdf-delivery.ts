/**
 * @fileoverview Üretilen PDF'i kullanıcıya TESLİM etme yolu.
 *
 * NEDEN AYRI BİR DOSYA: `jsPDF.save()` arka planda gizli bir `<a download>`
 * bağlantısına tıklar. Bu tarayıcıda ve Electron'da çalışır; Android
 * WebView'ında ise **sessizce hiçbir şey yapmaz** — indirme yöneticisi
 * devreye girmez, hata da çıkmaz. Depo görevlisi tutanak düğmesine basar,
 * ekranda hiçbir şey olmaz ve sorunun nerede olduğunu kimse anlamaz.
 *
 * Bu yüzden teslim yolu tek bir yerde toplandı:
 *
 *   - Web / masaüstü → `doc.save()` (davranış birebir aynı kalır)
 *   - Android        → dosyayı önbelleğe yaz, sistem paylaşım sayfasını aç
 *
 * Paylaşım sayfası Android'de doğru seçimdir: tutanak zaten çoğu zaman
 * yazıcıya, WhatsApp'a ya da Drive'a gidiyor. "İndirilenler"e sessizce
 * kaydetmek, kullanıcıyı dosya yöneticisinde dosya aramaya zorlardı.
 */

'use client';

import { isNativeApp } from '@/lib/native-shell';

/**
 * `jsPDF`in burada kullanılan yüzeyi.
 *
 * Somut tip yerine yapısal tip: bu modül jsPDF'i import etmez, dolayısıyla
 * onu kullanmayan paketlere 340 kB'lık kütüphaneyi sokmaz.
 */
type PdfLike = {
  save: (filename: string) => void;
  output: (type: 'datauristring') => string;
};

/** Dosya adını her platformda güvenli hâle getirir. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return cleaned || 'belge.pdf';
}

/**
 * PDF'i kullanıcıya ulaştırır.
 *
 * Android'de bir şeyler ters giderse `doc.save()`e düşülür: en kötü ihtimalle
 * bugünkü (sessiz) davranışa dönülür, akış kesilmez.
 */
export async function deliverPdf(doc: PdfLike, filename: string): Promise<void> {
  const name = safeFileName(filename);

  if (!isNativeApp()) {
    doc.save(name);
    return;
  }

  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    // `datauristring` → "data:application/pdf;filename=…;base64,XXXX".
    // Filesystem yalnızca base64 gövdesini bekler.
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);

    // Önbellek dizini bilerek seçildi: tutanak kalıcı bir belge değil, anlık
    // bir çıktıdır. Kullanıcı paylaşım sayfasından nereye kaydedeceğine
    // kendisi karar verir; cihazda çöp birikmez.
    const written = await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Cache,
    });

    await Share.share({
      title: name,
      // `files` kullanılıyor: Android paylaşım hedeflerinin çoğu düz bir
      // `url` alanını metin sanıp dosyayı görmezden gelir.
      files: [written.uri],
    });
  } catch (error) {
    // Paylaşım penceresini kullanıcı kapattığında da buraya düşülür; bunu
    // hata gibi göstermek yanlış olurdu, sessizce geçiyoruz.
    console.warn('[pdf-delivery] Yerel paylaşım başarısız, tarayıcı yoluna düşülüyor.', error);
    try {
      doc.save(name);
    } catch {
      /* son çare de başarısızsa çağıran taraf zaten hata gösterir */
    }
  }
}
