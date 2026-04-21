
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';
import { prefetchPdfAssets, resolveLabDisplayName, computeFormNo } from '@/lib/pdf-assets';

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

type IslemTuru = 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'ariza' | 'alis' | 'roche_bilgisayar_arizasi' | 'diger' | '';
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation' | 'hucre_degisimi';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  anaBirim?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  hucreNumarasi?: string;
  removedHucreNumarasi?: string;
  channelSelections?: ('CH1' | 'CH2')[];
  removedPartSerialNumber?: string;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByUid: string;
    createdByName: string;
    formNo?: string;
    actions: ActionItem[];
    islemTuru?: IslemTuru;
    aciklama?: string;
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    selectedMaintenanceTasks?: { id: string; taskName: string }[];
    selectedFaultName?: string;
    selectedTests?: string[];
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
    technicianName?: string;
    baslangicTarihi?: string;
    baslangicSaati?: string;
    bitisTarihi?: string;
    bitisSaati?: string;
};

const OPERATION_LABELS: Record<OperationType, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibratör Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Çalışması',
  diger: 'Diğer',
};

const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': '-',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  ariza: 'Arıza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
  diger: 'Diğer',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': '-',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

export type AplikasyonTutanakPDFButtonProps = {
  device: Device;
  hospital: Hospital | null;
  actionRecord: ActionFormRecord;
  className?: string;
};

const FALLBACK_FONT = 'helvetica';

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

function txt(str: string | null | undefined, useTurkish: boolean): string {
    if (!str) return '';
    return useTurkish ? str : sanitize(str);
}

function getOperationLabel(action: string): string {
  if (OPERATION_LABELS[action as OperationType]) {
    return OPERATION_LABELS[action as OperationType];
  }
  return action;
}


