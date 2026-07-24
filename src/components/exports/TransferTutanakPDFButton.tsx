'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';
import { loadClayKit, renderTransferForm, type TransferRow } from '@/lib/pdf/clay-tutanak';

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

function unitLabel(r: Row): string {
  const mult = formatUnitMultiplier(r);
  return `${normalizeUnitLabel(r.anaBirim)}${mult ? ` (${mult})` : ''}`;
}

export async function generateTransferTutanakPDF(header: HeaderInfo, rows: Row[]) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
  const kit = await loadClayKit();

  const transferRows: TransferRow[] = rows.map((r) => ({
    kod: r.stokKodu || '-',
    urun: r.urun || '-',
    lot: r.lot || '-',
    miad: r.miad || '-',
    adet: r.adet,
    birim: unitLabel(r),
  }));

  const doc = await renderTransferForm(kit, {
    title: 'Transfer Tutanağı',
    eyebrow: '',
    qrPayload: `${origin}/transfer-gecmis/${encodeURIComponent(header.shipmentId)}`,
    tarihSaat: `${header.tarih} · ${header.saat}`,
    gonderen: { depo: header.depotName, teslimEden: header.karsilayan },
    teslimAlan: { kurum: header.kurumAdi, firma: header.company },
    rows: transferRows,
    toplamKalem: rows.length,
    toplamAdet: rows.reduce((s, r) => s + (Number(r.adet) || 0), 0),
  });

  doc.save(`Transfer_${header.shipmentId}_Form.pdf`);
}

export default function TransferTutanakPDFButton({ header, rows, className }: TransferTutanakPDFButtonProps) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      await generateTransferTutanakPDF(header, rows);
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
