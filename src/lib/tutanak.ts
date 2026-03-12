'use client';
import { autoPrintTutanakFromTransferId } from './tutanak-autoprint';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';

export type TutanakGroup = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  adet: number;
  anaBirim?: string;
  ambalajDegeri?: number | null;
  serials?: string[];
};

export type TutanakContext = {
  transferOrShipmentId: string;
  sourceDepotName: string;
  targetLabName: string;
  userName?: string;
  timestamp: Date;
};

export function isAutoTutanakEnabled(lab: any | null | undefined): boolean {
  if (!lab) return false;
  // Accept several possible field names to be robust with existing schema:
  return Boolean(
    lab.autoTutanak ??
    lab.autoPrintTutanak ??
    lab.autoPrintNote ??
    lab.auto_print_tutanak
  );
}

export function buildGroupsFromItems(items: Array<{
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  seriNumarasi?: string;
  anaBirim?: string;
  ambalajDegeri?: number | null;
}>): TutanakGroup[] {
  const map = new Map<string, TutanakGroup>();
  for (const it of items) {
    const key = `${it.stokKodu}__${it.lotNumarasi || ''}__${it.miad || ''}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi || '',
        miad: it.miad || '',
        adet: 1,
        anaBirim: it.anaBirim || 'Adet',
        ambalajDegeri: it.ambalajDegeri ?? null,
        serials: it.seriNumarasi ? [it.seriNumarasi] : [],
      });
    } else {
      prev.adet += 1;
      if (it.seriNumarasi) prev.serials?.push(it.seriNumarasi);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
}

export function generateTutanakPDF(groups: TutanakGroup[], ctx: TutanakContext) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const padX = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Teslim Tutanagi', padX, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Ref No: ${ctx.transferOrShipmentId}`, padX, 60);
  doc.text(`Kaynak Depo: ${ctx.sourceDepotName}`, padX, 78);
  doc.text(`Hedef Laboratuvar: ${ctx.targetLabName}`, padX, 96);
  doc.text(`Islemi Yapan: ${ctx.userName || '-'}`, padX, 114);
  doc.text(`Tarih: ${ctx.timestamp.toLocaleString('tr-TR')}`, padX, 132);

  autoTable(doc, {
    head: [[ 'Stok Adi', 'Stok Kodu', 'Lot', 'Miad', 'Adet', 'Birim' ]],
    body: groups.map(g => [
      g.stokAdi,
      g.stokKodu,
      g.lotNumarasi || '-',
      g.miad || '-',
      String(g.adet),
      `${normalizeUnitLabel(g.anaBirim)}${formatUnitMultiplier(g) ? ` (${formatUnitMultiplier(g)})` : ''}` ,
    ]),
    startY: 160,
    styles: { font: 'helvetica', fontSize: 10 },
    headStyles: { fillColor: [240, 240, 240] },
    margin: { left: padX, right: padX },
  });

  // Optional: append serial listings page if exists
  const groupsWithSerials = groups.filter(g => (g.serials?.length || 0) > 0);
  if (groupsWithSerials.length > 0) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Seri Numarasi Detaylari', padX, 40);

    const serialRows: any[] = [];
    groupsWithSerials.forEach(g => {
      (g.serials || []).forEach(s => serialRows.push([g.stokAdi, g.stokKodu, s]));
    });

    autoTable(doc, {
      head: [[ 'Stok Adı', 'Stok Kodu', 'Seri No' ]],
      body: serialRows,
      startY: 60,
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240] },
      margin: { left: padX, right: padX },
    });
  }

  return doc;
}

export function autoPrintPdf(doc: jsPDF) {
  // Trigger print dialog as soon as opened
  doc.autoPrint();
  const blobUrl = doc.output('bloburl');

  // Try to re-use a synchronously opened window to avoid popup blockers:
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (win) {
    try {
      // Navigate the pre-opened window to the PDF URL (autoPrint flag will prompt)
      win.location.href = blobUrl;
      // Some browsers will show print dialog automatically due to autoPrint flag.
      // We also try a best-effort print call after load:
      const onLoad = () => {
        try { win.focus(); win.print(); } catch {}
      };
      // Not all browsers fire load here, but harmless if not.
      win.addEventListener?.('load', onLoad, { once: true } as any);
      // Safety: close the window after a delay if user already confirmed print
      setTimeout(() => { try { win.close(); } catch {} }, 15000);
      return;
    } catch {
      // fallback below
    }
  }

  // Fallback: just open the blob URL (browser will ask to allow popups if blocked)
  window.open(blobUrl, '_blank', 'noopener,noreferrer');
}

export async function maybeAutoPrintTutanak(
  db: any,
  lab: any | null | undefined,
  transferId: string,
  currentUserName?: string
) {
  if (!isAutoTutanakEnabled(lab)) return;

  try {
    await autoPrintTutanakFromTransferId(db, transferId, lab, currentUserName);
  } catch (error) {
    console.error("Auto-print failed:", error);
    // Optionally inform user that auto-print failed but transfer was successful
  }
}
