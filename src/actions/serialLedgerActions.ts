'use server';

/**
 * Seri No Defteri — sunucu tarafı sorgular ve geriye dönük doldurma (backfill).
 *
 * Defter, `ürün kodu + seri no` başına tek satır tutar. Bu dosya:
 *  - defteri MEVCUT verilerden (depo stoğu, laboratuvar stoğu, transferler,
 *    tüketim kayıtları, eski `serialHistory`) yeniden inşa eder,
 *  - bir birimin geçmişini tek çağrıda döndürür.
 *
 * Geriye dönük doldurma İDEMPOTENT'tir: aynı olay için deterministik olay
 * belge kimliği kullanılır, tekrar çalıştırmak mükerrer satır üretmez.
 */

import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCompanyId } from '@/lib/company-scope';
import { isAvailableDepotStock } from '@/lib/stock-quantity';
import {
  buildSerialLedgerId,
  isTrackableSerial,
  normalizeLegacyEventType,
  statusForEvent,
  type SerialEventType,
  type SerialLedgerStatus,
  type SerialLocationType,
} from '@/lib/serial-ledger/core';

const LEDGER = 'serialLedger';
const BATCH_LIMIT = 400;

export interface SerialLedgerBackfillResult {
  scannedDepotStock: number;
  scannedTransfers: number;
  scannedConsumptions: number;
  scannedCountDeductions: number;
  ledgerRows: number;
  ledgerEvents: number;
  /** Sayımla düşülüp yeniden işlem görebilir hâle gelen birim sayısı. */
  freedByCount: number;
}

interface DraftEvent {
  type: SerialEventType;
  millis: number;
  /** Deterministik olay kimliği — tekrar çalıştırmada mükerrer üretmez. */
  eventId: string;
  locationType: SerialLocationType;
  locationId: string;
  locationName: string;
  fromType: SerialLocationType;
  fromId: string;
  fromName: string;
  refs: Record<string, string>;
  details: Record<string, unknown>;
}

interface DraftUnit {
  companyId: string;
  stokKodu: string;
  stokAdi: string;
  seriNumarasi: string;
  lotNumarasi: string;
  miad: string;
  events: DraftEvent[];
  /** Bu birimi hâlâ temsil eden canlı bir `depoStok` belgesi var mı? */
  hasLiveStock: boolean;
}

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: any): string => (value === null || value === undefined ? '' : String(value));

/** Firestore belge kimliği için güvenli, kısa bir özet. */
function safeEventId(parts: Array<string | number>): string {
  return parts
    .map(p => String(p).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60))
    .join('-')
    .slice(0, 300);
}

async function requireAdmin(idToken: string) {
  const decoded = await adminAuth.verifyIdToken(idToken);
  const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
  const userData = userSnap.data() as Record<string, any> | undefined;
  const role = str(decoded.role ?? userData?.role);
  const allowed = new Set(['admin', 'super_admin', 'admin_developer']);
  if (!allowed.has(role)) throw new Error('Bu işlem için yönetici yetkisi gereklidir.');
  return {
    uid: decoded.uid,
    isSuperAdmin: role === 'super_admin' || role === 'admin_developer',
    companyId: normalizeCompanyId(str(decoded.companyId ?? userData?.companyId)),
  };
}

/**
 * Şirketin tüm seri numaralı birimlerini mevcut kayıtlardan yeniden inşa eder.
 *
 * Kaynak öncelik sırası ZAMAN'dır: en yeni olay birimin güncel durumunu belirler.
 * Bu, kullanıcının tarif ettiği akışın birebir karşılığıdır:
 *   mal kabul → transfer/sipariş karşılama → tüketim
 * ve depo sayımıyla düşülen birim `serbest` olur, yeniden işlem görebilir.
 */
