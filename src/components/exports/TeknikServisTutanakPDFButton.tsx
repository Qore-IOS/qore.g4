
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';

// Operation types (same as in the form page)
type OperationType =
  | 'genel_temizlik_yaglama'
  | 'temel_fonksiyon_testleri'
  | 'mekanik_ayarlar_kontrol'
  | 'optik_ayarlar_kontrol'
  | 'pipetleme_transfer_ayarlari';

// İşlem Tipi
type IslemTipi = 'cihaz' | 'ups' | 'su_sistemi' | '';

// İşlem Türü
type IslemTuru = 'kontrol' | 'periyodik_bakim' | 'cihaz_kurulumu' | 'ariza' | 'sw_update' | '';

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
    islemTipi?: IslemTipi;
    islemTuru?: IslemTuru;
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

// Labels with ASCII-safe Turkish characters (jsPDF helvetica font doesn't support İ, ı, ş, ğ)
const OPERATION_LABELS: Record<OperationType, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yaglama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarlari & Kontrol',
};

const ISLEM_TIPI_LABELS: Record<IslemTipi, string> = {
  '': '-',
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': '-',
  kontrol: 'Kontrol',
  periyodik_bakim: 'Periyodik Bakim',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Ariza',
  sw_update: 'SW Update',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': '-',
  calisiyor: 'Calisiyor',
  arizali: 'Arizali',
  denemede: 'Denemede',
  diger: 'Diger',
};

export type TeknikServisTutanakPDFButtonProps = {
  device: Device;
  hospital: Hospital | null;
  actionRecord: ActionFormRecord;
  className?: string;
};

const FONT_FAMILY = 'helvetica';

// Sanitize Turkish characters to ASCII equivalents for PDF font compatibility
function sanitize(str: string | null | undefined): string {
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

      // --- HEADER SECTION: Title (left), Logo (center), QR Code (right) ---
      const headerY = 30;

      // Title on left
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont(FONT_FAMILY, 'bold');
      doc.text('Teknik Servis Formu', padX, headerY + 20);

      // Logo in center - try to load invitrolab logo
      try {
        const logoResponse = await fetch('/invitrolab_LOGO__-_Kopya__1_-removebg.png');
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.blob();
          const logoReader = new FileReader();
          logoReader.readAsDataURL(logoBlob);
          await new Promise<void>(resolve => {
            logoReader.onloadend = () => {
              const logoData = logoReader.result as string;
              const logoWidth = 120;
              const logoHeight = 35;
              const logoX = (pageW / 2) - (logoWidth / 2);
              doc.addImage(logoData, 'PNG', logoX, headerY + 5, logoWidth, logoHeight, undefined, 'FAST');
              resolve();
            };
          });
        }
      } catch (e) {
        console.error("Could not load header logo:", e);
      }

      // QR Code on right with orange rounded border
      const recordUrl = `${window.location.origin}/teknik-servis/islem-formu/${device.id}?focus=${actionRecord.id}`;
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

      // System logo below QR - square aspect ratio (4-pointed star logo)
      try {
        const sysLogoResponse = await fetch('/newlogoblk.png');
        if (sysLogoResponse.ok) {
          const sysLogoBlob = await sysLogoResponse.blob();
          const sysLogoReader = new FileReader();
          sysLogoReader.readAsDataURL(sysLogoBlob);
          await new Promise<void>(resolve => {
            sysLogoReader.onloadend = () => {
              const sysLogoData = sysLogoReader.result as string;
              // Square dimensions for 4-pointed star logo
              const sysLogoSize = 28;
              const sysLogoX = qrX + (qrSize / 2) - (sysLogoSize / 2);
              doc.addImage(sysLogoData, 'PNG', sysLogoX, qrY + qrSize + 5, sysLogoSize, sysLogoSize, undefined, 'FAST');
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
      let personnelStr = sanitize(actionRecord.createdByName);
      if (actionRecord.eslikEdenPersonel && actionRecord.eslikEdenPersonel.length > 0) {
        const eslikNames = actionRecord.eslikEdenPersonel.map(p => sanitize(p.name)).join(', ');
        personnelStr += ` (Eslik Eden: ${eslikNames})`;
      }

      const info = [
          ['Form No:', actionRecord.id],
          ['Laboratuvar:', sanitize(hospital?.name)],
          ['Cihaz:', sanitize(`${device.cihazAdi} (SN: ${device.seriNumarasi})`)],
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

      // --- ISLEM TIPI & TURU SECTION ---
      doc.setFont(FONT_FAMILY, 'bold');
      doc.setFontSize(10);
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.line(padX, currentY, pageW - padX, currentY);
      doc.text('Islem Tipi ve Turu', padX, currentY + 12);
      currentY += 18;
      doc.setFont(FONT_FAMILY, 'normal');

      autoTable(doc, {
        body: [
          ['Islem Tipi:', ISLEM_TIPI_LABELS[actionRecord.islemTipi || '']],
          ['Islem Turu:', ISLEM_TURU_LABELS[actionRecord.islemTuru || '']],
        ],
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // --- YAPILAN ISLEMLER SECTION ---
      const operations = actionRecord.actions.filter(a => a.type === 'operation');
      if (operations.length > 0) {
        doc.setFont(FONT_FAMILY, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text('Yapilan Islemler', padX, currentY + 12);
        currentY += 18;

        autoTable(doc, {
          head: [['Islem', 'Adet']],
          body: operations.map(act => [
              getOperationLabel(act.action),
              String(act.quantity)
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
        doc.text('Degisen Parcalar', padX, currentY + 12);
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
              sanitize(partName),
              sanitize(act.stokKodu || '-'),
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
      doc.text('Cihaz Durumu', padX, currentY + 12);
      currentY += 18;

      let cihazDurumuStr = CIHAZ_DURUMU_LABELS[actionRecord.cihazDurumu || ''];
      if (actionRecord.cihazDurumu === 'diger' && actionRecord.cihazDurumuAciklama) {
        cihazDurumuStr += ` (${sanitize(actionRecord.cihazDurumuAciklama)})`;
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
          doc.text('Imzalar', padX, signatureY - 3);

          doc.setFont(FONT_FAMILY, 'normal');
          doc.setFontSize(10);

          doc.text('Islemi Yapan Personel', padX, signatureY + 15);
          doc.line(padX, signatureY + 20, padX + 150, signatureY + 20);
          if (actionRecord.personnelSignature) {
            doc.addImage(actionRecord.personnelSignature, 'PNG', padX, signatureY + 25, 150, 40, undefined, 'FAST');
          }

          doc.text('Teknisyen', pageW / 2 + 20, signatureY + 15);
          doc.line(pageW / 2 + 20, signatureY + 20, pageW / 2 + 170, signatureY + 20);
          if (actionRecord.technicianSignature) {
            doc.addImage(actionRecord.technicianSignature, 'PNG', pageW / 2 + 20, signatureY + 25, 150, 40, undefined, 'FAST');
          }
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
