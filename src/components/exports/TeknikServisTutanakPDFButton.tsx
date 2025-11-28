
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';

type ActionItem = {
  id: string;
  action: 'lamba_degisimi' | 'kuvet_degisimi' | 'elektrot_degisimi' | '';
  quantity: number;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const ACTION_LABELS: Record<ActionItem['action'], string> = {
  '': 'Bilinmeyen Islem',
  lamba_degisimi: 'Lamba Degisimi',
  kuvet_degisimi: 'Kuvet Degisimi',
  elektrot_degisimi: 'Elektrot Degisimi',
};

export type TeknikServisTutanakPDFButtonProps = {
  device: Device;
  hospital: Hospital | null;
  actionRecord: ActionFormRecord;
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


export default function TeknikServisTutanakPDFButton({ device, hospital, actionRecord, className }: TeknikServisTutanakPDFButtonProps) {
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
      
      const recordUrl = `${window.location.origin}/teknik-servis/islem-formu/${device.id}?focus=${actionRecord.id}`;
      const qrDataUrl = await QRCode.toDataURL(recordUrl, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });

      const qrSize = 80;
      doc.addImage(qrDataUrl, 'PNG', pageW - padX - qrSize, padX, qrSize, qrSize, undefined, 'FAST');

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont('Teknik Servis Islem Formu'), padX, 60, { align: 'left' });

      doc.setFontSize(10);
      doc.setFont(FONT_FAMILY, 'normal');
      let currentY = 100;
      
      const info = [
          ['Form No:', actionRecord.id],
          ['Laboratuvar:', sanitizeForPdfFont(hospital?.name)],
          ['Cihaz:', sanitizeForPdfFont(`${device.cihazAdi} (SN: ${device.seriNumarasi})`)],
          ['Islemi Yapan:', sanitizeForPdfFont(actionRecord.createdByName)],
          ['Tarih / Saat:', format(actionRecord.createdAt.toDate(), 'dd.MM.yyyy HH:mm')]
      ];
      
      autoTable(doc, {
        body: info,
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } }
      });

      currentY = (doc as any).lastAutoTable.finalY + 20;

      autoTable(doc, {
        head: [['Yapilan Islem', 'Adet']],
        body: actionRecord.actions.map(act => [
            sanitizeForPdfFont(ACTION_LABELS[act.action] || act.action),
            String(act.quantity)
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT_FAMILY, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      const finalY = (doc as any).lastAutoTable.finalY;

      // --- ADD SIGNATURES ---
      const signatureY = finalY + 60; 
      if (signatureY < pageH - 120) {
          doc.setFont(FONT_FAMILY, 'normal');
          doc.setFontSize(10);
          
          doc.text(sanitizeForPdfFont('Islemi Yapan Personel'), padX, signatureY);
          doc.line(padX, signatureY + 5, padX + 150, signatureY + 5);
          if (actionRecord.personnelSignature) {
            doc.addImage(actionRecord.personnelSignature, 'PNG', padX, signatureY + 10, 150, 40, undefined, 'FAST');
          }

          doc.text(sanitizeForPdfFont('Teknisyen'), pageW / 2 + 20, signatureY);
          doc.line(pageW / 2 + 20, signatureY + 5, pageW / 2 + 170, signatureY + 5);
          if (actionRecord.technicianSignature) {
            doc.addImage(actionRecord.technicianSignature, 'PNG', pageW / 2 + 20, signatureY + 10, 150, 40, undefined, 'FAST');
          }
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
            const imgY = pageH - (padX / 2) - imgHeight - 10;
            doc.addImage(base64data, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');
            resolve();
          };
        });
      } catch (e) {
        console.error("Could not load or add footer logo to PDF:", e);
      }
      
      doc.save(`IslemFormu_${device.seriNumarasi}_${actionRecord.id.substring(0,6)}.pdf`);
    } catch (e) {
      console.error('PDF export error:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={onExport} disabled={busy} variant="ghost" size="sm" className={className}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}
