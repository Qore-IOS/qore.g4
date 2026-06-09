/**
 * Sarf Dağıtım — transfer yardımcıları.
 *
 * Akış: Hastane Sarf labına transfer oluşturulur (status: 'pending').
 * Paket etiketine transferId + mahal kodundan üretilen tekil QR basılır.
 * Paket QR'ı ve ardından mahal QR'ı doğrulandığında teslimat tamamlanır:
 * depo stoğu FEFO ile düşülür (isShipped + hedefKurum = mahal stoğu) ve
 * transfer 'delivered' olur.
 */
import {
  collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { compareAsc, parse } from 'date-fns';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { generateId } from '@/lib/utils';
import type { DepoStokItem, Hospital, SarfTransfer, SarfTransferItem, TimestampLike } from '@/lib/types';

/** Kısa transfer kodu — paket etiketinde basılır (örn. TRF-9K2P7). */
export const genSarfTransferCode = () =>
  'TRF-' + Math.random().toString(36).slice(2, 7).toUpperCase();

/** Paket QR içeriği: mahal kodu + transfer kodu → işleme özel tekil kod. */
export const sarfQrPayload = (tr: Pick<SarfTransfer, 'mahalKodu' | 'code'>) =>
  `${tr.mahalKodu}::${tr.code}`;

/** Okutulan metni ayrıştır: "MAHAL::TRF-XXXXX", salt kod veya salt mahal olabilir. */
export const parseSarfQr = (text: string): { mahal?: string; code?: string } => {
  const t = (text || '').trim();
  if (!t) return {};
  if (t.includes('::')) {
    const [mahal, code] = t.split('::');
    return { mahal: mahal?.trim().toUpperCase(), code: code?.trim().toUpperCase() };
  }
  if (/^TRF-/i.test(t)) return { code: t.toUpperCase() };
  return { mahal: t.toUpperCase() };
};

/** Okutulan/girilen metin bu transferin paket koduyla eşleşiyor mu? */
export const matchesTransferCode = (text: string, tr: Pick<SarfTransfer, 'mahalKodu' | 'code'>) => {
  const { code, mahal } = parseSarfQr(text);
  if (code) {
    if (code !== tr.code.toUpperCase()) return false;
    // Payload mahal de içeriyorsa ikisi birden doğrulanır.
    if (mahal && tr.mahalKodu) return mahal === tr.mahalKodu.toUpperCase();
    return true;
  }
  return false;
};

/** Okutulan/girilen metin bu transferin mahal koduyla eşleşiyor mu? */
export const matchesMahal = (text: string, tr: Pick<SarfTransfer, 'mahalKodu'>) => {
  if (!tr.mahalKodu) return false;
  const target = tr.mahalKodu.toUpperCase();
  const { mahal } = parseSarfQr(text);
  return (mahal || (text || '').trim().toUpperCase()) === target;
};

/** Labın QR/teslimatta kullanılacak mahal kodu (geriye dönük: kod alanına düşer). */
export const hospitalMahalKodu = (h: Partial<Hospital> | null | undefined) =>
  (h?.mahalKodu || h?.kod || '').toString().trim().toUpperCase();

export const toDateSafe = (v: TimestampLike | undefined | null): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const p2 = (n: number) => String(n).padStart(2, '0');

/** dd.MM.yyyy · HH:mm */
export const formatSarfStamp = (v: TimestampLike | undefined | null): string => {
  const d = toDateSafe(v);
  if (!d) return '—';
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** dd.MM.yyyy */
export const formatSarfDate = (v: TimestampLike | undefined | null): string => {
  const d = toDateSafe(v);
  if (!d) return '—';
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export interface CreateSarfTransferInput {
  hospital: Hospital;
  items: SarfTransferItem[];
  depotId?: string | null;
  depotName?: string | null;
  companyId: string;
  user: { uid?: string | null; name?: string | null };
}

/** Yeni transferi 'pending' olarak oluşturur; oluşturulan kaydı döner. */
export async function createSarfTransfer(input: CreateSarfTransferInput): Promise<SarfTransfer> {
  const id = generateId();
  const code = genSarfTransferCode();
  const mahalKodu = hospitalMahalKodu(input.hospital);
  const total = input.items.reduce((a, b) => a + (b.adet || 0), 0);

  const data = withCompanyScope({
    id,
    code,
    hospitalId: input.hospital.id,
    kurumAdi: input.hospital.name,
    mahalKodu,
    items: input.items,
    total,
    status: 'pending' as const,
    depotId: input.depotId ?? null,
    depotName: input.depotName ?? null,
    createdAt: serverTimestamp(),
    createdBy: input.user.name || '',
    createdById: input.user.uid || '',
  }, input.companyId);

  await setDoc(doc(db, 'sarfTransfers', id), data);
  return { ...(data as unknown as SarfTransfer), createdAt: new Date() };
}

/** Sarf dağıtım personeli paketi üzerine alır. */
export async function receiveSarfTransfer(transferId: string, user: { uid?: string | null; name?: string | null }) {
  await updateDoc(doc(db, 'sarfTransfers', transferId), {
    receivedAt: serverTimestamp(),
    receivedBy: user.name || '',
    receivedById: user.uid || '',
  });
}

export interface ConfirmSarfDeliveryInput {
  transfer: SarfTransfer;
  companyId: string;
  isSuperAdmin: boolean;
  user: { uid?: string | null; name?: string | null };
}

/**
 * Teslimatı tamamlar: her kalem için depodan FEFO sırasıyla stok ayırır,
 * ayrılan ürünleri sevk edilmiş (mahal stoğu) olarak işaretler ve transferi
 * 'delivered' durumuna çeker. Yetersiz stokta hata fırlatır (hiçbir yazma yapılmaz).
 */
export async function confirmSarfDelivery({ transfer, companyId, isSuperAdmin, user }: ConfirmSarfDeliveryInput) {
  const allToShip: DepoStokItem[] = [];

  for (const item of transfer.items || []) {
    if (!item.stokKodu || !item.adet) continue;
    const constraints = [
      where('stokKodu', '==', item.stokKodu),
      where('isShipped', '==', false),
      ...(transfer.depotId ? [where('depotId', '==', transfer.depotId)] : []),
    ];
    const snap = await getDocs(scopedQuery('depoStok', companyId, isSuperAdmin, ...constraints));
    const available = filterByCompanyScope(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem)),
      companyId,
      isSuperAdmin,
    ).sort((a, b) => {
      try {
        return compareAsc(
          parse(String(a.miad), 'dd.MM.yyyy', new Date()),
          parse(String(b.miad), 'dd.MM.yyyy', new Date()),
        );
      } catch { return 0; }
    });

    if (available.length < item.adet) {
      throw new Error(`${item.stokAdi} için depoda yeterli stok yok (mevcut: ${available.length}, istenen: ${item.adet}).`);
    }
    allToShip.push(...available.slice(0, item.adet));
  }

  // Firestore batch limiti 500 — 450'lik parçalara böl.
  const BATCH_LIMIT = 450;
  const batches = [];
  let current = writeBatch(db);
  let ops = 0;
  const push = () => {
    ops++;
    if (ops >= BATCH_LIMIT) {
      batches.push(current);
      current = writeBatch(db);
      ops = 0;
    }
  };

  allToShip.filter((s) => s.id).forEach((stockItem) => {
    current.update(doc(db, 'depoStok', stockItem.id), {
      isShipped: true,
      hedefKurum: transfer.kurumAdi,
      hedefKurumId: transfer.hospitalId,
      sevkTarihi: serverTimestamp(),
      transferId: transfer.code,
    });
    push();
  });

  current.update(doc(db, 'sarfTransfers', transfer.id), {
    status: 'delivered',
    deliveredAt: serverTimestamp(),
    deliveredBy: user.name || '',
    deliveredById: user.uid || '',
  });
  push();
  batches.push(current);

  for (const b of batches) {
    await b.commit();
  }
}

/**
 * Paket etiketi yazdır: QR (mahal::kod) + transfer bilgileri.
 * jsPDF ve qrcode yalnızca burada lazy yüklenir.
 */
export async function printSarfTransferLabel(tr: SarfTransfer) {
  const [{ default: jsPDF }, { default: QRCodeLib }] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const qrDataUrl = await QRCodeLib.toDataURL(sarfQrPayload(tr), { margin: 1, width: 480 });

  const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('SARF TRANSFER', 50, 10, { align: 'center' });

  pdf.addImage(qrDataUrl, 'PNG', 27, 14, 46, 46);

  pdf.setFontSize(13);
  pdf.text(tr.code, 50, 66, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  const kurum = (tr.kurumAdi || '').slice(0, 40);
  pdf.text(kurum, 50, 73, { align: 'center' });
  pdf.text(`Mahal: ${tr.mahalKodu}`, 50, 79, { align: 'center' });
  pdf.text(`Toplam: ${tr.total} adet  ·  ${formatSarfStamp(tr.createdAt)}`, 50, 85, { align: 'center' });

  pdf.setFontSize(8);
  const itemsLine = (tr.items || []).map((i) => `${i.stokAdi} x${i.adet}`).join('  ·  ');
  const wrapped = pdf.splitTextToSize(itemsLine, 90) as string[];
  pdf.text(wrapped.slice(0, 2), 50, 91, { align: 'center' });

  pdf.autoPrint();
  window.open(pdf.output('bloburl'), '_blank');
}
