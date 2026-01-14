
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';

// Turkish font cache
let turkishFontBase64: string | null = null;

async function loadTurkishFont(): Promise<string | null> {
  if (turkishFontBase64) return turkishFontBase64;

  try {
    // Try Noto Sans which has excellent Turkish support
    const fontUrl = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf';
    const response = await fetch(fontUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        turkishFontBase64 = result.split(',')[1];
        resolve(turkishFontBase64);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Could not load Turkish font:', e);
    return null;
  }
}

function setupTurkishFont(doc: jsPDF, fontBase64: string): boolean {
  try {
    doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    return true;
  } catch (e) {
    console.error('Could not setup Turkish font:', e);
    return false;
  }
}

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

// Turkish labels - will use Turkish font if available
const OPERATION_LABELS: Record<OperationType, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
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
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': '-',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

export type TeknikServisTutanakPDFButtonProps = {
  device: Device;
  hospital: Hospital | null;
  actionRecord: ActionFormRecord;
  className?: string;
};

const FALLBACK_FONT = 'helvetica';

// Sanitize Turkish characters to ASCII equivalents when Turkish font not available
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

// Process text based on font availability
function txt(str: string | null | undefined, useTurkish: boolean): string {
    if (!str) return '';
    return useTurkish ? str : sanitize(str);
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

      // Try to load Turkish font
      const fontBase64 = await loadTurkishFont();
      const useTurkish = fontBase64 ? setupTurkishFont(doc, fontBase64) : false;
      const FONT = useTurkish ? 'NotoSans' : FALLBACK_FONT;

      doc.setFont(FONT);

      const ORANGE = { r: 199, g: 137, b: 65 };
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.setLineWidth(2);
      doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

      // --- HEADER SECTION: Title (left), Logo (center), QR Code (right) ---
      const headerY = 30;

      // Title on left
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont(FONT, 'bold');
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
      doc.setFont(FONT, 'normal');
      let currentY = 100;

      // Build personnel string with accompanying personnel
      let personnelStr = txt(actionRecord.createdByName, useTurkish);
      if (actionRecord.eslikEdenPersonel && actionRecord.eslikEdenPersonel.length > 0) {
        const eslikNames = actionRecord.eslikEdenPersonel.map(p => txt(p.name, useTurkish)).join(', ');
        personnelStr += ` (${txt('Eşlik Eden', useTurkish)}: ${eslikNames})`;
      }

      const info = [
          ['Form No:', actionRecord.id],
          ['Laboratuvar:', txt(hospital?.name, useTurkish)],
          ['Cihaz:', txt(`${device.cihazAdi} (SN: ${device.seriNumarasi})`, useTurkish)],
          [txt('İşlemi Yapan:', useTurkish), personnelStr],
          ['Tarih / Saat:', format(actionRecord.createdAt.toDate(), 'dd.MM.yyyy HH:mm')]
      ];

      autoTable(doc, {
        body: info,
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // --- ISLEM TIPI & TURU SECTION ---
      doc.setFont(FONT, 'bold');
      doc.setFontSize(10);
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.line(padX, currentY, pageW - padX, currentY);
      doc.text(txt('İşlem Tipi ve Türü', useTurkish), padX, currentY + 12);
      currentY += 18;
      doc.setFont(FONT, 'normal');

      autoTable(doc, {
        body: [
          [txt('İşlem Tipi:', useTurkish), txt(ISLEM_TIPI_LABELS[actionRecord.islemTipi || ''], useTurkish)],
          [txt('İşlem Türü:', useTurkish), txt(ISLEM_TURU_LABELS[actionRecord.islemTuru || ''], useTurkish)],
        ],
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // --- YAPILAN ISLEMLER SECTION ---
      const operations = actionRecord.actions.filter(a => a.type === 'operation');
      if (operations.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(txt('Yapılan İşlemler', useTurkish), padX, currentY + 12);
        currentY += 18;

        autoTable(doc, {
          head: [[txt('İşlem', useTurkish), 'Adet']],
          body: operations.map(act => [
              txt(getOperationLabel(act.action), useTurkish),
              String(act.quantity)
          ]),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT, fontSize: 10 },
          headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // --- DEGISEN PARCALAR SECTION ---
      const parts = actionRecord.actions.filter(a => a.type === 'part_change');
      if (parts.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(txt('Değişen Parçalar', useTurkish), padX, currentY + 12);
        currentY += 18;

        autoTable(doc, {
          head: [[txt('Parça', useTurkish), 'Kod', 'Adet']],
          body: parts.map(act => {
            let partName = act.stokAdi || act.action;
            if (act.isManualEntry && act.stokKodu && act.stokAdi) {
              partName = `${act.stokKodu} - ${act.stokAdi}`;
            }
            return [
              txt(partName, useTurkish),
              txt(act.stokKodu || '-', useTurkish),
              String(act.quantity)
            ];
          }),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT, fontSize: 10 },
          headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // --- CIHAZ DURUMU SECTION ---
      doc.setFont(FONT, 'bold');
      doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      doc.line(padX, currentY, pageW - padX, currentY);
      doc.text('Cihaz Durumu', padX, currentY + 12);
      currentY += 18;

      let cihazDurumuStr = txt(CIHAZ_DURUMU_LABELS[actionRecord.cihazDurumu || ''], useTurkish);
      if (actionRecord.cihazDurumu === 'diger' && actionRecord.cihazDurumuAciklama) {
        cihazDurumuStr += ` (${txt(actionRecord.cihazDurumuAciklama, useTurkish)})`;
      }

      autoTable(doc, {
        body: [
          ['Durum:', cihazDurumuStr],
        ],
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
      });

      const finalY = (doc as any).lastAutoTable.finalY;

      // --- ADD SIGNATURES ---
      const signatureY = finalY + 40;
      if (signatureY < pageH - 120) {
          doc.setFont(FONT, 'bold');
          doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
          doc.line(padX, signatureY - 15, pageW - padX, signatureY - 15);
          doc.text(txt('İmzalar', useTurkish), padX, signatureY - 3);

          doc.setFont(FONT, 'normal');
          doc.setFontSize(10);

          doc.text(txt('İşlemi Yapan Personel', useTurkish), padX, signatureY + 15);
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
