'use client';
import React from 'react';
import { hapticDouble } from '@/lib/haptics';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import type { Device, Hospital } from '@/lib/types';
import { resolveLabDisplayName, computeFormNo } from '@/lib/pdf-assets';
import { loadClayKit, renderActionForm, type ActionFormInput, type DurumTone } from '@/lib/pdf/clay-tutanak';
import { useAuth } from '@/contexts/auth-context';

type OperationType =
  | 'genel_temizlik_yaglama'
  | 'temel_fonksiyon_testleri'
  | 'mekanik_ayarlar_kontrol'
  | 'optik_ayarlar_kontrol'
  | 'pipetleme_transfer_ayarlari';

type IslemTipi = 'cihaz' | 'ups' | 'su_sistemi' | '';
type IslemTuru = 'kontrol' | 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'cihaz_kurulumu' | 'ariza' | 'sw_update' | 'alis' | 'roche_bilgisayar_arizasi' | '';
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
  serialNumber?: string;
};

type ActionFormRecord = {
  id: string;
  createdAt: { toDate: () => Date };
  createdByUid: string;
  createdByName: string;
  formNo?: string;
  actions: ActionItem[];
  islemTipi?: IslemTipi;
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
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
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

function getOperationLabel(action: string): string {
  return OPERATION_LABELS[action as OperationType] || action;
}

function fmtDateTime(tarih?: string, saat?: string, fallback?: Date): string {
  if (tarih && saat) return `${tarih.split('-').reverse().join('.')} · ${saat}`;
  if (fallback) return format(fallback, 'dd.MM.yyyy · HH:mm');
  return '-';
}

export async function generateTeknikServisTutanakPDF(
  device: Device,
  hospital: Hospital | null,
  actionRecord: ActionFormRecord,
  openInNewWindow: boolean = false,
  companyId: string | null = null,
  isSuperAdmin: boolean = false,
) {
  try {
    const hospitalId = hospital?.id || device.hospitalId;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://invpilot.web.app';
    const qrPayload = `${origin}/teknik-servis/islem-formu/${device.id}?focus=${actionRecord.id}`;

    const [kit, labName, formNo] = await Promise.all([
      loadClayKit(),
      resolveLabDisplayName(hospitalId, hospital?.name || '', companyId, isSuperAdmin),
      actionRecord.formNo
        ? Promise.resolve(actionRecord.formNo)
        : computeFormNo('teknikServisActionForms', 'createdByUid', actionRecord.createdByUid, actionRecord.id, actionRecord.createdByName, 'T', companyId, isSuperAdmin),
    ]);

    const actions = actionRecord.actions || [];
    const chips: { label: string; value: string }[] = [
      { label: 'İşlem Tipi', value: ISLEM_TIPI_LABELS[actionRecord.islemTipi || ''] },
      { label: 'İşlem Türü', value: ISLEM_TURU_LABELS[actionRecord.islemTuru || ''] },
    ];
    if (actionRecord.islemTuru === 'ariza' && actionRecord.selectedFaultName) {
      chips.push({ label: 'Tespit Edilen Arıza', value: actionRecord.selectedFaultName });
    }

    const details: { label: string; value: string }[] = [];
    if (actionRecord.islemTuru === 'periyodik_bakim' && (actionRecord.selectedMaintenanceTasks?.length ?? 0) > 0) {
      details.push({ label: 'Periyodik Bakım İşleri', value: actionRecord.selectedMaintenanceTasks!.map((t) => t.taskName).join(', ') });
    }
    if ((actionRecord.selectedTests?.length ?? 0) > 0) {
      details.push({ label: 'Arıza ile İlişkili Testler', value: actionRecord.selectedTests!.join(', ') });
    }

    let cihazDurumuStr = CIHAZ_DURUMU_LABELS[actionRecord.cihazDurumu || ''];
    if (actionRecord.cihazDurumu === 'diger' && actionRecord.cihazDurumuAciklama) cihazDurumuStr += ` (${actionRecord.cihazDurumuAciklama})`;
    const durumTone: DurumTone = actionRecord.cihazDurumu === 'calisiyor' ? 'green' : actionRecord.cihazDurumu === 'arizali' ? 'red' : 'neutral';

    const eslik = (actionRecord.eslikEdenPersonel || []).map((p) => p.name).filter(Boolean).join(', ');

    const input: ActionFormInput = {
      title: 'Teknik Servis Formu',
      formNo,
      qrPayload,
      labName,
      cihaz: `${device.cihazAdi || device.model || '-'} · SN ${device.seriNumarasi || '-'}`,
      islemiYapan: actionRecord.createdByName,
      eslikEden: eslik || null,
      baslangic: fmtDateTime(actionRecord.baslangicTarihi, actionRecord.baslangicSaati, actionRecord.createdAt.toDate()),
      bitis: fmtDateTime(actionRecord.bitisTarihi, actionRecord.bitisSaati),
      cihazDurumu: cihazDurumuStr,
      durumTone,
      chips,
      details,
      aciklama: actionRecord.aciklama,
      operations: actions.filter((a) => a.type === 'operation').map((a) => ({ ad: getOperationLabel(a.action), adet: a.quantity })),
      parts: actions.filter((a) => a.type === 'part_change').map((a) => {
        let partName = a.stokAdi || a.action;
        if (a.isManualEntry && a.stokKodu && a.stokAdi) partName = `${a.stokKodu} - ${a.stokAdi}`;
        return { parca: partName, kod: a.stokKodu || '-', seri: (a.serialNumber || '').trim() || '-', adet: a.quantity, birim: a.anaBirim ? a.anaBirim.toLocaleLowerCase('tr-TR') : 'adet' };
      }),
      hucreChanges: actions.filter((a) => a.type === 'hucre_degisimi').map((a) => ({
        parca: a.stokAdi || '-', kod: a.stokKodu || '-',
        takilanCikan: `H:${a.hucreNumarasi || '-'} / H:${a.removedHucreNumarasi || '-'}`,
        kanal: a.channelSelections?.join(', ') || '-',
      })),
      leftSign: { label: 'İşlemi Yapan', name: actionRecord.createdByName, sig: actionRecord.personnelSignature },
      rightSign: { label: 'Kurum Yetkilisi', name: actionRecord.technicianName, sig: actionRecord.technicianSignature },
    };

    const doc = await renderActionForm(kit, input);

    if (openInNewWindow) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const safeFormNo = String(formNo || actionRecord.id || '').replace(/[^A-Za-z0-9-_]/g, '');
      doc.save(`IslemFormu_${device.seriNumarasi}_${safeFormNo || actionRecord.id.substring(0, 6)}.pdf`);
    }
  } catch (e) {
    console.error('PDF export error:', e);
  }
}

export default function TeknikServisTutanakPDFButton({ device, hospital, actionRecord, className }: TeknikServisTutanakPDFButtonProps) {
  const [busy, setBusy] = React.useState(false);
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const onExport = async () => {
    setBusy(true);
    await generateTeknikServisTutanakPDF(device, hospital, actionRecord, false, currentCompanyId, isSuperAdmin);
    hapticDouble();
    setBusy(false);
  };

  return (
    <Button onClick={onExport} disabled={busy} variant="ghost" size="sm" className={className}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}