export async function backfillSerialLedger(params: {
  idToken: string;
  /** Yalnızca bu şirket için çalıştır. Verilmezse çağıranın şirketi. */
  companyId?: string;
  /** true ise hiçbir şey yazılmaz, yalnızca sayılar döner. */
  dryRun?: boolean;
}): Promise<SerialLedgerBackfillResult> {
  const { idToken, dryRun = false } = params;
  const caller = await requireAdmin(idToken);
  const targetCompanyId = normalizeCompanyId(params.companyId || caller.companyId);
  if (!caller.isSuperAdmin && targetCompanyId !== caller.companyId) {
    throw new Error('Başka bir şirket için çalıştırılamaz.');
  }

  const units = new Map<string, DraftUnit>();
  const result: SerialLedgerBackfillResult = {
    scannedDepotStock: 0,
    scannedTransfers: 0,
    scannedConsumptions: 0,
    scannedCountDeductions: 0,
    ledgerRows: 0,
    ledgerEvents: 0,
    freedByCount: 0,
  };

  const unitFor = (data: {
    stokKodu: string;
    seriNumarasi: string;
    stokAdi?: string;
    lotNumarasi?: string;
    miad?: string;
  }): DraftUnit | null => {
    const stokKodu = data.stokKodu.trim();
    const serial = data.seriNumarasi.trim();
    if (!stokKodu || !isTrackableSerial(serial)) return null;
    const key = `${stokKodu}\u0000${serial}`;
    let unit = units.get(key);
    if (!unit) {
      unit = {
        companyId: targetCompanyId,
        stokKodu,
        seriNumarasi: serial,
        stokAdi: data.stokAdi || stokKodu,
        lotNumarasi: data.lotNumarasi || '',
        miad: data.miad || '',
        events: [],
        hasLiveStock: false,
      };
      units.set(key, unit);
    }
    // Boş alanları sonradan gelen daha zengin kayıtlarla tamamla.
    if (!unit.lotNumarasi && data.lotNumarasi) unit.lotNumarasi = data.lotNumarasi;
    if (!unit.miad && data.miad) unit.miad = data.miad;
    if ((!unit.stokAdi || unit.stokAdi === stokKodu) && data.stokAdi) unit.stokAdi = data.stokAdi;
    return unit;
  };

  // ── 1) depoStok: birimin bugünkü fiziksel konumu ───────────────────────────
  const stockSnap = await adminDb.collection('depoStok').where('companyId', '==', targetCompanyId).get();
  for (const docSnap of stockSnap.docs) {
    const data = docSnap.data();
    const unit = unitFor({
      stokKodu: str(data.stokKodu),
      seriNumarasi: str(data.seriNumarasi),
      stokAdi: str(data.stokAdi),
      lotNumarasi: str(data.lotNumarasi),
      miad: str(data.miad),
    });
    if (!unit) continue;
    result.scannedDepotStock += 1;
    unit.hasLiveStock = true;

    const shipped = data.isShipped === true;
    const millis = toMillis(shipped ? data.sevkTarihi : data.eklenmeTarihi) || toMillis(data.eklenmeTarihi);
    unit.events.push({
      type: shipped ? 'transfer' : 'mal_kabul',
      millis,
      eventId: safeEventId(['stock', docSnap.id]),
      locationType: shipped ? 'lab' : 'depot',
      locationId: shipped ? str(data.hedefKurumId) : str(data.depotId),
      locationName: shipped ? str(data.hedefKurum) : str(data.depotName),
      fromType: shipped ? 'depot' : 'none',
      fromId: shipped ? str(data.sourceDepotId) : '',
      fromName: shipped ? str(data.sourceDepotName) : '',
      refs: { depoStokId: docSnap.id, ...(data.transferId ? { transferId: str(data.transferId) } : {}) },
      details: {
        kaynak: 'depoStok',
        rafAdresi: str(data.rafAdresi),
        irsaliyeNumarasi: str(data.irsaliyeNumarasi),
        mevcut: isAvailableDepotStock(data),
      },
    });
  }

  // ── 2) transfers/items: geçmiş hareketler ──────────────────────────────────
  const transferSnap = await adminDb.collection('transfers').where('companyId', '==', targetCompanyId).get();
  await Promise.all(
    transferSnap.docs.map(async transferDoc => {
      const transfer = transferDoc.data();
      const millis = toMillis(transfer.timestamp);
      const itemsSnap = await transferDoc.ref.collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        const unit = unitFor({
          stokKodu: str(item.stokKodu),
          seriNumarasi: str(item.seriNumarasi),
          stokAdi: str(item.stokAdi),
          lotNumarasi: str(item.lotNumarasi),
          miad: str(item.miad),
        });
        if (!unit) continue;
        result.scannedTransfers += 1;
        unit.events.push({
          type: transfer.mode === 'borc' ? 'borc' : 'transfer',
          millis,
          eventId: safeEventId(['transfer', transferDoc.id, itemDoc.id]),
          locationType: transfer.mode === 'borc' ? 'borc' : 'lab',
          locationId: str(transfer.targetHospitalId),
          locationName: str(transfer.targetName),
          fromType: 'depot',
          fromId: str(transfer.sourceDepotId),
          fromName: str(transfer.sourceDepotName),
          refs: { transferId: transferDoc.id },
          details: { kaynak: 'transfers', adet: Number(item.adet) || 1 },
        });
      }
    }),
  );

  // ── 3) tuketimKayitlari: tüketim ───────────────────────────────────────────
  const consumptionSnap = await adminDb
    .collection('tuketimKayitlari')
    .where('companyId', '==', targetCompanyId)
    .get();
  for (const docSnap of consumptionSnap.docs) {
    const data = docSnap.data();
    const unit = unitFor({
      stokKodu: str(data.stokKodu),
      seriNumarasi: str(data.seriNumarasi),
      stokAdi: str(data.stokAdi),
      lotNumarasi: str(data.lotNumarasi),
      miad: str(data.miad),
    });
    if (!unit) continue;
    result.scannedConsumptions += 1;
    unit.events.push({
      type: 'tuketim',
      millis: toMillis(data.consumptionTimestamp),
      eventId: safeEventId(['consumption', docSnap.id]),
      locationType: 'none',
      locationId: '',
      locationName: '',
      fromType: 'lab',
      fromId: str(data.deductedFromLabId || data.laboratoryId),
      fromName: str(data.deductedFromLabName || data.laboratoryName),
      refs: { consumptionId: docSnap.id },
      details: { kaynak: 'tuketimKayitlari', usageLabId: str(data.usageLabId || data.laboratoryId) },
    });
  }

  // ── 4) depotBrandCountSessions/items: sayımla düşülen seriler ──────────────
  // Bu adım kritiktir: sayımla düşülen birim `serbest` olur ve TÜM işlemleri
  // yeniden görebilir. Eski sistemde bu olay hiç kaydedilemediği için bu
  // birimler kalıcı olarak bloke kalmıştı.
  const sessionSnap = await adminDb
    .collection('depotBrandCountSessions')
    .where('companyId', '==', targetCompanyId)
    .get();
  await Promise.all(
    sessionSnap.docs.map(async sessionDoc => {
      const session = sessionDoc.data();
      const millis = toMillis(session.closedAt || session.startedAt);
      const itemsSnap = await sessionDoc.ref.collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        const deleted: string[] = Array.isArray(item.deletedSerials) ? item.deletedSerials : [];
        for (const serial of deleted) {
          const unit = unitFor({
            stokKodu: str(item.stokKodu),
            seriNumarasi: str(serial),
            stokAdi: str(item.stokAdi),
          });
          if (!unit) continue;
          result.scannedCountDeductions += 1;
          unit.events.push({
            type: 'sayim_dusum',
            millis,
            eventId: safeEventId(['count', sessionDoc.id, itemDoc.id, serial]),
            locationType: 'none',
            locationId: '',
            locationName: '',
            fromType: 'depot',
            fromId: str(session.depotId),
            fromName: str(session.depotName),
            refs: { countSessionId: sessionDoc.id },
            details: { kaynak: 'depotBrandCountSessions', depotName: str(session.depotName) },
          });
        }
      }
    }),
  );

  // ── 5) Eski serialHistory olayları ─────────────────────────────────────────
  // `serialHistory/{seriNo}` üst belgeleri çoğu zaman boştur; olaylar yalnızca
  // alt-koleksiyonda yaşar. Koleksiyon grubu sorgusu bunları toplar. Bu
  // olaylarda `companyId` bulunmadığı için ürün kodu eşleşmesiyle, YALNIZCA
  // yukarıdaki kaynaklardan zaten bilinen birimlere iliştirilir.
  try {
    const historySnap = await adminDb.collectionGroup('events').get();
    for (const docSnap of historySnap.docs) {
      // Yalnızca serialHistory altındaki olaylar: yol `serialHistory/{seri}/events/{id}`
      const segments = docSnap.ref.path.split('/');
      if (segments[0] !== 'serialHistory' || segments.length !== 4) continue;
      const serial = segments[1];
      const data = docSnap.data();
      const type = normalizeLegacyEventType(str(data.type));
      if (!type) continue;
      const details = (data.details || {}) as Record<string, any>;
      const stokKodu = str(details.stokKodu);
      if (!stokKodu) continue;
      const key = `${stokKodu}\u0000${serial}`;
      const unit = units.get(key);
      // Bilinmeyen birim: başka bir şirkete ait olabilir, atlanır.
      if (!unit) continue;
      unit.events.push({
        type,
        millis: toMillis(data.timestamp),
        eventId: safeEventId(['history', serial, docSnap.id]),
        locationType:
          type === 'transfer' || type === 'lab_transfer' || type === 'siparis_karsilama'
            ? 'lab'
            : type === 'mal_kabul'
              ? 'depot'
              : 'none',
        locationId: str(details.targetHospitalId || details.targetLabId || details.depotId),
        locationName: str(details.targetName || details.targetLabName || details.depotName),
        fromType: type === 'mal_kabul' ? 'none' : 'depot',
        fromId: str(details.sourceDepotId || details.sourceLabId),
        fromName: str(details.sourceDepotName || details.sourceLabName),
        refs: { ...(data.transferId ? { transferId: str(data.transferId) } : {}) },
        details: { kaynak: 'serialHistory' },
      });
    }
  } catch {
    // `events` koleksiyon grubu sorgusu indeks gerektirebilir; eski geçmiş
    // olmadan da defter diğer dört kaynaktan doğru şekilde kurulur.
  }

  // ── 6) Yazım ───────────────────────────────────────────────────────────────
  const writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];

  units.forEach(unit => {
    if (unit.events.length === 0) return;
    // Zamana göre sırala; zaman damgası olmayan olaylar en başa düşer ki
    // gerçek zamanlı olaylar son durumu belirlesin.
    const ordered = [...unit.events].sort((a, b) => a.millis - b.millis);
    const last = ordered[ordered.length - 1];
    let status: SerialLedgerStatus = statusForEvent(last.type) ?? 'depoda';

    // Geçmiş "stokta" diyor ama birimi temsil eden CANLI bir depoStok belgesi
    // yok → birim sistemden fiilen çıkmış demektir (çoğunlukla eski bir depo
    // sayımı silmiştir; o sayımlar `deletedSerials` ayrıntısını tutmuyordu).
    // Böyle birimler `serbest` sayılır: aynı seri numarası yeniden mal kabul
    // edilebilir, transfer edilebilir ve tüketilebilir. `tuketildi` / `imha` /
    // `borc` durumları bilinçli çıkışlardır; onlara dokunulmaz.
    if (!unit.hasLiveStock && (status === 'depoda' || status === 'laboratuvarda')) {
      status = 'serbest';
    }

    if (status === 'serbest') result.freedByCount += 1;

    const ledgerId = buildSerialLedgerId(targetCompanyId, unit.stokKodu, unit.seriNumarasi);
    writes.push({
      path: `${LEDGER}/${ledgerId}`,
      merge: true,
      data: {
        id: ledgerId,
        companyId: targetCompanyId,
        stokKodu: unit.stokKodu,
        stokAdi: unit.stokAdi,
        seriNumarasi: unit.seriNumarasi,
        lotNumarasi: unit.lotNumarasi,
        miad: unit.miad,
        status,
        locationType: status === 'serbest' ? 'none' : last.locationType,
        locationId: status === 'serbest' ? '' : last.locationId,
        locationName: status === 'serbest' ? '' : last.locationName,
        lastEventType: last.type,
        lastEventAt: new Date(last.millis || Date.now()),
        firstEventAt: new Date(ordered[0].millis || Date.now()),
        eventCount: ordered.length,
        backfilledAt: FieldValue.serverTimestamp(),
      },
    });
    result.ledgerRows += 1;

    ordered.forEach(event => {
      writes.push({
        path: `${LEDGER}/${ledgerId}/events/${event.eventId}`,
        merge: true,
        data: {
          companyId: targetCompanyId,
          ledgerId,
          type: event.type,
          stokKodu: unit.stokKodu,
          stokAdi: unit.stokAdi,
          seriNumarasi: unit.seriNumarasi,
          lotNumarasi: unit.lotNumarasi,
          miad: unit.miad,
          fromType: event.fromType,
          fromId: event.fromId,
          fromName: event.fromName,
          toType: event.locationType,
          toId: event.locationId,
          toName: event.locationName,
          refs: event.refs,
          actorUid: null,
          actorName: null,
          details: { ...event.details, backfill: true },
          timestamp: new Date(event.millis || Date.now()),
        },
      });
      result.ledgerEvents += 1;
    });
  });

  if (!dryRun) {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = adminDb.batch();
      writes.slice(i, i + BATCH_LIMIT).forEach(write => {
        batch.set(adminDb.doc(write.path), write.data, { merge: write.merge });
      });
      await batch.commit();
    }
  }

  return result;
}

