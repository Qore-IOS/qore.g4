'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { normalizeUnitLabel } from '@/lib/product-unit';

type SparePartTransferLog = {
  id: string;
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  serialNumber?: string;
  quantity?: number;
  anaBirim?: string;
  timestamp?: Date;
  createdAt?: Date;
  fromName?: string;
  toName?: string;
  createdByName?: string;
};

type Props = {
  log: SparePartTransferLog;
  className?: string;
};

const FONT_FAMILY = 'helvetica';

function sanitizeForPdfFont(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}

export default function SparePartTransferTutanakPDFButton({ log, className }: Props) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const padX = 40;

      const now = log.timestamp || log.createdAt || new Date();
      const teslimEden = log.fromName || log.createdByName || '-';
      const teslimAlan = log.toName || '-';

      const ORANGE = { r: 199, g: 137, b: 65 };
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.setLineWidth(2);
      doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
      const deepLinkIdOnly = `${origin}/direkt-transfer/yedek-parca-transfer`;
      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(deepLinkIdOnly, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });
      } catch (e) {
        console.error('QR Code generation failed:', e);
      }

      if (qrDataUrl) {
        const frameSize = 80;
        const framePadding = 4;
        const frameX = pageW - padX - frameSize;
        const frameY = padX;
        const frameCornerRadius = 8;
        const qrSize = frameSize - framePadding * 2;
        const qrX = frameX + framePadding;
        const qrY = frameY + framePadding;

        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.setLineWidth(1.5);
        (doc as any).roundedRect(frameX, frameY, frameSize, frameSize, frameCornerRadius, frameCornerRadius, 'S');
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
      }

      doc.setTextColor(0, 0, 0);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.setFontSize(16);
      doc.text(sanitizeForPdfFont('Transfer Formu'), pageW / 2, 60, { align: 'center' });

      doc.setFontSize(36);
      doc.text('INVITROLAB', pageW / 2, 110, { align: 'center' });

      doc.setFont(FONT_FAMILY, 'normal');
      doc.setFontSize(10);
      const col1X = padX;
      const col2X = pageW / 2 + 20;
      let currentY = 160;

      doc.text(sanitizeForPdfFont('Gönderen Depo :'), col1X, currentY);
      doc.text(sanitizeForPdfFont('Tarih / Saat :'), col2X, currentY);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont('Yedek Parça Deposu'), col1X, currentY + 15);
      doc.text(format(now, 'dd.MM.yyyy HH:mm', { locale: tr }), col2X, currentY + 15);

      currentY += 35;
      doc.setDrawColor(200, 200, 200);
      doc.line(padX, currentY, pageW - padX, currentY);
      currentY += 25;

      doc.setFont(FONT_FAMILY, 'normal');
      doc.text(sanitizeForPdfFont('Teslim Alan Personel :'), col1X, currentY);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont(teslimAlan), col1X, currentY + 15);

      currentY += 35;
      doc.setFont(FONT_FAMILY, 'normal');
      doc.text(sanitizeForPdfFont('Teslim Eden :'), col1X, currentY);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont(teslimEden), col1X, currentY + 15);
      currentY += 35;

      autoTable(doc, {
        head: [['Stok Kodu', 'Urun', 'Seri No', 'Adet', 'Birim', 'Islem Tarihi']],
        body: [[
          sanitizeForPdfFont(log.stokKodu || '-'),
          sanitizeForPdfFont(log.stokAdi || '-'),
          sanitizeForPdfFont(log.serialNumber || '-') || '-',
          String(log.quantity || 1),
          sanitizeForPdfFont(normalizeUnitLabel(log.anaBirim)),
          format(now, 'dd.MM.yyyy HH:mm', { locale: tr }),
        ]],
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: 8 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { left: padX, right: padX },
      });

      const finalY = (doc as any).lastAutoTable.finalY;
      const signatureY = finalY + 80;
      if (signatureY < pageH - 120) {
        doc.setFont(FONT_FAMILY, 'normal');
        doc.setFontSize(11);
        doc.text(sanitizeForPdfFont('Teslim Eden'), padX, signatureY);
        doc.line(padX, signatureY + 5, padX + 150, signatureY + 5);
        doc.text(sanitizeForPdfFont('Teslim Alan'), pageW / 2 + 20, signatureY);
        doc.line(pageW / 2 + 20, signatureY + 5, pageW / 2 + 170, signatureY + 5);
      }

      doc.save(`YedekParcaTransfer_${log.id}_Form.pdf`);
    } catch (e) {
      console.error('Spare part transfer PDF export error:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={onExport} disabled={busy} variant="outline" size="sm" className={className ? `${className} gap-2` : 'gap-2'}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      Tutanak
    </Button>
  );
}
