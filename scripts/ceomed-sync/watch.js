/**
 * Ceomed → Qore SÜREKLİ AÇIK watcher (tek süreç, üç izleyici).
 *
 * Eski kurulum: Windows Task Scheduler her 15 dakikada bir `run-sync.bat`
 * çalıştırıyordu. Her tetiklemede Node yeniden başlıyor, ERP'ye yeniden login
 * oluyor ve tüm tarih aralığını baştan tarıyordu. Gecikme ortalama 7,5 dakika;
 * depo stoğu ise günde yalnızca bir kez tazeleniyordu.
 *
 * Bu süreç sürekli açık kalır ve:
 *   1. irsaliye  — yeni/durumu değişen irsaliyeleri kısa aralıklarla yoklar.
 *                  "KURUMA SEVK EDILDI" olan ve laboratuvarı eşleşen irsaliyenin
 *                  ürünlerini, elle onay beklemeden ilgili LABORATUVAR STOĞUNA
 *                  tüm bilgileriyle yazar.
 *   2. depo      — Ceomed merkez depo listesini yoklar; SADECE gerçekten değişim
 *                  olduğunda `ceomedDepoStok/{depotId}` yazar ve
 *                  `metadata/stockLastUpdated` damgasını günceller (açık olan
 *                  paneller bu damgayla anında tazelenir).
 *   3. sevkiyat  — `ceomedSevkiyatRequests` koleksiyonunu Firestore realtime
 *                  listener ile dinler (yoklama yok, zaten anlık).
 *
 * Qore arayüzü KAPALIYKEN de çalışır: watcher Admin SDK ile doğrudan Firestore'a
 * yazar, tarayıcıya bağımlı değildir.
 *
 * ÖNEMLİ — "anlık" ne demek: Ceomed API'si sorgu tabanlıdır, push/webhook
 * sağlamaz. Bu yüzden 1 ve 2 numaralı izleyiciler yoklama yapar; fark, sürekli
 * açık bir süreçte yoklamanın saniyeler mertebesinde olabilmesidir (soğuk
 * başlatma ve yeniden login maliyeti yok).
 *
 * Çalıştırma:
 *   node watch.js                 (veya run-watch.bat — çökerse yeniden başlatır)
 *
 * Env (.env):
 *   CEOMED_BASE_URL, CEOMED_EPOSTA, CEOMED_PAROLA
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID, CEOMED_COMPANY_ID
 *   CEOMED_WATCH_IRSALIYE_SEC   (varsayılan 60)  irsaliye yoklama aralığı
 *   CEOMED_WATCH_DEPO_SEC       (varsayılan 120) depo stoğu yoklama aralığı
 *   CEOMED_WATCH_LOOKBACK_DAYS  (varsayılan 7)   irsaliye taramasında geriye bakış
 *   CEOMED_AUTO_TRANSFER        (varsayılan 1)   0 ise otomatik lab aktarımı kapalı
 */
const admin = require('firebase-admin');
const { login } = require('./login');
const { fetchIrsaliyeMaster } = require('./fetchIrsaliyeMaster');
const { fetchOkutulanBarkod } = require('./fetchOkutulanBarkod');
const { fetchMerkezDepoListesi, extractDepoStock } = require('./fetchMerkezDepoListesi');
const { matchLab } = require('./lib/labMatcher');
const { buildLabStockDocs, transferIdFor } = require('./lib/stockDocs');

const SEVK_EDILDI = 'KURUMA SEVK EDILDI';
const ALLOWED_STATUSES = [
  'KURUMA SEVK EDILDI',
  'MALZEME TOPLANABILIR',
  'MALZEME HAZIRLAMA DEVAM EDIYOR',
  'IRSALIYE YAZDIRILABILIR',
  'IRSALIYE YAZDIRILDI',
];

const num = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const IRSALIYE_SEC = num(process.env.CEOMED_WATCH_IRSALIYE_SEC, 60);
const DEPO_SEC = num(process.env.CEOMED_WATCH_DEPO_SEC, 120);
const LOOKBACK_DAYS = num(process.env.CEOMED_WATCH_LOOKBACK_DAYS, 7);
const AUTO_TRANSFER = process.env.CEOMED_AUTO_TRANSFER !== '0';

