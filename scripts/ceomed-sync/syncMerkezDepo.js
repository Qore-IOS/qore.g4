/**
 * Ceomed merkez depo stoklarını çekip Firestore'a yazar.
 * Hangi depolar: depots koleksiyonunda ceomedEnabled=true olan ve ceomedDepoKodu dolu olanlar.
 *
 * Yazılan koleksiyon: ceomedDepoStok/{depotId}
 *   { depotId, depoKodu, items: [...], previousItems: [...], lastDiff: [...],
 *     syncedAt, previousSyncedAt }
 *
 * Günde 1 kez çalıştırılması önerilir.
 */
const admin = require('../db/script-store.cjs');
const { login } = require('./login');
const { fetchMerkezDepoListesi, extractDepoStock } = require('./fetchMerkezDepoListesi');

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

function key(item) {
  return `${item.stokKodu}|${item.lot}|${item.miyat}`;
}

function computeDiff(prevItems, currItems) {
  const prevMap = new Map(prevItems.map((i) => [key(i), i]));
  const currMap = new Map(currItems.map((i) => [key(i), i]));
  const diffs = [];
  for (const [k, c] of currMap) {
    const p = prevMap.get(k);
    if (!p) {
      diffs.push({
        stokKodu: c.stokKodu,
        stokAdi: c.stokAdi,
        lot: c.lot,
        miyat: c.miyat,
        prev: 0,
        curr: c.adet,
        change: c.adet,
        type: 'added',
      });
    } else if (p.adet !== c.adet) {
      diffs.push({
        stokKodu: c.stokKodu,
        stokAdi: c.stokAdi,
        lot: c.lot,
        miyat: c.miyat,
        prev: p.adet,
        curr: c.adet,
        change: c.adet - p.adet,
        type: c.adet > p.adet ? 'increase' : 'decrease',
      });
    }
  }
  for (const [k, p] of prevMap) {
    if (!currMap.has(k)) {
      diffs.push({
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        lot: p.lot,
        miyat: p.miyat,
        prev: p.adet,
        curr: 0,
        change: -p.adet,
        type: 'removed',
      });
    }
  }
  return diffs;
}

async function syncOnce() {
  const db = initFirestore();
  const depotsSnap = await db
    .collection('depots')
    .where('ceomedEnabled', '==', true)
    .get();

  if (depotsSnap.empty) {
    console.log('Ceomed entegrasyonlu depo yok, çıkılıyor.');
    return;
  }

  const targets = depotsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.ceomedDepoKodu);
  if (targets.length === 0) {
    console.log('ceomedDepoKodu tanımlı depo yok.');
    return;
  }

  const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
  console.log(`Login OK (ID_USER=${user.ID_USER})`);

  const raw = await fetchMerkezDepoListesi({ token, idUser: user.ID_USER });
  console.log(`Ham liste: ${raw.length} satır`);

  for (const depot of targets) {
    try {
      const items = extractDepoStock(raw, depot.ceomedDepoKodu);
      const docRef = db.collection('ceomedDepoStok').doc(depot.id);
      const existing = await docRef.get();
      const prevItems = existing.exists ? (existing.get('items') || []) : [];
      const diff = computeDiff(prevItems, items);

      // Multi-tenancy: yazdığımız ceomedDepoStok dokümanı kaynağı olan depot'un
      // companyId'sini taşımalı; panel scopedQuery'leri bu tag'e göre filtreliyor.
      // Depot tag'i yoksa env CEOMED_COMPANY_ID fallback'i devreye girer.
      const tenantId = (depot.companyId || process.env.CEOMED_COMPANY_ID || '').trim();
      if (!tenantId) {
        console.error(
          `  HATA ${depot.name}: companyId çözümlenemedi (depot doc'unda yok, CEOMED_COMPANY_ID env de boş).`
        );
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

      console.log(
        `  OK ${depot.name} (DEPO${depot.ceomedDepoKodu}) — ${items.length} kalem, ${diff.length} değişim`
      );
    } catch (e) {
      console.error(`  HATA ${depot.name}: ${e.message}`);
    }
  }
}

if (require.main === module) {
  syncOnce().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { syncOnce };