export async function generateAplikasyonTutanakPDF(
  device: Device,
  hospital: Hospital | null,
  actionRecord: ActionFormRecord,
  openInNewWindow: boolean = false
) {
  try {
    const hospitalId = hospital?.id || device.hospitalId;
    const recordUrl = `${window.location.origin}/aplikasyon-paneli/islem-formu/${device.id}?focus=${actionRecord.id}`;

    // Fire ALL independent async operations in parallel
    const [assets, labDisplayName, qrDataUrl, formNo] = await Promise.all([
      prefetchPdfAssets(),
      resolveLabDisplayName(hospitalId, hospital?.name || ''),
      QRCode.toDataURL(recordUrl, { errorCorrectionLevel: 'M', margin: 0, scale: 4 }),
      actionRecord.formNo
        ? Promise.resolve(actionRecord.formNo)
        : computeFormNo('aplikasyonActionForms', 'createdByUid', actionRecord.createdByUid, actionRecord.id, actionRecord.createdByName, 'A'),
    ]);

    const pdfDoc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = pdfDoc.internal.pageSize.getWidth();
    const pageH = pdfDoc.internal.pageSize.getHeight();
    const padX = 40;

    const useTurkish = assets.fontBase64 ? setupTurkishFont(pdfDoc, assets.fontBase64) : false;
    const FONT = useTurkish ? 'NotoSans' : FALLBACK_FONT;
    pdfDoc.setFont(FONT);

    const ORANGE = { r: 199, g: 137, b: 65 };
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.setLineWidth(2);
    pdfDoc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

    // --- HEADER ---
    const headerY = 30;
    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.setFontSize(14);
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.text('Aplikasyon Formu', padX, headerY + 20);

    if (assets.headerLogo) {
      const logoWidth = 132;
      const logoHeight = 40;
      const logoX = (pageW / 2) - (logoWidth / 2);
      pdfDoc.addImage(assets.headerLogo, 'PNG', logoX, headerY + 5, logoWidth, logoHeight, undefined, 'FAST');
    }

    const qrSize = 60;
    const qrX = pageW - padX - qrSize - 10;
    const qrY = headerY;
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.setFillColor(255, 255, 255);
    pdfDoc.setLineWidth(2);
    pdfDoc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 5, 5, 'FD');
    pdfDoc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');

    if (assets.sysLogo) {
      const sysLogoSize = 28;
      const sysLogoX = qrX + (qrSize / 2) - (sysLogoSize / 2);
      pdfDoc.addImage(assets.sysLogo, 'PNG', sysLogoX, qrY + qrSize + 5, sysLogoSize, sysLogoSize, undefined, 'FAST');
    }

    // --- FORM INFO ---
    pdfDoc.setFontSize(10);
    pdfDoc.setFont(FONT, 'normal');
    let currentY = 100;

    let personnelStr = txt(actionRecord.createdByName, useTurkish);
    if (actionRecord.eslikEdenPersonel && actionRecord.eslikEdenPersonel.length > 0) {
      const eslikNames = actionRecord.eslikEdenPersonel.map(p => txt(p.name, useTurkish)).join(', ');
      personnelStr += ` (${txt('Eşlik Eden', useTurkish)}: ${eslikNames})`;
    }

    let baslangicFormatted = '-';
    if (actionRecord.baslangicTarihi && actionRecord.baslangicSaati) {
        baslangicFormatted = `${actionRecord.baslangicTarihi.split('-').reverse().join('.')} ${actionRecord.baslangicSaati}`;
    } else if (actionRecord.createdAt && typeof actionRecord.createdAt.toDate === 'function') {
        baslangicFormatted = format(actionRecord.createdAt.toDate(), 'dd.MM.yyyy HH:mm');
    }

    let bitisFormatted = '-';
    if (actionRecord.bitisTarihi && actionRecord.bitisSaati) {
        bitisFormatted = `${actionRecord.bitisTarihi.split('-').reverse().join('.')} ${actionRecord.bitisSaati}`;
    }

    const info = [
        ['Form No:', formNo],
        ['Laboratuvar:', txt(labDisplayName, useTurkish)],
        ['Cihaz:', txt(`${device.cihazAdi || device.model} (SN: ${device.seriNumarasi})`, useTurkish)],
        [txt('İşlemi Yapan:', useTurkish), personnelStr],
        [txt('Başlangıç:', useTurkish), baslangicFormatted],
        [txt('Bitiş:', useTurkish), bitisFormatted]
    ];

    autoTable(pdfDoc, {
      body: info,
      startY: currentY,
      theme: 'plain',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } }
    });

    currentY = (pdfDoc as any).lastAutoTable.finalY + 15;

    // --- ISLEM TIPI VE TURU ---
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.setFontSize(10);
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.line(padX, currentY, pageW - padX, currentY);
    pdfDoc.text(txt('İşlem Tipi ve Türü', useTurkish), padX, currentY + 12);
    currentY += 18;
    pdfDoc.setFont(FONT, 'normal');

    autoTable(pdfDoc, {
      body: [
        [txt('İşlem Tipi:', useTurkish), txt('Aplikasyon', useTurkish)],
        [txt('İşlem Türü:', useTurkish), txt(ISLEM_TURU_LABELS[actionRecord.islemTuru || ''] || '-', useTurkish)],
      ],
      startY: currentY,
      theme: 'plain',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
      margin: { left: padX, right: padX },
    });

    currentY = (pdfDoc as any).lastAutoTable.finalY + 15;

    // --- ISLEM TURUNE OZEL DETAYLAR ---
    const hasPeriyodikDetay = actionRecord.islemTuru === 'periyodik_bakim' && (actionRecord.selectedMaintenanceTasks?.length ?? 0) > 0;
    const hasArizaDetay = actionRecord.islemTuru === 'ariza' && (Boolean(actionRecord.selectedFaultName) || (actionRecord.selectedTests?.length ?? 0) > 0);

    if (hasPeriyodikDetay || hasArizaDetay) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('İşlem Türüne Özel Detaylar', useTurkish), padX, currentY + 12);
      currentY += 18;

      const detailRows: string[][] = [];

      if (hasPeriyodikDetay) {
        detailRows.push([
          txt('Periyodik Bakım İşleri', useTurkish),
          txt(actionRecord.selectedMaintenanceTasks!.map(task => task.taskName).join(', '), useTurkish),
        ]);
      }

      if (hasArizaDetay) {
        detailRows.push([
          txt('Tespit Edilen Arıza', useTurkish),
          txt(actionRecord.selectedFaultName || '-', useTurkish),
        ]);

        if ((actionRecord.selectedTests?.length ?? 0) > 0) {
          detailRows.push([
            txt('Arıza ile İlişkili Testler', useTurkish),
            txt(actionRecord.selectedTests!.join(', '), useTurkish),
          ]);
        }
      }

      autoTable(pdfDoc, {
        body: detailRows,
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 5, bottom: 5 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- ACIKLAMA ---
    if (actionRecord.aciklama?.trim()) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Açıklama', useTurkish), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        body: [[txt(actionRecord.aciklama, useTurkish)]],
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- YAPILAN ISLEMLER ---
    const operations = actionRecord.actions.filter(a => a.type === 'operation');
    if (operations.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Yapılan İşlemler', useTurkish), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [[txt('İşlem', useTurkish), txt('Açıklama', useTurkish)]],
        body: operations.map(act => [
            txt(getOperationLabel(act.action), useTurkish),
            txt(act.description || '-', useTurkish)
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- DEGISEN PARCALAR ---
    const parts = actionRecord.actions.filter(a => a.type === 'part_change');
    if (parts.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Değişen Parçalar', useTurkish), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [[txt('Parça', useTurkish), 'Kod', 'Adet', txt('Birim', useTurkish)]],
        body: parts.map(act => {
          let partName = act.stokAdi || act.action;
          if (act.isManualEntry && act.stokKodu && act.stokAdi) {
            partName = `${act.stokKodu} - ${act.stokAdi}`;
          }
          return [
            txt(partName, useTurkish),
            txt(act.stokKodu || '-', useTurkish),
            String(act.quantity),
            txt(act.anaBirim ? act.anaBirim.toLocaleLowerCase('tr-TR') : 'adet', useTurkish)
          ];
        }),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    const hucreChanges = actionRecord.actions.filter(a => a.type === 'hucre_degisimi');
    if (hucreChanges.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Hücre Değişimleri', useTurkish), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [[txt('Parça', useTurkish), txt('Kod', useTurkish), txt('Takılan/Çıkan', useTurkish), txt('Kanal', useTurkish)]],
        body: hucreChanges.map(act => [
          txt(act.stokAdi || '-', useTurkish),
          txt(act.stokKodu || '-', useTurkish),
          txt(`H:${act.hucreNumarasi || '-'} / H:${act.removedHucreNumarasi || '-'}`, useTurkish),
          txt(act.channelSelections?.join(', ') || '-', useTurkish),
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- CIHAZ DURUMU ---
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.line(padX, currentY, pageW - padX, currentY);
    pdfDoc.text('Cihaz Durumu', padX, currentY + 12);
    currentY += 18;

    let cihazDurumuStr = txt(CIHAZ_DURUMU_LABELS[actionRecord.cihazDurumu || ''], useTurkish);
    if (actionRecord.cihazDurumu === 'diger' && actionRecord.cihazDurumuAciklama) {
      cihazDurumuStr += ` (${txt(actionRecord.cihazDurumuAciklama, useTurkish)})`;
    }

    autoTable(pdfDoc, {
      body: [
        ['Durum:', cihazDurumuStr],
      ],
      startY: currentY,
      theme: 'plain',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
      margin: { left: padX, right: padX },
    });

    const finalY = (pdfDoc as any).lastAutoTable.finalY;

    // --- SIGNATURES ---
    let sigY = finalY + 40;
    if (sigY > pageH - 140) {
      pdfDoc.addPage();
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.setLineWidth(2);
      pdfDoc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);
      sigY = 60;
    }

    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.line(padX, sigY - 15, pageW - padX, sigY - 15);
    pdfDoc.text(txt('İmzalar', useTurkish), padX, sigY - 3);

    pdfDoc.setFont(FONT, 'normal');
    pdfDoc.setFontSize(10);

    pdfDoc.text(txt('İşlemi Yapan Personel', useTurkish), padX, sigY + 15);
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.text(txt(actionRecord.createdByName, useTurkish), padX, sigY + 28);
    pdfDoc.setFont(FONT, 'normal');
    pdfDoc.line(padX, sigY + 32, padX + 150, sigY + 32);
    if (actionRecord.personnelSignature) {
      pdfDoc.addImage(actionRecord.personnelSignature, 'PNG', padX, sigY + 37, 150, 40, undefined, 'FAST');
    }

    pdfDoc.text('Teknisyen', pageW / 2 + 20, sigY + 15);
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.text(txt(actionRecord.technicianName || '-', useTurkish), pageW / 2 + 20, sigY + 28);
    pdfDoc.setFont(FONT, 'normal');
    pdfDoc.line(pageW / 2 + 20, sigY + 32, pageW / 2 + 170, sigY + 32);
    if (actionRecord.technicianSignature) {
      pdfDoc.addImage(actionRecord.technicianSignature, 'PNG', pageW / 2 + 20, sigY + 37, 150, 40, undefined, 'FAST');
    }

    if (openInNewWindow) {
      const blobURL = pdfDoc.output('bloburl');
      window.open(blobURL, '_blank');
    } else {
      const safeFormNo = String(formNo || actionRecord.id || '').replace(/[^A-Za-z0-9-_]/g, '');
      pdfDoc.save(`AplikasyonFormu_${device.seriNumarasi}_${safeFormNo || actionRecord.id.substring(0,6)}.pdf`);
    }
  } catch (e) {
    console.error('PDF export error:', e);
  }
}

export default function AplikasyonTutanakPDFButton({ device, hospital, actionRecord, className }: AplikasyonTutanakPDFButtonProps) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    await generateAplikasyonTutanakPDF(device, hospital, actionRecord, false);
    setBusy(false);
  };

  return (
    <Button onClick={onExport} disabled={busy} variant="ghost" size="sm" className={className}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}
