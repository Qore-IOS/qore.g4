/**
 * Bir Ceomed irsaliyesinden laboratuvar stok belgelerini üretir.
 *
 * Kullanıcı akışı: irsaliye "KURUMA SEVK EDILDI" durumuna geçtiği anda, içindeki
 * ürünler eşleşen laboratuvarın stoğuna TÜM bilgileriyle otomatik eklenir —
 * elle "Stoğa Aktar" tıklamaya gerek kalmadan.
 *
 * Qore modelinde laboratuvar stoğu = `depoStok` belgeleri + `isShipped: true` +
 * `hedefKurumId`. Depo adımı atlanır (mal ERP tarafında zaten depodan çıkmıştır),
 * fakat provenans kaybolmasın diye ayrıca bir `transfers` başlığı + `items`
 * yazılır: transfer geçmişi paneli ve lab stok kurtarma mantığı o koleksiyonu
 * okur.
 *
 * İDEMPOTENS: belge kimlikleri irsaliye + ürün + seri + sıra numarasından
 * deterministik olarak türetilir. Watcher aynı irsaliyeyi yeniden işlerse
 * (yeniden başlatma, ağ hatası, ERP'nin aynı kaydı tekrar döndürmesi) aynı
 * kimlikler üretilir ve mükerrer stok OLUŞMAZ.
 *
 * Saf fonksiyon: Firestore SDK'sına dokunmaz, doğrudan test edilebilir.
 */

/** Firestore belge kimliği için güvenli hâle getirir. */
function safeId(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 200);
}

/**
 * Miad normalizasyonu — `src/lib/date.ts` içindeki `normalizeMiad` ile aynı
 * kuralları uygular (ddMMyy ve d.M.yyyy → dd.MM.yyyy). Panellerin beklediği
 * biçim budur; ham ERP değeri yazılırsa miad uyarıları ve FEFO sıralaması
 * çalışmaz.
 */
