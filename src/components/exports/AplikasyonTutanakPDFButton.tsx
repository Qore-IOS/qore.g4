
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';

// Operation types
type OperationType =
  | 'aplikasyon_kontrol'
  | 'kalibrasyon_kontrol'
  | 'qc_materyal_kontrol'
  | 'ornek_sonucu_karsilastirma'
  | 'reaktif_yenileme'
  | 'kalibrator_yenileme'
  | 'qc_yenileme'
  | 'cv_calismasi'
  | 'diger';

// Cihaz Durumu
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const OPERATION_LABELS: Record<OperationType, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Ornek Sonucu Karsilastirma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibrator Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Calismasi',
  diger: 'Diger',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': '-',
  calisiyor: 'Calisiyor',
  arizali: 'Arizali',
  denemede: 'Denemede',
  diger: 'Diger',
};

export type AplikasyonTutanakPDFButtonProps = {
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

// Helper to get proper operation label
function getOperationLabel(action: string): string {
  if (OPERATION_LABELS[action as OperationType]) {
    return OPERATION_LABELS[action as OperationType];
  }
  return action;
}


export default function AplikasyonTutanakPDFButton({ device, hospital, actionRecord, className }: AplikasyonTutanakPDFButtonProps) {
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

      // --- HEADER SECTION: Title (left), Logo (center), QR Code (right) ---
      const headerY = 30;

      // Title on left
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text(sanitizeForPdfFont('Aplikasyon Formu'), padX, headerY + 20);

      // Logo in center - try to load invitrolab logo
      try {
        const logoResponse = await fetch('/invitrolab_LOGO__-Kopya__1-removebg.png');
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.blob();
          const logoReader = new FileReader();
          logoReader.readAsDataURL(logoBlob);
          await new Promise<void>(resolve => {
            logoReader.onloadend = () => {
              const logoData = logoReader.result as string;
              const logoWidth = 100;
              const logoHeight = 40;
              const logoX = (pageW / 2) - (logoWidth / 2);
              doc.addImage(logoData, 'PNG', logoX, headerY, logoWidth, logoHeight, undefined, 'FAST');
              resolve();
            };
          });
        }
      } catch (e) {
        console.error("Could not load header logo:", e);
      }

      // QR Code on right with orange rounded border
      const recordUrl = `${window.location.origin}/aplikasyon-paneli/islem-formu/${device.id}?focus=${actionRecord.id}`;
      const qrDataUrl = await QRCode.toDataURL(recordUrl, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });

      const qrSize = 60;
      const qrX = pageW - padX - qrSize - 10;
      const qrY = headerY;

      // Draw orange rounded rectangle for QR
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.setFillColor(255, 255, 255);
      doc.setLineWidth(2);
      doc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 5, 5, 'FD');
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');

      // System logo below QR
      try {
        const sysLogoResponse = await fetch('/newlogoblk.png');
        if (sysLogoResponse.ok) {
          const sysLogoBlob = await sysLogoResponse.blob();
          const sysLogoReader = new FileReader();
          sysLogoReader.readAsDataURL(sysLogoBlob);
          await new Promise<void>(resolve => {
            sysLogoReader.onloadend = () => {
              const sysLogoData = sysLogoReader.result as string;
              const sysLogoWidth = 40;
              const sysLogoHeight = 15;
              const sysLogoX = qrX + (qrSize / 2) - (sysLogoWidth / 2);
              doc.addImage(sysLogoData, 'PNG', sysLogoX, qrY + qrSize + 8, sysLogoWidth, sysLogoHeight, undefined, 'FAST');
              resolve();
            };
          });
        }
      } catch (e) {
        console.error("Could not load system logo:", e);
      }

      // --- FORM INFO SECTION ---
      doc.setFontSize(10);
      doc.setFont(FONT_FAMILY, 'normal');
      let currentY = 100;

      // Build personnel string with accompanying personnel
      let personnelStr = sanitizeForPdfFont(actionRecord.createdByName);
      if (actionRecord.eslikEdenPersonel && actionRecord.eslikEdenPersonel.length > 0) {
        const eslikNames = actionRecord.eslikEdenPersonel.map(p => sanitizeForPdfFont(p.name)).join(', ');
        personnelStr += ` (Eslik Eden: ${eslikNames})`;
      }

      const info = [
          ['Form No:', actionRecord.id],
          ['Laboratuvar:', sanitizeForPdfFont(hospital?.name)],
          ['Cihaz:', sanitizeForPdfFont(`${device.cihazAdi} (SN: ${device.seriNumarasi})`)],
          ['Islemi Yapan:', personnelStr],
          ['Tarih / Saat:', format(actionRecord.createdAt.toDate(), 'dd.MM.yyyy HH:mm')]
      ];

      autoTable(doc, {
        body: info,
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // --- YAPILAN ISLEMLER SECTION ---
      const operations = actionRecord.actions.filter(a => a.type === 'operation');
      if (operations.length > 0) {
        doc.setFont(FONT_FAMILY, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(sanitizeForPdfFont('Yapilan Islemler'), padX, currentY + 12);
        currentY += 18;

        autoTable(doc, {
          head: [['Islem', 'Aciklama']],
          body: operations.map(act => [
              sanitizeForPdfFont(getOperationLabel(act.action)),
              sanitizeForPdfFont(act.description || '-')
          ]),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT_FAMILY, fontSize: 10 },
          headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // --- DEGISEN PARCALAR SECTION ---
      const parts = actionRecord.actions.filter(a => a.type === 'part_change');
      if (parts.length > 0) {
        doc.setFont(FONT_FAMILY, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(sanitizeForPdfFont('Degisen Parcalar'), padX, currentY + 12);
        currentY += 18;

        autoTable(doc, {
          head: [['Parca', 'Kod', 'Adet']],
          body: parts.map(act => {
            let partName = act.stokAdi || act.action;
            // If it's a manual entry, show code - name format
            if (act.isManualEntry && act.stokKodu && act.stokAdi) {
              partName = `${act.stokKodu} - ${act.stokAdi}`;
            }
            return [
              sanitizeForPdfFont(partName),
              sanitizeForPdfFont(act.stokKodu || '-'),
              String(act.quantity)
            ];
          }),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT_FAMILY, fontSize: 10 },
          headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // --- CIHAZ DURUMU SECTION ---
      doc.setFont(FONT_FAMILY, 'bold');
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.line(padX, currentY, pageW - padX, currentY);
      doc.text(sanitizeForPdfFont('Cihaz Durumu'), padX, currentY + 12);
      currentY += 18;

      let cihazDurumuStr = sanitizeForPdfFont(CIHAZ_DURUMU_LABELS[actionRecord.cihazDurumu || '']);
      if (actionRecord.cihazDurumu === 'diger' && actionRecord.cihazDurumuAciklama) {
        cihazDurumuStr += ` (${sanitizeForPdfFont(actionRecord.cihazDurumuAciklama)})`;
      }

      autoTable(doc, {
        body: [
          ['Durum:', cihazDurumuStr],
        ],
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
      });

      const finalY = (doc as any).lastAutoTable.finalY;

      // --- ADD SIGNATURES ---
      const signatureY = finalY + 40;
      if (signatureY < pageH - 120) {
          doc.setFont(FONT_FAMILY, 'bold');
          doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
          doc.line(padX, signatureY - 15, pageW - padX, signatureY - 15);
          doc.text(sanitizeForPdfFont('Imzalar'), padX, signatureY - 3);

          doc.setFont(FONT_FAMILY, 'normal');
          doc.setFontSize(10);

          doc.text(sanitizeForPdfFont('Islemi Yapan Personel'), padX, signatureY + 15);
          doc.line(padX, signatureY + 20, padX + 150, signatureY + 20);
          if (actionRecord.personnelSignature) {
            doc.addImage(actionRecord.personnelSignature, 'PNG', padX, signatureY + 25, 150, 40, undefined, 'FAST');
          }

          doc.text(sanitizeForPdfFont('Aplikasyon Uzmani'), pageW / 2 + 20, signatureY + 15);
          doc.line(pageW / 2 + 20, signatureY + 20, pageW / 2 + 170, signatureY + 20);
          if (actionRecord.technicianSignature) {
            doc.addImage(actionRecord.technicianSignature, 'PNG', pageW / 2 + 20, signatureY + 25, 150, 40, undefined, 'FAST');
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

      doc.save(`AplikasyonFormu_${device.seriNumarasi}_${actionRecord.id.substring(0,6)}.pdf`);
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
