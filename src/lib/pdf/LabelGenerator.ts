
'use client';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';

export type Asset = {
  id: string;
  demirbasNo: string;
  urunAdi?: string;
  konum: string;
  category?: string;
};

type LabelGeneratorOptions = {
  assets: Asset[];
  buildAssetUrl: (asset: Asset) => string;
  logoPath?: string;
};

async function ensureTurkishFonts(doc: jsPDF) {
  try {
    const [reg, bold] = await Promise.all([
      fetch('/fonts/Inter-Regular.ttf'),
      fetch('/fonts/Inter-Bold.ttf'),
    ]);
    if (!reg.ok || !bold.ok) return;

    const [regBuf, boldBuf] = await Promise.all([reg.arrayBuffer(), bold.arrayBuffer()]);
    const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

    doc.addFileToVFS('Inter-Regular.ttf', toB64(regBuf));
    doc.addFileToVFS('Inter-Bold.ttf', toB64(boldBuf));
    doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  } catch {
    /* fallback to Helvetica */
  }
}

export async function generateLabelsPdf({
  assets,
  buildAssetUrl,
  logoPath = '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
}: LabelGeneratorOptions) {
    const doc = new jsPDF({ unit: 'mm', format: [40, 30], orientation: 'landscape' });
    await ensureTurkishFonts(doc);

    for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (i > 0) {
            doc.addPage([40, 30], 'landscape');
        }

        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, 40, 30, 'F');
        
        doc.setTextColor(0, 0, 0);
        doc.setFont('Inter', 'bold');
        
        // --- Dynamic Font Sizing ---
        const labelText = asset.demirbasNo;
        let fontSize = 24; // Start with a large font size
        const maxWidth = 36; // 40mm width - 2mm padding on each side

        doc.setFontSize(fontSize);
        let textWidth = doc.getTextWidth(labelText);

        // Reduce font size until it fits
        while (textWidth > maxWidth && fontSize > 6) {
            fontSize -= 1;
            doc.setFontSize(fontSize);
            textWidth = doc.getTextWidth(labelText);
        }

        // Center the text vertically and horizontally
        const textHeight = (fontSize / doc.internal.scaleFactor) * 0.35; // Approximate height in mm
        const textX = 20; // Horizontal center of 40mm page
        const textY = 15 + (textHeight / 2) - 2; // Vertical center of 30mm page, adjusted for baseline

        doc.text(labelText, textX, textY, { align: 'center' });
    }

    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
}