let running = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (tag, msg) => console.log(`[${ts()}] [${tag}] ${msg}`);
const errLog = (tag, msg) => console.error(`[${ts()}] [${tag}] ${msg}`);

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

function requireCompanyId() {
  const companyId = (process.env.CEOMED_COMPANY_ID || '').trim();
  if (!companyId) {
    throw new Error(
      'CEOMED_COMPANY_ID env değişkeni zorunlu — yazılan tüm dokümanlar bu firmaya ' +
        'etiketlenir. Etiketsiz kayıtlar panellerde görünmez.'
    );
  }
  return companyId;
}

function ddMMyyyy(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * ERP oturumu — token paylaşımlı ve tembel yenilenir. Her yoklamada yeniden
 * login olmak ERP'yi gereksiz yorar; token geçersizleşince (401/403) yenilenir.
 */
class Session {
  constructor() {
    this.token = null;
    this.user = null;
    this.at = 0;
  }
  async get(force = false) {
    const yaslandi = Date.now() - this.at > 30 * 60 * 1000;
    if (force || !this.token || yaslandi) {
      const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
      this.token = token;
      this.user = user;
      this.at = Date.now();
      log('oturum', `ERP login OK (ID_USER=${user.ID_USER})`);
    }
    return { token: this.token, user: this.user };
  }
  /** Bir çağrıyı çalıştırır; yetki hatasında token'ı yenileyip bir kez daha dener. */
  async withRetry(fn) {
    const s = await this.get();
    try {
      return await fn(s);
    } catch (e) {
      if (/40[13]|token|yetki/i.test(String(e.message))) {
        const fresh = await this.get(true);
        return fn(fresh);
      }
      throw e;
    }
  }
}

// ───────────────────────── 1) İrsaliye izleyici ─────────────────────────────

/**
 * Bir irsaliyeyi eşleşen laboratuvarın stoğuna yazar.
 *
 * Tümü TEK batch'te işlenir: stok belgeleri + transfer başlığı/satırları +
 * seri defteri olayları + irsaliyenin `autoTransfer` damgası. Böylece yarım
 * kalmış aktarım oluşmaz.
 *
 * Belge kimlikleri deterministiktir; aynı irsaliye yeniden işlenirse mükerrer
 * stok yazılmaz.
 */
async function autoTransferIrsaliye(db, { irsaliyeDoc, hospitals, productsByCode, companyId, sourceDepot }) {
  const irs = irsaliyeDoc.data();
  const ref = irsaliyeDoc.ref;

  // Elle onaylanmış/reddedilmiş ya da zaten aktarılmış irsaliyeye dokunma.
  if (['approved', 'rejected', 'deleted'].includes(irs.status)) return { skipped: 'manuel_islem_gormus' };
  if (irs.autoTransfer && irs.autoTransfer.status === 'done') return { skipped: 'zaten_aktarildi' };

  const match = matchLab({ cariKodu: irs.cariKodu, sevkAdresi: irs.sevkAdresi }, hospitals);
  if (!match.matched) {
    // Eşleşmeyen irsaliye onay kuyruğunda BEKLER; panelde elle laboratuvar
    // seçilerek aktarılır. Yanlış laboratuvara sessizce stok yazılmaz.
    await ref.set(
      {
        autoTransfer: {
          status: 'unmatched',
          reason: match.reason,
          detail: match.detail,
          candidates: match.candidates,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return { skipped: 'eslesmedi', detail: match.detail };
  }

  const lab = match.lab;
  const transferId = transferIdFor(irs);
  const built = buildLabStockDocs({
    irsaliye: irs,
    lab,
    productsByCode,
    companyId,
    transferId,
    sourceDepot,
  });

  if (built.stockDocs.length === 0) {
    await ref.set(
      {
        autoTransfer: {
          status: 'empty',
          reason: 'yazilacak_kalem_yok',
          detail: built.skipped.length
            ? `Atlanan kalemler: ${built.skipped.map((s) => `${s.stokKodu}(${s.reason})`).join(', ')}`
            : 'İrsaliyede kalem yok.',
          skipped: built.skipped,
          labId: lab.id,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return { skipped: 'kalem_yok' };
  }

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();

  for (const spec of built.stockDocs) {
    batch.set(db.collection('depoStok').doc(spec.id), { ...spec.data, sevkTarihi: now, eklenmeTarihi: now }, { merge: true });
  }

  // Provenans: depo adımı atlansa da transfer kaydı yazılır — transfer geçmişi
  // paneli ve lab stok kurtarma mantığı bu koleksiyonu okur.
  const transferRef = db.collection('transfers').doc(transferId);
  batch.set(transferRef, {
    id: transferId,
    timestamp: now,
    sourceDepotId: (sourceDepot && sourceDepot.id) || null,
    sourceDepotName: (sourceDepot && sourceDepot.name) || 'Ceomed',
    targetHospitalId: lab.id,
    targetName: lab.name || '',
    mode: 'ceomed-auto',
    itemCount: built.totalUnits,
    createdByUid: 'ceomed-watcher',
    createdByName: 'Ceomed Otomatik Aktarım',
    irsaliyeNo: irs.irsaliyeNo || '',
    ceomedIrsaliyeId: irs.ceomedId,
    companyId,
  });
  for (const it of built.transferItems) {
    batch.set(transferRef.collection('items').doc(it.id), it.data);
  }

  // Seri No Defteri: her fiziksel birim için transfer olayı. Bu yazılmazsa
  // ürün kullanım paneli barkodu okuduğunda birimi "geçmişte işlem görmemiş"
  // sanar ve mükerrer kontrolü çalışmaz.
  for (const spec of built.stockDocs) {
    const serial = String(spec.data.seriNumarasi || '').trim();
    if (!serial || /^(FAZLA|SAYIM)-/i.test(serial)) continue;
    const ledgerId = `sl_${safeSeg(companyId)}__${safeSeg(spec.data.stokKodu)}__${safeSeg(serial)}`;
    const ledgerRef = db.collection('serialLedger').doc(ledgerId);
    batch.set(
      ledgerRef,
      {
        id: ledgerId,
        companyId,
        stokKodu: spec.data.stokKodu,
        stokAdi: spec.data.stokAdi,
        seriNumarasi: serial,
        lotNumarasi: spec.data.lotNumarasi || '',
        miad: spec.data.miad || '',
        status: 'laboratuvarda',
        locationType: 'lab',
        locationId: lab.id,
        locationName: lab.name || '',
        lastEventType: 'transfer',
        lastEventAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        eventCount: admin.firestore.FieldValue.increment(1),
        lastActorUid: null,
        lastActorName: 'Ceomed Otomatik Aktarım',
      },
      { merge: true }
    );
    // Deterministik olay kimliği → yeniden işlemede mükerrer olay yazılmaz.
    batch.set(ledgerRef.collection('events').doc(`ceomed-${safeSeg(irs.ceomedId)}`), {
      companyId,
      ledgerId,
      type: 'transfer',
      stokKodu: spec.data.stokKodu,
      stokAdi: spec.data.stokAdi,
      seriNumarasi: serial,
      lotNumarasi: spec.data.lotNumarasi || '',
      miad: spec.data.miad || '',
      fromType: 'depot',
      fromId: (sourceDepot && sourceDepot.id) || '',
      fromName: (sourceDepot && sourceDepot.name) || 'Ceomed',
      toType: 'lab',
      toId: lab.id,
      toName: lab.name || '',
      refs: { transferId, ceomedIrsaliyeId: String(irs.ceomedId), depoStokId: spec.id },
      actorUid: null,
      actorName: 'Ceomed Otomatik Aktarım',
      details: { irsaliyeNo: irs.irsaliyeNo || '', kaynak: 'ceomed-auto' },
      timestamp: now,
    });
  }

  batch.set(
    ref,
    {
      autoTransfer: {
        status: 'done',
        labId: lab.id,
        labName: lab.name || '',
        transferId,
        unitCount: built.totalUnits,
        docCount: built.stockDocs.length,
        skipped: built.skipped,
        transferredAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  await batch.commit();
  await db.doc('metadata/stockLastUpdated').set(
    { lastUpdated: admin.firestore.FieldValue.serverTimestamp(), updatedAt: new Date().toISOString() },
    { merge: true }
  );

  return {
    transferred: true,
    labName: lab.name,
    units: built.totalUnits,
    skipped: built.skipped,
  };
}

function safeSeg(value) {
  return String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 400);
}

async function irsaliyeTick(db, session, companyId) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - LOOKBACK_DAYS);

  const master = await session.withRetry(({ token, user }) =>
    fetchIrsaliyeMaster({
      token,
      idUser: user.ID_USER,
      baslangic: ddMMyyyy(start),
      bitis: ddMMyyyy(now),
    })
  );

  const relevant = master.filter((i) => ALLOWED_STATUSES.includes((i.DURUM_ACIKLAMA || '').toUpperCase()));

  // Master listeyi Firestore'daki durumla karşılaştır; yalnızca YENİ ya da
  // durumu DEĞİŞEN irsaliyeler için barkod detayını çek. Barkod çağrısı
  // irsaliye başına bir ERP isteği demektir; her turda hepsini çekmek ERP'yi
  // gereksiz yorar ve yoklama aralığını kısaltmayı imkânsız kılar.
  let yeni = 0;
  let degisen = 0;
  const dokunulanlar = [];

  for (const irs of relevant) {
    const docRef = db.collection('pendingCeomedIrsaliye').doc(String(irs.ID));
    const snap = await docRef.get();
    const eskiDurum = snap.exists ? snap.get('durumAciklama') : null;
    const mevcutDurum = irs.DURUM_ACIKLAMA;
    const statusField = snap.exists ? snap.get('status') : null;

    if (snap.exists && eskiDurum === mevcutDurum) {
      dokunulanlar.push(docRef);
      continue; // değişiklik yok
    }

    if (['approved', 'rejected', 'deleted'].includes(statusField)) {
      // Elle işlem görmüş kayıt: yalnızca ERP durumunu tazele.
      await docRef.set(
        {
          durumAciklama: mevcutDurum,
          durumTipi: irs.DURUM_TIPI,
          sevkAdresi: irs.ADRES || '',
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      degisen++;
      continue;
    }

    const items = await session.withRetry(({ token, user }) =>
      fetchOkutulanBarkod({ token, idSevkMaster: irs.ID, idUser: user.ID_USER })
    );

    await docRef.set(
      {
        ceomedId: irs.ID,
        irsaliyeNo: irs.IRSALIYE_NO,
        tarih: irs.TARIH,
        cariKodu: irs.CARI_KODU,
        cariUnvan: irs.CARI_UNVAN,
        sevkAdresi: irs.ADRES || '',
        evrakSeq: irs.EVRAK_SEQ,
        depo: irs.DEPO,
        durumAciklama: mevcutDurum,
        durumTipi: irs.DURUM_TIPI,
        belgeTipi: irs.BELGE_TIPI,
        itemCount: items.length,
        items,
        status: statusField || 'pending',
        companyId,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (snap.exists) degisen++;
    else yeni++;
    dokunulanlar.push(docRef);
    log('irsaliye', `${snap.exists ? 'GÜNCEL' : 'YENİ'} ${irs.IRSALIYE_NO} [${mevcutDurum}] ${items.length} barkod`);
  }

  if (yeni || degisen) {
    await db.doc('metadata/stockLastUpdated').set(
      { lastUpdated: admin.firestore.FieldValue.serverTimestamp(), updatedAt: new Date().toISOString() },
      { merge: true }
    );
  }

  if (!AUTO_TRANSFER) return { yeni, degisen, aktarilan: 0 };

  // "KURUMA SEVK EDILDI" olan ve henüz aktarılmamış irsaliyeleri laboratuvara yaz.
  const sevkEdilenler = relevant.filter((i) => (i.DURUM_ACIKLAMA || '').toUpperCase() === SEVK_EDILDI);
  if (sevkEdilenler.length === 0) return { yeni, degisen, aktarilan: 0 };

  const [hospitalsSnap, productsSnap, depotsSnap] = await Promise.all([
    db.collection('hospitals').where('companyId', '==', companyId).get(),
    db.collection('productCodes').where('companyId', '==', companyId).get(),
    db.collection('depots').where('ceomedEnabled', '==', true).get(),
  ]);
  const hospitals = hospitalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const productsByCode = new Map(
    productsSnap.docs.map((d) => [String(d.get('stokKodu') || '').trim(), { id: d.id, ...d.data() }])
  );
  const sourceDepotDoc = depotsSnap.docs.find((d) => (d.get('companyId') || companyId) === companyId);
  const sourceDepot = sourceDepotDoc ? { id: sourceDepotDoc.id, name: sourceDepotDoc.get('name') || '' } : null;

  let aktarilan = 0;
  for (const irs of sevkEdilenler) {
    const docSnap = await db.collection('pendingCeomedIrsaliye').doc(String(irs.ID)).get();
    if (!docSnap.exists) continue;
    try {
      const res = await autoTransferIrsaliye(db, {
        irsaliyeDoc: docSnap,
        hospitals,
        productsByCode,
        companyId,
        sourceDepot,
      });
      if (res.transferred) {
        aktarilan++;
        const atlanan = res.skipped && res.skipped.length ? ` (${res.skipped.length} kalem atlandı)` : '';
        log('aktarım', `${irs.IRSALIYE_NO} → ${res.labName}: ${res.units} birim${atlanan}`);
      } else if (res.skipped === 'eslesmedi') {
        log('aktarım', `${irs.IRSALIYE_NO} BEKLİYOR — ${res.detail}`);
      }
    } catch (e) {
      errLog('aktarım', `${irs.IRSALIYE_NO} HATA: ${e.message}`);
    }
  }

  return { yeni, degisen, aktarilan };
}

// ─────────────────────────── 2) Depo izleyici ───────────────────────────────

function stockKey(item) {
  return `${item.stokKodu}|${item.lot}|${item.miyat}`;
}

function computeDiff(prevItems, currItems) {
  const prev = new Map((prevItems || []).map((i) => [stockKey(i), i]));
  const curr = new Map((currItems || []).map((i) => [stockKey(i), i]));
  const diffs = [];
  for (const [k, c] of curr) {
    const p = prev.get(k);
    if (!p) diffs.push({ ...c, prev: 0, curr: c.adet, change: c.adet, type: 'added' });
    else if (p.adet !== c.adet) {
      diffs.push({ ...c, prev: p.adet, curr: c.adet, change: c.adet - p.adet, type: c.adet > p.adet ? 'increase' : 'decrease' });
    }
  }
  for (const [k, p] of prev) {
    if (!curr.has(k)) diffs.push({ ...p, prev: p.adet, curr: 0, change: -p.adet, type: 'removed' });
  }
  return diffs;
}

async function depoTick(db, session, companyId) {
  const depotsSnap = await db.collection('depots').where('ceomedEnabled', '==', true).get();
  const targets = depotsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.ceomedDepoKodu);
  if (targets.length === 0) return { degisen: 0 };

  const raw = await session.withRetry(({ token, user }) =>
    fetchMerkezDepoListesi({ token, idUser: user.ID_USER })
  );

  let degisen = 0;
  for (const depot of targets) {
    try {
      const items = extractDepoStock(raw, depot.ceomedDepoKodu);
      const docRef = db.collection('ceomedDepoStok').doc(depot.id);
      const existing = await docRef.get();
      const prevItems = existing.exists ? existing.get('items') || [] : [];
      const diff = computeDiff(prevItems, items);

      // Değişim yoksa YAZMA. Her yoklamada yazmak, kısa aralıklı çalışmada
      // gereksiz Firestore maliyeti ve sonsuz "stok güncellendi" bildirimi
      // üretirdi; açık paneller de boş yere tazelenirdi.
      if (diff.length === 0 && existing.exists) continue;

      const tenantId = (depot.companyId || companyId || '').trim();
      if (!tenantId) {
        errLog('depo', `${depot.name}: companyId çözümlenemedi, atlandı.`);
        continue;
      }

      await docRef.set({
        depotId: depot.id,
        depotName: depot.name,
        depoKodu: depot.ceomedDepoKodu,
        items,
        previousItems: prevItems,
        lastDiff: diff,
        previousSyncedAt: existing.exists ? existing.get('syncedAt') || null : null,
        companyId: tenantId,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      degisen++;
      log('depo', `${depot.name} (DEPO${depot.ceomedDepoKodu}) — ${items.length} kalem, ${diff.length} değişim`);
    } catch (e) {
      errLog('depo', `${depot.name}: ${e.message}`);
    }
  }

  if (degisen > 0) {
    // Açık panellerin anında tazelenmesini sağlayan damga.
    await db.doc('metadata/stockLastUpdated').set(
      { lastUpdated: admin.firestore.FieldValue.serverTimestamp(), updatedAt: new Date().toISOString() },
      { merge: true }
    );
  }
  return { degisen };
}

// ───────────────────── 3) Sevkiyat isteği izleyici ──────────────────────────

function startSevkiyatWatcher(db, session) {
  const { processRequest } = require('./watchSevkiyatRequests');
  let processing = false;
  const queue = [];

  const drain = async () => {
    if (processing) return;
    processing = true;
    while (queue.length) {
      const snap = queue.shift();
      const fresh = await snap.ref.get();
      if (fresh.exists && fresh.data().status === 'pending') {
        await processRequest(db, fresh);
      }
    }
    processing = false;
  };

  return db
    .collection('ceomedSevkiyatRequests')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach((c) => {
          if (c.type === 'added' || c.type === 'modified') queue.push(c.doc);
        });
        drain().catch((e) => errLog('sevkiyat', `drain: ${e.message}`));
      },
      (err) => errLog('sevkiyat', `listener: ${err.message}`)
    );
}

// ───────────────────────────── Ana döngü ────────────────────────────────────

/**
 * Bir izleyiciyi kendi aralığında sonsuz döngüde çalıştırır.
 * Hata durumunda süreç ÖLMEZ: hata loglanır ve bir sonraki tura geçilir —
 * ERP'nin geçici olarak erişilemez olması watcher'ı durdurmamalı.
 */
async function loop(name, intervalSec, fn) {
  let ardArdaHata = 0;
  while (running) {
    const basladi = Date.now();
    try {
      await fn();
      ardArdaHata = 0;
    } catch (e) {
      ardArdaHata++;
      errLog(name, `tur hatası (${ardArdaHata}): ${e.message}`);
    }
    // Ardışık hatada geri çekil (ERP kapalıysa saniyede bir denemeyelim).
    const geriCekilme = Math.min(ardArdaHata, 5) * 30;
    const bekle = Math.max(1, intervalSec + geriCekilme) * 1000 - (Date.now() - basladi);
    if (bekle > 0) await sleep(bekle);
  }
}

async function main() {
  const companyId = requireCompanyId();
  const db = initFirestore();
  const session = new Session();

  log('watcher', `Başlatıldı — companyId=${companyId}`);
  log('watcher', `İrsaliye yoklama: ${IRSALIYE_SEC}s · Depo yoklama: ${DEPO_SEC}s · Geriye bakış: ${LOOKBACK_DAYS} gün`);
  log('watcher', `Otomatik lab aktarımı: ${AUTO_TRANSFER ? 'AÇIK' : 'KAPALI'}`);

  const unsubscribe = startSevkiyatWatcher(db, session);
  log('sevkiyat', 'ceomedSevkiyatRequests dinleniyor (realtime).');

  const kapat = (sinyal) => {
    if (!running) return;
    running = false;
    log('watcher', `${sinyal} alındı, kapanıyor...`);
    try { unsubscribe(); } catch { /* yoksay */ }
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', () => kapat('SIGINT'));
  process.on('SIGTERM', () => kapat('SIGTERM'));

  await Promise.all([
    loop('irsaliye', IRSALIYE_SEC, async () => {
      const r = await irsaliyeTick(db, session, companyId);
      if (r.yeni || r.degisen || r.aktarilan) {
        log('irsaliye', `tur: ${r.yeni} yeni, ${r.degisen} güncellenen, ${r.aktarilan} otomatik aktarım`);
      }
    }),
    loop('depo', DEPO_SEC, async () => {
      await depoTick(db, session, companyId);
    }),
  ]);
}

if (require.main === module) {
  main().catch((e) => {
    errLog('watcher', `FATAL: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { autoTransferIrsaliye, computeDiff, irsaliyeTick, depoTick };
