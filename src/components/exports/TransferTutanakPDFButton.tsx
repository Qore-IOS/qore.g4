
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { tr } from 'date-fns/locale';
import { format } from 'date-fns';

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
  seriNo?: string | string[];
};

export type TransferTutanakPDFButtonProps = {
  header: HeaderInfo;
  rows: Row[];
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


export default function TransferTutanakPDFButton({ header, rows, className }: TransferTutanakPDFButtonProps) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const padX = 40;

      doc.setFont(FONT_FAMILY);

      const ORANGE = { r: 199, g: 137, b: 65 };
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.setLineWidth(2);
      doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);
      
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
      const deepLinkIdOnly = `${origin}/transfer-gecmis/${encodeURIComponent(header.shipmentId)}`;

      let qrDataUrl: string;
      try {
        qrDataUrl = await QRCode.toDataURL(deepLinkIdOnly, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });
      } catch (e) {
          console.error("QR Code generation failed:", e);
          qrDataUrl = '';
      }

      if (qrDataUrl) {
          const frameSize = 80;
          const framePadding = 4;
          const frameX = pageW - padX - frameSize;
          const frameY = padX;
          const frameCornerRadius = 8;
          
          const qrSize = frameSize - (framePadding * 2);
          const qrX = frameX + framePadding;
          const qrY = frameY + framePadding;
          
          doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
          doc.setLineWidth(1.5);
          (doc as any).roundedRect(frameX, frameY, frameSize, frameSize, frameCornerRadius, frameCornerRadius, 'S');

          doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
      }

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont('Transfer Formu'), pageW / 2, 60, { align: 'center' });

      doc.setFontSize(36);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text('INVITROLAB', pageW / 2, 110, { align: 'center' });

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
        head: [['Stok Kodu', 'Urun', 'Lot', 'Miad', 'Adet']],
        body: rows.map(r => [
          sanitizeForPdfFont(r.stokKodu),
          sanitizeForPdfFont(r.urun),
          sanitizeForPdfFont(r.lot) || '-',
          sanitizeForPdfFont(r.miad) || '-',
          String(r.adet),
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
      if (signatureY < pageH - 120) { // Make sure there's enough space for logo
        doc.setFont(FONT_FAMILY, 'normal');
        doc.setFontSize(11);
        doc.text(sanitizeForPdfFont('Teslim Eden'), padX, signatureY);
        doc.line(padX, signatureY + 5, padX + 150, signatureY + 5);
        doc.text(sanitizeForPdfFont('Teslim Alan'), pageW / 2 + 20, signatureY);
        doc.line(pageW / 2 + 20, signatureY + 5, pageW / 2 + 20 + 150, signatureY + 5);
      }

      // --- ADD FOOTER LOGO ---
      try {
        const imgResponseFooter = await fetch('/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG');
        const imgBlobFooter = await imgResponseFooter.blob();
        const readerFooter = new FileReader();
        readerFooter.readAsDataURL(imgBlobFooter);
        await new Promise<void>(resolve => {
          readerFooter.onloadend = () => {
            const base64data = readerFooter.result as string;
            const imgWidth = 50;
            const imgHeight = 50;
            const imgX = (pageW / 2) - (imgWidth / 2);
            // Position above the bottom frame line.
            const imgY = pageH - (padX / 2) - imgHeight - 10;
            doc.addImage(base64data, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');
            resolve();
          };
        });
      } catch (e) {
        console.error("Could not load or add footer logo to PDF:", e);
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
