
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';
import {
  drawTutanakFrame, drawTutanakQrBlock, drawTutanakTitle, sanitizeForPdfFont, TUTANAK_PAD_X,
} from '@/lib/pdf/tutanak-chrome';

type HeaderInfo = {
  shipmentId: string;
  depotName: string;
  kurumAdi: string;
  tarih: string; // dd.MM.yyyy
  saat: string;  // HH:mm
  olusturan?: string;
  karsilayan?: string;
  company?: string;
};

type Row = {
  stokKodu: string;
  urun: string;
  lot?: string;
  miad?: string;
  adet: number;
  anaBirim?: string;
  ambalajDegeri?: number | null;
  seriNo?: string | string[];
};

export type TransferTutanakPDFButtonProps = {
  header: HeaderInfo;
  rows: Row[];
  className?: string;
};

const FONT_FAMILY = 'helvetica';

export default function TransferTutanakPDFButton({ header, rows, className }: TransferTutanakPDFButtonProps) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const padX = TUTANAK_PAD_X;

      doc.setFont(FONT_FAMILY);

      drawTutanakFrame(doc);

      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
      const deepLinkIdOnly = `${origin}/transfer-gecmis/${encodeURIComponent(header.shipmentId)}`;
      await drawTutanakQrBlock(doc, deepLinkIdOnly);

      await drawTutanakTitle(doc);

      doc.setFont(FONT_FAMILY, 'normal');
      doc.setFontSize(10);
      const col1X = padX;
      const col2X = pageW / 2 + 20;
      const col1MaxWidth = col2X - col1X - 20;
      let currentY = 160;

      doc.text(sanitizeForPdfFont('Gönderen Depo :'), col1X, currentY);
      doc.text(sanitizeForPdfFont('Tarih / Saat :'), col2X, currentY);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont(header.depotName), col1X, currentY + 15, { maxWidth: col1MaxWidth });
      doc.text(`${header.tarih} ${header.saat}`, col2X, currentY + 15);

      currentY += 35;
      doc.setDrawColor(200, 200, 200);
      doc.line(padX, currentY, pageW - padX, currentY);
      currentY += 25;

      doc.setFont(FONT_FAMILY, 'normal');
      doc.text(sanitizeForPdfFont('Teslim Alan Kurum :'), col1X, currentY);
      if (header.company) {
        doc.text(sanitizeForPdfFont('Firma:'), col2X, currentY);
      }
      doc.setFont(FONT_FAMILY, 'bold');
      const sanitizedKurumAdi = sanitizeForPdfFont(header.kurumAdi);
      const recipientLines = doc.splitTextToSize(sanitizedKurumAdi, col1MaxWidth);
      doc.text(recipientLines, col1X, currentY + 15);
      if (header.company) {
        doc.text(sanitizeForPdfFont(header.company), col2X, currentY + 15);
      }

      const recipientBlockHeight = recipientLines.length * 12;
      currentY += recipientBlockHeight + 20;

      doc.setFont(FONT_FAMILY, 'normal');
      doc.text(sanitizeForPdfFont('Teslim Eden :'), col1X, currentY);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont(header.karsilayan), col1X, currentY + 15);
      currentY += 35;


      autoTable(doc, {
        head: [['Stok Kodu', 'Urun', 'Lot', 'Miad', 'Adet', 'Birim']],
        body: rows.map(r => [
          sanitizeForPdfFont(r.stokKodu),
          sanitizeForPdfFont(r.urun),
          sanitizeForPdfFont(r.lot) || '-',
          sanitizeForPdfFont(r.miad) || '-',
          String(r.adet),
          sanitizeForPdfFont(`${normalizeUnitLabel(r.anaBirim)}${formatUnitMultiplier(r) ? ` (${formatUnitMultiplier(r)})` : ''}`),
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: 8 },
        headStyles: {
          fillColor: [224, 224, 224],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { left: padX, right: padX },
        tableWidth: 'auto',
      });

      const finalY = (doc as any).lastAutoTable.finalY;

      const signatureY = finalY + 80;
      if (signatureY < pageH - 80) {
        doc.setFont(FONT_FAMILY, 'normal');
        doc.setFontSize(11);
        doc.text(sanitizeForPdfFont('Teslim Eden'), padX, signatureY);
        doc.line(padX, signatureY + 5, padX + 150, signatureY + 5);
        doc.text(sanitizeForPdfFont('Teslim Alan'), pageW / 2 + 20, signatureY);
        doc.line(pageW / 2 + 20, signatureY + 5, pageW / 2 + 20 + 150, signatureY + 5);
      }

      doc.save(`Transfer_${header.shipmentId}_Form.pdf`);
    } catch (e) {
      console.error('PDF export error:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={onExport} disabled={busy} className={className ? `${className} gap-2` : 'gap-2'}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      Tutanak (PDF)
    </Button>
  );
}
