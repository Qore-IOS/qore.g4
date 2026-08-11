/**
 * @fileoverview Mal kabul yazma katmanı — TEK KAYNAK.
 *
 * Bu modül, bir mal kabul satırının Firestore'a nasıl yazılacağını tanımlar:
 * `depoStok` belgesi, `serialHistory` olayı ve Seri No Defteri kaydı.
 *
 * NEDEN AYRI BİR MODÜL:
 * Bu mantık daha önce yalnızca `src/components/ana-panel.tsx` içinde yaşıyordu
 * ve orada bile iki ayrı kopyası vardı (manuel kabul kuyruğu ve Oto Kabul
 * worker'ı). Masaüstü terminali (`/terminal/mal-kabul`) aynı koleksiyonlara
 * yazdığı için üçüncü bir kopya, şemanın sessizce ayrışması demekti: bir yolda
 * yazılıp diğerinde yazılmayan tek bir defter kaydı, aylar sonra sayımda
 * "stok var ama geçmişi yok" olarak ortaya çıkar.
 *
 * Bu yüzden belge gövdesini üreten ve batch'e yazan fonksiyonlar burada,
 * çağıranların ortak kullanımındadır. Bir alan eklenecekse TEK yer burasıdır.
 */

import {
  Timestamp,
  collection,
  doc,
  writeBatch,
  type WriteBatch,
  type DocumentReference,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { appendSerialEventToBatch } from '@/lib/serial-ledger/client';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';
import { sanitizeFsId } from '@/lib/sync/idle-scheduler';
import { generateId } from '@/lib/utils';
import { commitLocalFirst, queueWrite, type CommitOutcome } from '@/lib/offline-write';
import type { MalKabulHeader, MalKabulLine, VerificationMode } from './types';

/**
 * Yazma katmanının bir kabul satırından ihtiyaç duyduğu ASGARİ alanlar.
 *
 * Bilerek `ScanRow`'dan (./types) daha dar tutuldu: `ana-panel.tsx` kendi
 * genişletilmiş satır tipini kullanıyor (Oto Kabul senkron alanları, bulk QR
 * bayrağı vb.) ve `isProcessed` orada opsiyonel. İki tarafı da kabul eden
 * yapısal bir tip olmadan, ortak yazma katmanı çağıranlardan birini tip
 * hatasına düşürürdü. Buradaki alanlar Firestore belgesine gerçekten yazılan
 * alanlardır; fazlası istenmez.
 */
export interface MalKabulWriteRow {
  id: string;
  /**
   * Metin alanlarının hepsi opsiyoneldir: kabul listesine bir satır ürün
   * çözümlenmeden de girebilir (elle eklenen lot satırı, OCR taslağı). Yazma
   * anında hepsi `|| ''` ile normalize edilir.
   */
  stokKodu?: string;
  stokAdi?: string;
  lotNumarasi?: string;
  miad?: string;
  seriNumarasi?: string;
  rafAdresi?: string;
  irsaliyeNumarasi?: string;
  /**
   * `unknown`, çünkü çağıranlar bu alana `Date`, ISO metin ya da Firestore
   * `Timestamp` koyabiliyor. `toFsTimestamp()` Date olmayan her değeri "şimdi"
   * kabul eder — çıkarılmadan önceki davranışın aynısı.
   */
  timestamp?: unknown;
  /** Lot/adet satırlarında taşınan adet; seri numaralı satırlarda 1. */
  adet?: number;
  /** Satır bir lot/adet grubunu mu temsil ediyor? */
  isGroup?: boolean;
  /** Grup satırında okutulmuş seri numaraları. */
  scannedSerials?: string[];
}

/**
 * Firestore tek bir `writeBatch` içinde en fazla 500 işlem kabul eder.
 * Seri numaralı bir satır 4 işlem üretir (depoStok + serialHistory + defter
 * satırı + defter olayı), bu yüzden parti boyu 100 satırda tutulur: en kötü
 * durumda 400 işlem + işlem başlığı/satırları hâlâ limitin altında kalır.
 */
export const MAL_KABUL_BATCH_ROWS = 100;

/** Bir `depoStok` belgesinin hangi bağlamda oluşturulduğu. */
export type DepoStokDocContext = {
  depotId: string;
  depotName: string;
  createdByName: string;
  createdByUid: string | null;
};

/**
 * Firestore `undefined` kabul etmez; iç içe nesnelerden bu değerleri ayıklar.
 */
export function stripUndefined(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(stripUndefined).filter(v => v !== undefined);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(val).forEach(k => {
      const v = stripUndefined((val as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return val === undefined ? undefined : val;
}

/** Geçersiz/eksik tarihlerde `now`'a düşen güvenli Timestamp dönüşümü. */
export function toFsTimestamp(d?: Date | unknown): Timestamp {
  if (d instanceof Date && !isNaN(d.getTime())) return Timestamp.fromDate(d);
  return Timestamp.now();
}

/**
 * Tek bir `depoStok` belgesinin gövdesini üretir.
 *
 * `companyId` BİLEREK burada eklenmez — çağıran taraf `withCompanyScope()` ile
 * ekler, çünkü kiracı kimliği oturumdan gelir ve bu fonksiyon saf kalmalıdır.
 */
export function buildDepoStokDocData(item: MalKabulWriteRow, serial: string, ctx: DepoStokDocContext) {
  return {
    depotId: ctx.depotId,
    depotName: ctx.depotName,
    stokKodu: item.stokKodu || '',
    stokAdi: item.stokAdi || '',
    lotNumarasi: item.lotNumarasi || '',
    miad: item.miad ? normalizeMiad(item.miad) : '',
    seriNumarasi: serial,
    rafAdresi: item.rafAdresi || '',
    irsaliyeNumarasi: item.irsaliyeNumarasi || '',
    eklenmeTarihi: toFsTimestamp(item.timestamp),
    isShipped: false,
    createdByName: ctx.createdByName,
    createdByUid: ctx.createdByUid,
  };
}

/** Bir kabul listesindeki tüm `ürün kodu + seri no` çiftlerini toplar. */
export function collectSerialPairs(rows: MalKabulWriteRow[]): Array<{ serial: string; stokKodu: string }> {
  const pairs: Array<{ serial: string; stokKodu: string }> = [];
  rows.forEach(item => {
    if (!item.stokKodu) return;
    if (!item.isGroup && item.seriNumarasi) {
      pairs.push({ serial: item.seriNumarasi, stokKodu: item.stokKodu });
    } else if (item.isGroup && item.scannedSerials) {
      item.scannedSerials.forEach(s => {
        if (s) pairs.push({ serial: s, stokKodu: item.stokKodu });
      });
    }
  });
  return pairs;
}

/**
 * Aynı ürün+lot+miad satırlarını işlem satırlarına indirger.
 *
 * Grup (lot/adet) satırlarının `scannedSerials` değerleri BİLEREK dışarıda
 * bırakılır — bu, `ana-panel.tsx`'in çıkarılmadan önceki davranışıdır ve
 * mal kabul geçmişi ekranı bu varsayıma göre okur. Değiştirilecekse iki
 * çağıran da birlikte gözden geçirilmelidir.
 */
export function buildTransactionLines(rows: MalKabulWriteRow[]): MalKabulLine[] {
  const lineMap = new Map<string, MalKabulLine>();

  for (const row of rows) {
    const key = `${row.stokKodu}||${row.lotNumarasi || ''}||${row.miad || ''}`;

    if (!lineMap.has(key)) {
      lineMap.set(key, {
        stokKodu: row.stokKodu || '',
        stokAdi: row.stokAdi || '',
        lotNumarasi: row.lotNumarasi || '',
        miad: row.miad || '',
        adet: 0,
        serials: [],
      });
    }

    const entry = lineMap.get(key)!;
    entry.adet += row.adet || 1;
    if (!row.isGroup && row.seriNumarasi) entry.serials.push(row.seriNumarasi);
  }

  return Array.from(lineMap.values()).map(line => ({
    ...line,
    serials: Array.from(new Set(line.serials || [])).filter(Boolean),
  }));
}

/**
 * Bir seri numarası için depoStok + serialHistory + Seri No Defteri yazımlarını
 * verilen batch'e ekler.
 *
 * `depoStokRef` çağıran tarafından verilir: manuel kabul rastgele kimlik
 * kullanır, Oto Kabul ise yeniden denemede çift kayıt oluşmasın diye
 * deterministik kimlik üretir. Belge GÖVDESİ her iki yolda da aynıdır.
 */
export function applySerialIntakeWrites(
  batch: WriteBatch,
  params: {
    item: MalKabulWriteRow;
    serial: string;
    depoStokRef: DocumentReference;
    ctx: DepoStokDocContext;
    companyId: string | null | undefined;
    /** Defter olayına eklenecek serbest alanlar (ör. `mode: 'oto_kabul'`). */
    extraLedgerDetails?: Record<string, unknown>;
  },
): void {
  const { item, serial, depoStokRef, ctx, companyId, extraLedgerDetails } = params;

  batch.set(
    depoStokRef,
    withCompanyScope({ ...buildDepoStokDocData(item, serial, ctx), adet: 1 }, companyId),
  );

  const histRef = doc(collection(db, `serialHistory/${serial}/events`));
  batch.set(histRef, {
    type: 'intake',
    details: {
      stokKodu: item.stokKodu || '',
      stokAdi: item.stokAdi || '',
      depotId: ctx.depotId,
      depotName: ctx.depotName,
      rafAdresi: item.rafAdresi || '',
      irsaliyeNumarasi: item.irsaliyeNumarasi || '',
    },
    timestamp: Timestamp.now(),
  });

  appendSerialEventToBatch(
    batch,
    {
      type: 'mal_kabul',
      stokKodu: item.stokKodu || '',
      stokAdi: item.stokAdi || '',
      seriNumarasi: serial,
      lotNumarasi: item.lotNumarasi || '',
      miad: item.miad || '',
      location: { locationType: 'depot', locationId: ctx.depotId, locationName: ctx.depotName },
      refs: { depoStokId: depoStokRef.id, irsaliyeNumarasi: item.irsaliyeNumarasi },
      actorUid: ctx.createdByUid,
      actorName: ctx.createdByName,
      details: {
        rafAdresi: item.rafAdresi || '',
        irsaliyeNumarasi: item.irsaliyeNumarasi || '',
        ...(extraLedgerDetails || {}),
      },
    },
    companyId,
  );
}

/** Seri numarası olmayan lot/adet satırı için tek `depoStok` belgesi yazar. */
export function applyGroupIntakeWrite(
  batch: WriteBatch,
  params: {
    item: MalKabulWriteRow;
    depoStokRef: DocumentReference;
    ctx: DepoStokDocContext;
    companyId: string | null | undefined;
  },
): void {
  const { item, depoStokRef, ctx, companyId } = params;
  batch.set(
    depoStokRef,
    withCompanyScope(
      { ...buildDepoStokDocData(item, '', ctx), adet: Math.max(1, item.adet ?? 1) },
      companyId,
    ),
  );
}

export type MalKabulCommitResult = {
  transactionId: string;
  /** Yazılan `depoStok` belge sayısı. */
  writtenDocs: number;
  /** Toplam adet (lot satırlarında `adet` alanı dâhil). */
  totalAdet: number;
  /**
   * Yazımın sunucuya işlenip işlenmediği.
   *
   * `'pending'` bir HATA DEĞİLDİR: kalemler yerel önbellekte, bağlantı
   * gelince kendiliğinden gönderilecek. Arayüz bunu kullanıcıya "senkron
   * bekliyor" olarak göstermeli, "kaydedilemedi" olarak değil.
   */
  outcome: CommitOutcome;
};

/**
 * Uçtan uca mal kabul: satırları stoğa yazar ve `malKabulTransactions`
 * başlığı ile satırlarını oluşturur.
 *
 * Terminal (`/terminal/mal-kabul`) bu fonksiyonu kullanır. `ana-panel.tsx`
 * kendi kuyruk/optimistik UI mantığını koruduğu için yalnızca yukarıdaki
 * `apply*` yardımcılarını çağırır; belge şeması yine ortaktır.
 *
 * NOT: Geçmiş seri kontrolü (Seri No Defteri) çağıranın sorumluluğundadır —
 * `collectSerialPairs()` + `getSerialLedgerEntries()` + `canReceiveSerial()`.
 * Burada yapılmaz çünkü engellenen serinin kullanıcıya nasıl gösterileceği
 * arayüze göre değişir.
 */
export async function commitMalKabul(params: {
  rows: MalKabulWriteRow[];
  ctx: DepoStokDocContext;
  companyId: string | null | undefined;
  mode?: VerificationMode;
  /** Marka çözümleyici; verilmezse başlıkta `brands` boş kalır. */
  resolveBrand?: (stokKodu: string, stokAdi: string) => string;
  /**
   * Sunucu onayı beklensin mi?
   *
   * `'queue'` (terminal): yazımlar kuyruğa alınır ve fonksiyon ANINDA döner.
   * Firestore veriyi yerel önbelleğe senkron uyguladığı için sonuç zaten
   * doğrudur; arayüzün beklemesi için bir sebep yoktur.
   *
   * `'wait'` (varsayılan, web paneli): mevcut davranış korunur.
   */
  sync?: 'wait' | 'queue';
  /**
   * Bekleyen işlemler defterindeki kayıt kimliği.
   *
   * `sync: 'queue'` ile birlikte verilir; yazım sunucuya işlenince kayıt
   * "gönderildi", reddedilirse "başarısız" olarak işaretlenir.
   */
  operationId?: string;
}): Promise<MalKabulCommitResult> {
  const {
    rows,
    ctx,
    companyId,
    mode = 'unverified',
    resolveBrand,
    sync = 'wait',
    operationId,
  } = params;

  const transactionId = `MK-${generateId()}`;
  const txRef = doc(db, 'malKabulTransactions', transactionId);

  let writtenDocs = 0;
  // Partilerden herhangi biri sunucu onayı almadıysa işlemin tamamı
  // "bekliyor" sayılır — kullanıcıya en kötü durumu göstermek doğrusu.
  let outcome: CommitOutcome = 'synced';
  const totalAdet = rows.reduce((n, r) => n + Math.max(1, r.adet ?? 1), 0);

  // 1) Stok yazımı — partiler hâlinde.
  for (let i = 0; i < rows.length; i += MAL_KABUL_BATCH_ROWS) {
    const part = rows.slice(i, i + MAL_KABUL_BATCH_ROWS);
    const batch = writeBatch(db);

    for (const item of part) {
      const serials = (item.isGroup ? item.scannedSerials || [] : [item.seriNumarasi]).filter(
        Boolean,
      ) as string[];

      if (serials.length === 0) {
        applyGroupIntakeWrite(batch, {
          item,
          depoStokRef: doc(collection(db, 'depoStok')),
          ctx,
          companyId,
        });
        writtenDocs += 1;
        continue;
      }

      for (const serial of serials) {
        applySerialIntakeWrites(batch, {
          item,
          serial,
          // Deterministik kimlik: aynı satır yeniden gönderilirse (ağ hatası
          // sonrası tekrar) çift stok kaydı oluşmaz. Satır kimliği de anahtara
          // katılır ki geçmişte transfer edilmiş aynı seri yeniden kabul
          // edildiğinde eski belge ezilmesin.
          depoStokRef: doc(
            db,
            'depoStok',
            `mk-${sanitizeFsId(companyId || 'nc')}-${sanitizeFsId(ctx.depotId)}-${sanitizeFsId(
              item.stokKodu || '',
            )}-${sanitizeFsId(serial)}-${sanitizeFsId(item.id)}`,
          ),
          ctx,
          companyId,
        });
        writtenDocs += 1;
      }
    }

    // `await batch.commit()` DEĞİL: çevrimdışıyken o söz hiç çözülmez ve
    // ekran "Kaydediliyor…" konumunda kilitlenir. Yazım yerel önbelleğe anında
    // uygulanır; sunucu onayı gelmezse işlem kuyrukta beklemeye devam eder.
    if (sync === 'queue') {
      // Defter kimliği burada VERİLMEZ: bu yalnızca stok partilerinden biri.
      // Kayıt, en son yazım (işlem başlığı) onaylanınca güncellenir.
      queueWrite(batch.commit());
      outcome = 'pending';
    } else if ((await commitLocalFirst(batch.commit())) === 'pending') {
      outcome = 'pending';
    }
  }

  // 2) İşlem başlığı ve satırları — stok yazımından SONRA.
  //
  // Sıralama bilinçli: başlık, yazılmamış stok için oluşmasın. Tersi durumda
  // (stok yazıldı, başlık yazılamadı) mal kabul geçmişinde bir kayıt eksik
  // kalır ama stok doğrudur; bu, stoğun eksik kalmasından kat kat iyidir.
  const header: MalKabulHeader = {
    transactionId,
    depotId: ctx.depotId,
    depotName: ctx.depotName,
    userId: ctx.createdByUid || '',
    userName: ctx.createdByName,
    timestamp: Timestamp.now(),
    itemCount: totalAdet,
    brands: resolveBrand
      ? Array.from(
          new Set(rows.map(r => resolveBrand(r.stokKodu || '', r.stokAdi || '')).filter(Boolean)),
        )
      : [],
    mode,
  };

  const lines = buildTransactionLines(rows);
  for (let i = 0; i < Math.max(1, lines.length); i += 400) {
    const batch = writeBatch(db);
    if (i === 0) {
      batch.set(txRef, withCompanyScope(stripUndefined(header) as MalKabulHeader, companyId));
    }
    lines.slice(i, i + 400).forEach(line => {
      batch.set(
        doc(collection(txRef, 'lines')),
        withCompanyScope(
          stripUndefined({
            stokKodu: line.stokKodu,
            stokAdi: line.stokAdi,
            lotNumarasi: line.lotNumarasi || '',
            miad: line.miad || '',
            adet: line.adet ?? 0,
            serials: Array.isArray(line.serials) ? line.serials.filter(Boolean) : [],
          }) as Record<string, unknown>,
          companyId,
        ),
      );
    });
    if (sync === 'queue') {
      // Son yazım: defter kaydı buna bağlanır.
      const isLastBatch = i + 400 >= lines.length;
      queueWrite(batch.commit(), undefined, isLastBatch ? operationId : undefined);
      outcome = 'pending';
    } else if ((await commitLocalFirst(batch.commit())) === 'pending') {
      outcome = 'pending';
    }
  }

  return { transactionId, writtenDocs, totalAdet, outcome };
}
