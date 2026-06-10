/**
 * Transfer tutanağı (A4) — ortak şablon parçaları.
 *
 * Direkt transfer tutanağı ile sarf dağıtım tutanağı aynı şablonu kullanır:
 * turuncu çerçeve, ortada "Transfer Formu" + İnvitrolab logosu, sağ üstte
 * çerçeveli QR ve hemen altında QR alanı genişliğini aşmayan "logo + QORE" satırı.
 */
import type { jsPDF } from 'jspdf';

export const TUTANAK_ORANGE = { r: 199, g: 137, b: 65 };
export const TUTANAK_PAD_X = 40;
const FONT = 'helvetica';

/** QR çerçevesi ölçüleri — tek yerden yönetilir. */
export const TUTANAK_QR = {
  frameSize: 100,
  framePadding: 8,
  cornerRadius: 10,
  lineWidth: 1.5,
};

export function sanitizeForPdfFont(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}

/** PNG'yi dataURL + doğal boyutlarıyla yükler (oran bozulmadan basmak için). */
export async function loadPngWithSize(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = reject;
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    return null;
  }
}

/** Sayfa kenarındaki turuncu çerçeve. */
export function drawTutanakFrame(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(TUTANAK_ORANGE.r, TUTANAK_ORANGE.g, TUTANAK_ORANGE.b);
  doc.setLineWidth(2);
  doc.rect(TUTANAK_PAD_X / 2, TUTANAK_PAD_X / 2, pageW - TUTANAK_PAD_X, pageH - TUTANAK_PAD_X);
}

/**
 * Sağ üst köşe: çerçeveli QR + hemen altında "logo + QORE" satırı.
 * QORE satırı QR alanı genişliğine ortalanır ve dışına taşmaz.
 */
export async function drawTutanakQrBlock(doc: jsPDF, qrPayload: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const { frameSize, framePadding, cornerRadius, lineWidth } = TUTANAK_QR;
  const frameX = pageW - TUTANAK_PAD_X - frameSize;
  const frameY = TUTANAK_PAD_X;

  let qrDataUrl = '';
  try {
    const { default: QRCode } = await import('qrcode');
    qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 0, scale: 6 });
  } catch (e) {
    console.error('QR Code generation failed:', e);
  }

  if (qrDataUrl) {
    const qrSize = frameSize - framePadding * 2;
    doc.setDrawColor(TUTANAK_ORANGE.r, TUTANAK_ORANGE.g, TUTANAK_ORANGE.b);
    doc.setLineWidth(lineWidth);
    doc.roundedRect(frameX, frameY, frameSize, frameSize, cornerRadius, cornerRadius, 'S');
    doc.addImage(qrDataUrl, 'PNG', frameX + framePadding, frameY + framePadding, qrSize, qrSize, undefined, 'FAST');
  }

  // "logo + QORE" — QR çerçevesinin hemen altında, çerçeve genişliğinde
  const rowY = frameY + frameSize + 8;
  const iconSize = 15;
  const gap = 5;
  const label = 'QORE';
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  const textW = doc.getTextWidth(label);
  const logo = await loadPngWithSize('/newlogoblk.png');
  const totalW = Math.min((logo ? iconSize + gap : 0) + textW, frameSize);
  const startX = frameX + (frameSize - totalW) / 2;
  const textBaselineY = rowY + iconSize / 2 + 4.5;
  if (logo) {
    const logoW = iconSize * (logo.w / logo.h);
    doc.addImage(logo.data, 'PNG', startX, rowY, logoW, iconSize, undefined, 'FAST');
    doc.text(label, startX + logoW + gap, textBaselineY);
  } else {
    doc.text(label, frameX + (frameSize - textW) / 2, textBaselineY);
  }

  return { frameX, frameY, frameSize, blockBottomY: rowY + iconSize };
}

/** Başlık: "Transfer Formu" + doğal oranı korunmuş İnvitrolab logosu. */
export async function drawTutanakTitle(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.setFont(FONT, 'bold');
  doc.text(sanitizeForPdfFont('Transfer Formu'), pageW / 2, 60, { align: 'center' });

  const logo = await loadPngWithSize('/invlogo.png');
  if (logo) {
    // Oryantasyon düzeltmesi: genişlik dosyanın gerçek en-boy oranından hesaplanır.
    const logoH = 46;
    const logoW = logoH * (logo.w / logo.h);
    doc.addImage(logo.data, 'PNG', (pageW - logoW) / 2, 78, logoW, logoH, undefined, 'FAST');
  } else {
    doc.setFontSize(36);
    doc.setFont(FONT, 'bold');
    doc.text('INVITROLAB', pageW / 2, 110, { align: 'center' });
  }
}