export interface SerialLedgerLookupRow {
  id: string;
  stokKodu: string;
  stokAdi: string;
  seriNumarasi: string;
  lotNumarasi: string;
  miad: string;
  status: string;
  locationType: string;
  locationId: string;
  locationName: string;
  lastEventType: string;
  lastEventAt: Date | null;
  events: Array<{
    id: string;
    type: string;
    timestamp: Date | null;
    fromName: string;
    toName: string;
    actorName: string | null;
    details: Record<string, unknown>;
  }>;
}

/**
 * Bir seri numarasının defterdeki tüm satırlarını ve olay geçmişini döndürür.
 *
 * Barkod okutulduğunda "bu ürün geçmişte işlem gördü mü, şu an nerede" sorusu
 * TEK bu kaynaktan cevaplanır.
 */
export async function lookupSerialLedger(params: {
  idToken: string;
  seriNumarasi: string;
  stokKodu?: string;
  eventLimit?: number;
}): Promise<SerialLedgerLookupRow[]> {
  const { idToken, seriNumarasi, stokKodu, eventLimit = 50 } = params;
  const serial = (seriNumarasi || '').trim();
  if (!isTrackableSerial(serial)) return [];

  const decoded = await adminAuth.verifyIdToken(idToken);
  const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
  const userData = userSnap.data() as Record<string, any> | undefined;
  const role = str(decoded.role ?? userData?.role);
  const isSuperAdmin = role === 'super_admin' || role === 'admin_developer';
  const companyId = normalizeCompanyId(str(decoded.companyId ?? userData?.companyId));

  let queryRef: FirebaseFirestore.Query = adminDb.collection(LEDGER).where('seriNumarasi', '==', serial);
  if (!isSuperAdmin) queryRef = queryRef.where('companyId', '==', companyId);
  if (stokKodu) queryRef = queryRef.where('stokKodu', '==', stokKodu);

  const snap = await queryRef.get();

  return Promise.all(
    snap.docs.map(async docSnap => {
      const data = docSnap.data();
      const eventsSnap = await docSnap.ref
        .collection('events')
        .orderBy('timestamp', 'desc')
        .limit(eventLimit)
        .get();
      return {
        id: docSnap.id,
        stokKodu: str(data.stokKodu),
        stokAdi: str(data.stokAdi),
        seriNumarasi: str(data.seriNumarasi),
        lotNumarasi: str(data.lotNumarasi),
        miad: str(data.miad),
        status: str(data.status),
        locationType: str(data.locationType),
        locationId: str(data.locationId),
        locationName: str(data.locationName),
        lastEventType: str(data.lastEventType),
        lastEventAt: data.lastEventAt?.toDate?.() ?? null,
        events: eventsSnap.docs.map(eventDoc => {
          const event = eventDoc.data();
          return {
            id: eventDoc.id,
            type: str(event.type),
            timestamp: event.timestamp?.toDate?.() ?? null,
            fromName: str(event.fromName),
            toName: str(event.toName),
            actorName: event.actorName ? str(event.actorName) : null,
            details: (event.details || {}) as Record<string, unknown>,
          };
        }),
      };
    }),
  );
}
