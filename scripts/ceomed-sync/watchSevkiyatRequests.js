/**
 * Uzun çalışan listener: ceomedSevkiyatRequests koleksiyonundaki 'pending' istekleri dinler,
 * ilgili dönemin Ceomed irsaliyelerini (KURUMA SEVK EDILDI) sorgular, kurum + sevk adresi + stok
 * bazında toplam adetleri hesaplar ve ceomedSevkiyatResults/{requestId} dokümanına yazar.
 *
 * Total Verimlilik panelindeki "Ceomed'den Ay Başı Sevkiyat Getir" butonu bu isteği tetikler.
 *
 * Bu bir long-running process'tir — PC'de sürekli açık kalmalı (run-sevkiyat-watcher.bat ile başlat).
 *
 * Gerekli env: CEOMED_*, GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');
const { login } = require('./login');
const { fetchIrsaliyeMaster } = require('./fetchIrsaliyeMaster');
const { fetchOkutulanBarkod } = require('./fetchOkutulanBarkod');

const SEVK_EDILDI = 'KURUMA SEVK EDILDI';

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

// year, month(1-12) -> "dd.MM.yyyy" başlangıç/bitiş
function monthRange(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const bas = `01.${pad(month)}.${year}`;
  const lastDay = new Date(year, month, 0).getDate();
  const bit = `${pad(lastDay)}.${pad(month)}.${year}`;
  return { bas, bit };
}

async function processRequest(db, docSnap) {
  const req = docSnap.data();
  const id = docSnap.id;
  const ref = docSnap.ref;
  try {
    await ref.set({ status: 'processing', processingStartedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Tarih aralığı: {year, month} veya {baslangic, bitis} (dd.MM.yyyy)
    let bas, bit;
    if (req.baslangic && req.bitis) {
      bas = req.baslangic; bit = req.bitis;
    } else {
      ({ bas, bit } = monthRange(Number(req.year), Number(req.month)));
    }

    const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
    const all = await fetchIrsaliyeMaster({ token, idUser: user.ID_USER, baslangic: bas, bitis: bit });
    const sevkEdilenler = all.filter((i) => (i.DURUM_ACIKLAMA || '').toUpperCase() === SEVK_EDILDI);

    // Aggregate: key = cariKodu | sevkAdresi | stokKodu -> toplam adet
    const agg = new Map();
    let processedIrs = 0;
    for (const irs of sevkEdilenler) {
      const items = await fetchOkutulanBarkod({ token, idSevkMaster: irs.ID, idUser: user.ID_USER });
      const cari = irs.CARI_KODU || '';
      const adres = irs.ADRES || '';
      for (const it of items) {
        const stok = it.STOK_KODU || '';
        if (!stok) continue;
        const miktar = Number(it.MIKTAR) || 1;
        const key = `${cari}||${adres}||${stok}`;
        const cur = agg.get(key);
        if (cur) cur.adet += miktar;
        else agg.set(key, { cariKodu: cari, sevkAdresi: adres, stokKodu: stok, adet: miktar });
      }
      processedIrs++;
    }

    const rows = Array.from(agg.values());

    // Firestore doküman boyutu limiti 1MB. Çok büyükse parçalara böl.
    const resultRef = db.collection('ceomedSevkiyatResults').doc(id);
    await resultRef.set({
      requestId: id,
      year: req.year ?? null,
      month: req.month ?? null,
      baslangic: bas,
      bitis: bit,
      irsaliyeCount: sevkEdilenler.length,
      processedIrsaliye: processedIrs,
      rowCount: rows.length,
      rows,
      status: 'done',
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.set({ status: 'done', finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log(`[${id}] DONE ${bas}-${bit}: ${sevkEdilenler.length} irsaliye, ${rows.length} satır`);
  } catch (e) {
    console.error(`[${id}] HATA: ${e.message}`);
    await ref.set({ status: 'error', error: e.message, finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
}

function main() {
  const db = initFirestore();
  console.log('Sevkiyat watcher başladı. ceomedSevkiyatRequests dinleniyor...');

  let processing = false;
  const queue = [];

  const drain = async () => {
    if (processing) return;
    processing = true;
    while (queue.length) {
      const snap = queue.shift();
      // Yeniden oku — status değişmiş olabilir
      const fresh = await snap.ref.get();
      if (fresh.exists && fresh.data().status === 'pending') {
        await processRequest(db, fresh);
      }
    }
    processing = false;
  };

  db.collection('ceomedSevkiyatRequests')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            queue.push(change.doc);
          }
        });
        drain().catch((e) => console.error('drain error', e.message));
      },
      (err) => console.error('listener error', err.message)
    );
}

if (require.main === module) {
  main();
}

// `watch.js` (tek süreçte üç izleyici) bu işleyiciyi yeniden kullanır; böylece
// sevkiyat isteği mantığı iki yerde kopyalanmaz.
module.exports = { processRequest, monthRange, initFirestore };