function normalizeMiad(input) {
  const raw = String(input == null ? '' : input).trim();
  const pad = (n) => String(n).padStart(2, '0');

  if (/^\d{6}$/.test(raw)) {
    const yy = parseInt(raw.slice(0, 2), 10);
    const mm = parseInt(raw.slice(2, 4), 10);
    const dd = parseInt(raw.slice(4, 6), 10);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${pad(dd)}.${pad(mm)}.${yyyy}`;
  }

  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) {
    const [d, m, y] = raw.replace(/-/g, '.').replace(/\//g, '.').split('.');
    const yyyy = y.length === 2 ? (parseInt(y, 10) >= 70 ? `19${y}` : `20${y}`) : y;
    return `${pad(parseInt(d, 10))}.${pad(parseInt(m, 10))}.${yyyy}`;
  }

  return raw;
}

/** Ürünün seri takipli olup olmadığı — `src/lib/tracking.ts` ile aynı kural. */
function isSerialTracked(product) {
  if (!product) return false;
  if (product.trackingMode) return product.trackingMode === 'serial';
  const brand = String(product.marka || product.manufacturer || product.stokAdi || '').toLowerCase();
  return brand.includes('roche');
}

/**
 * @param {object} params
 * @param {object} params.irsaliye  pendingCeomedIrsaliye dokümanı
 * @param {object} params.lab       eşleşen laboratuvar { id, name }
 * @param {Map<string,object>} params.productsByCode  stokKodu -> productCodes dokümanı
 * @param {string} params.companyId
 * @param {string} params.transferId
 * @param {object} [params.sourceDepot] { id, name } — ceomed entegre depo (varsa)
 * @returns {{ stockDocs: Array, transferItems: Array, lines: Array, totalUnits: number,
 *             skipped: Array<{stokKodu: string, reason: string}> }}
 */
function buildLabStockDocs({ irsaliye, lab, productsByCode, companyId, transferId, sourceDepot }) {
  const stockDocs = [];
  const transferItems = [];
  const lineMap = new Map();
  const skipped = [];
  let totalUnits = 0;

  const items = Array.isArray(irsaliye.items) ? irsaliye.items : [];

  items.forEach((item, index) => {
    const stokKodu = String(item.STOK_KODU || '').trim();
    if (!stokKodu) {
      skipped.push({ stokKodu: '(boş)', reason: 'stok_kodu_yok' });
      return;
    }

    const product = productsByCode.get(stokKodu);
    if (!product) {
      // Ürün kataloğunda yoksa stok adı/ambalaj değeri bilinmez; sessizce
      // yanlış veri yazmak yerine atlanır ve raporlanır.
      skipped.push({ stokKodu, reason: 'urun_kodu_tanimsiz' });
      return;
    }

    const serial = String(item.BARKOD_SERI || '').trim();
    const lot = String(item.LOT || '').trim();
    const miad = normalizeMiad(item.MIYAT);
    const miktar = Math.max(1, Number(item.MIKTAR) || 1);
    const serialTracked = isSerialTracked(product);

    const base = {
      stokKodu,
      stokAdi: product.stokAdi || stokKodu,
      lotNumarasi: lot,
      miad,
      // Laboratuvar stoğunun tanımı: sevk edilmiş + hedef kurum atanmış.
      isShipped: true,
      hedefKurumId: lab.id,
      hedefKurum: lab.name || '',
      transferId,
      irsaliyeNumarasi: irsaliye.irsaliyeNo || '',
      urunGrubu: product.urunGrubu,
      ambalajDegeri: product.ambalajDegeri,
      companyId,
      // Provenans: bu satırın Ceomed'den otomatik geldiğini işaretler.
      source: 'ceomed-auto',
      ceomedIrsaliyeId: irsaliye.ceomedId,
      sourceDepotId: (sourceDepot && sourceDepot.id) || null,
      sourceDepotName: (sourceDepot && sourceDepot.name) || '',
      createdByName: 'Ceomed Otomatik Aktarım',
    };

    if (serialTracked && serial) {
      // Seri takipli: her fiziksel birim ayrı belge, adet daima 1.
      // ERP tek satırda MIKTAR>1 verse bile seri no tek olduğu için 1 birim
      // yazılır; aksi hâlde aynı seri numarası birden çok birimi temsil eder
      // ve seri defteri tutarsız kalır.
      stockDocs.push({
        id: `ceomed-${safeId(irsaliye.ceomedId)}-${safeId(stokKodu)}-${safeId(serial)}`,
        data: { ...base, seriNumarasi: serial, adet: 1 },
      });
      totalUnits += 1;
    } else {
      // Lot/adet takipli (veya seri numarası gelmemiş): tek belge + adet.
      stockDocs.push({
        id: `ceomed-${safeId(irsaliye.ceomedId)}-${safeId(stokKodu)}-${safeId(lot)}-${index}`,
        data: { ...base, seriNumarasi: serial, adet: miktar },
      });
      totalUnits += miktar;
    }

    const key = `${stokKodu}||${lot}||${miad}`;
    const line = lineMap.get(key) || { stokKodu, stokAdi: base.stokAdi, lotNumarasi: lot, miad, adet: 0, serials: [] };
    line.adet += serialTracked && serial ? 1 : miktar;
    if (serial) line.serials.push(serial);
    lineMap.set(key, line);
  });

  stockDocs.forEach((docSpec) => {
    transferItems.push({
      id: docSpec.id,
      data: {
        stokKodu: docSpec.data.stokKodu,
        stokAdi: docSpec.data.stokAdi,
        lotNumarasi: docSpec.data.lotNumarasi,
        miad: docSpec.data.miad,
        seriNumarasi: docSpec.data.seriNumarasi || '',
        adet: docSpec.data.adet,
      },
    });
  });

  return { stockDocs, transferItems, lines: Array.from(lineMap.values()), totalUnits, skipped };
}

/** Bir irsaliye için deterministik transfer kimliği (idempotens). */
function transferIdFor(irsaliye) {
  return `ceomed-${safeId(irsaliye.ceomedId)}`;
}

module.exports = { buildLabStockDocs, transferIdFor, normalizeMiad, isSerialTracked, safeId };
