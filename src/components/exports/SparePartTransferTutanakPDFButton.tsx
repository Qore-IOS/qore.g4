'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { normalizeUnitLabel } from '@/lib/product-unit';
import { loadClayKit, renderTransferForm } from '@/lib/pdf/clay-tutanak';

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

export default function SparePartTransferTutanakPDFButton({ log, className }: Props) {
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const now = log.timestamp || log.createdAt || new Date();
      const teslimEden = log.fromName || log.createdByName || '-';
      const teslimAlan = log.toName || '-';
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
      const kit = await loadClayKit();

      const doc = await renderTransferForm(kit, {
        title: 'Transfer Tutanağı',
        eyebrow: 'İnVitro Lab · Yedek Parça Belgesi',
        qrPayload: `${origin}/direkt-transfer/yedek-parca-transfer`,
        tarihSaat: format(now, 'dd.MM.yyyy · HH:mm', { locale: tr }),
        gonderen: { depoLabel: 'Depo', depo: 'Yedek Parça Deposu', teslimEden },
        teslimAlan: { kurumLabel: 'Personel', kurum: teslimAlan },
        variant: 'yedek',
        tableTitle: 'Parça Bilgileri',
        rows: [{
          kod: log.stokKodu || '-',
          urun: log.stokAdi || '-',
          seri: (log.serialNumber || '').trim() || '-',
          adet: log.quantity || 1,
          birim: normalizeUnitLabel(log.anaBirim),
          tarih: format(now, 'dd.MM.yyyy HH:mm', { locale: tr }),
        }],
        toplamKalem: 1,
        toplamAdet: log.quantity || 1,
      });

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
