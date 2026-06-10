/**
 * PDF yazdırma yardımcısı — ek sekme açmadan yazdırır.
 *
 * Chromium tabanlı tarayıcılarda PDF, gizli bir iframe'e yüklenir; PDF'in
 * içine gömülü autoPrint (OpenAction) sayesinde yazdırma diyaloğu mevcut
 * sayfanın üzerinde anında açılır — ayrı bir sekmeye geçilmez.
 *
 * Depo istasyonunda Chrome `--kiosk-printing` parametresiyle çalıştırılırsa
 * diyalog hiç gösterilmez ve çıktı varsayılan yazıcıdan OTOMATİK alınır
 * (işlem anında yazıcı çalışır). Diğer tarayıcılarda eski davranışa
 * (yeni sekmede aç) geri düşülür.
 */

const isChromium = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/Firefox|FxiOS/.test(ua);
};

/** autoPrint gömülü PDF blob URL'ini ek sekme açmadan yazdırmaya gönderir. */
export function openPdfForPrint(blobUrl: string) {
  if (!isChromium() || typeof document === 'undefined') {
    window.open(blobUrl, '_blank');
    return;
  }
  try {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    frame.src = blobUrl;
    document.body.appendChild(frame);
    // Yazdırma kuyruğuna alınması için iframe bir süre DOM'da kalır.
    setTimeout(() => {
      try {
        document.body.removeChild(frame);
        URL.revokeObjectURL(blobUrl);
      } catch { /* zaten kaldırılmış */ }
    }, 120_000);
  } catch {
    window.open(blobUrl, '_blank');
  }
}
