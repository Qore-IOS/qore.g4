import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIrsaliyeGirisDoc,
  formatTarihForCeomed,
  normalizeTarih,
  resolveLotValue,
  ceomedIrsaliyeNo,
  selectPartActions,
  CEOMED_DEPO,
  CEOMED_ISLEM_TIPI,
} from '../../src/lib/ceomed/irsaliye-giris';

const baseInput = {
  formId: 'form-1',
  formNo: 'BT-T0042',
  formType: 'teknik_servis' as const,
  tarih: '2026-08-05',
  hospitalId: 'lab-1',
  cariKodu: 'M51001',
  labName: 'Merkez Lab',
  deviceId: 'dev-1',
  cihazAdi: 'cobas 6000',
  seriNumarasi: 'SN-9',
  personnelName: 'Ahmet Yılmaz',
  personnelUid: 'uid-1',
  companyId: 'firma-1',
  actions: [
    { id: 'a1', type: 'part_change', stokKodu: 'YP-100', stokAdi: 'Pompa', quantity: 1, serialNumber: 'SER-1' },
  ],
};

test('yedek parça yoksa iş üretilmez', () => {
  const r = buildIrsaliyeGirisDoc({
    ...baseInput,
    actions: [{ id: 'o1', type: 'operation', quantity: 1 }],
  });
  assert.equal(r.outcome, 'skip');
});

test('hücre değişimi de yedek parça sayılır', () => {
  const selected = selectPartActions([
    { id: 'a1', type: 'part_change' },
    { id: 'a2', type: 'hucre_degisimi' },
    { id: 'a3', type: 'operation' },
  ]);
  assert.deepEqual(selected.map((a) => a.id), ['a1', 'a2']);
});

test('tam veriyle iş pending olarak hazırlanır ve sabitler yerine oturur', () => {
  const r = buildIrsaliyeGirisDoc(baseInput);
  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;

  assert.equal(r.doc.status, 'pending');
  // İrsaliye No artık ham form numarası değil, Ceomed biçimine çevrilmiş hali.
  assert.equal(r.doc.irsaliyeNo, 'BT10042');
  assert.equal(r.doc.cariKodu, 'M51001');
  assert.equal(r.doc.tarih, '2026-08-05');
  assert.equal(r.doc.islemTipi, CEOMED_ISLEM_TIPI);
  assert.equal(r.doc.islemTipi, '35');
  assert.equal(r.doc.depo, CEOMED_DEPO);
  assert.equal(r.doc.depo, '10');
  assert.equal(r.doc.aciklama, 'Ahmet Yılmaz');
  assert.equal(r.doc.satirlar.length, 1);
  assert.equal(r.doc.blockedReason, null);
});

test('cari kodu büyük harfe normalize edilir', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, cariKodu: '  m51001 ' });
  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;
  assert.equal(r.doc.cariKodu, 'M51001');
});

// --- LOT kuralı: "seri no varsa seri no" -------------------------------------

test('lot + seri no birlikteyse lot alanına SERİ NO yazılır', () => {
  const { lot, lotKaynagi } = resolveLotValue({ serialNumber: 'SER-1', lotNumber: 'LOT-9' });
  assert.equal(lot, 'SER-1');
  assert.equal(lotKaynagi, 'seri_no');
});

test('sadece seri no varsa lot alanına seri no yazılır', () => {
  const { lot, lotKaynagi } = resolveLotValue({ serialNumber: 'SER-1' });
  assert.equal(lot, 'SER-1');
  assert.equal(lotKaynagi, 'seri_no');
});

test('sadece lot varsa lot alanına lot yazılır', () => {
  const { lot, lotKaynagi } = resolveLotValue({ lotNumber: 'LOT-9' });
  assert.equal(lot, 'LOT-9');
  assert.equal(lotKaynagi, 'lot');
});

test('ikisi de yoksa lot alanı boş kalır', () => {
  const { lot, lotKaynagi } = resolveLotValue({});
  assert.equal(lot, '');
  assert.equal(lotKaynagi, 'yok');
});

test('boşluklu seri no dolu sayılmaz', () => {
  const { lot, lotKaynagi } = resolveLotValue({ serialNumber: '   ', lotNumber: 'LOT-9' });
  assert.equal(lot, 'LOT-9');
  assert.equal(lotKaynagi, 'lot');
});

// --- Satır üretimi ------------------------------------------------------------

test('çok parçalı form tek irsaliyede çok satır üretir', () => {
  const r = buildIrsaliyeGirisDoc({
    ...baseInput,
    actions: [
      { id: 'a1', type: 'part_change', stokKodu: 'YP-100', stokAdi: 'Pompa', quantity: 1, serialNumber: 'SER-1' },
      { id: 'a2', type: 'part_change', stokKodu: 'YP-200', stokAdi: 'Filtre', quantity: 3, lotNumber: 'LOT-7' },
      { id: 'a3', type: 'operation', quantity: 1 },
      { id: 'a4', type: 'hucre_degisimi', stokKodu: 'YP-300', stokAdi: 'Hücre', quantity: 2, serialNumber: 'SER-3' },
    ],
  });

  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;

  assert.deepEqual(
    r.doc.satirlar.map((s) => [s.stokKodu, s.miktar, s.lot, s.lotKaynagi]),
    [
      ['YP-100', 1, 'SER-1', 'seri_no'],
      ['YP-200', 3, 'LOT-7', 'lot'],
      ['YP-300', 2, 'SER-3', 'seri_no'],
    ],
  );
});

test('miktar yoksa veya geçersizse 1 kabul edilir', () => {
  const r = buildIrsaliyeGirisDoc({
    ...baseInput,
    actions: [
      { id: 'a1', type: 'part_change', stokKodu: 'YP-100', stokAdi: 'Pompa', serialNumber: 'S' },
      { id: 'a2', type: 'part_change', stokKodu: 'YP-200', stokAdi: 'Filtre', quantity: 0, serialNumber: 'S2' },
      { id: 'a3', type: 'part_change', stokKodu: 'YP-300', stokAdi: 'Conta', quantity: -4, serialNumber: 'S3' },
    ],
  });
  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;
  assert.deepEqual(r.doc.satirlar.map((s) => s.miktar), [1, 1, 1]);
});

// --- Bloklama: belirsizlik tahminle kapatılmaz ---------------------------------

test('cari kodu tanımsızsa iş bloklanır, yazılmaya çalışılmaz', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, cariKodu: '' });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.status, 'blocked');
  assert.equal(r.doc.blockedReason, 'cari_kodu_tanimsiz');
  assert.match(r.doc.blockedDetail || '', /Merkez Lab/);
  // İş kaybolmaz: satırlar yine de saklanır ki eksik düzeltilince yeniden denenebilsin.
  assert.equal(r.doc.satirlar.length, 1);
});

test('stok kodu eksik satır varsa iş bloklanır', () => {
  const r = buildIrsaliyeGirisDoc({
    ...baseInput,
    actions: [
      { id: 'a1', type: 'part_change', stokKodu: 'YP-100', stokAdi: 'Pompa', quantity: 1 },
      { id: 'a2', type: 'part_change', stokKodu: '', stokAdi: 'Kodsuz Parça', quantity: 1 },
    ],
  });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.blockedReason, 'stok_kodu_eksik');
  assert.match(r.doc.blockedDetail || '', /Kodsuz Parça/);
});

test('personel adı yoksa iş bloklanır', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, personnelName: '  ' });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.blockedReason, 'personel_adi_yok');
});

test('form no yoksa iş bloklanır', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, formNo: null });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.blockedReason, 'form_no_yok');
});

test('birden çok eksik varsa tümü tek açıklamada toplanır', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, cariKodu: '', personnelName: '' });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.match(r.doc.blockedDetail || '', /cari kodu/i);
  assert.match(r.doc.blockedDetail || '', /adı soyadı/i);
});

// --- Tarih --------------------------------------------------------------------

test('tarih ISO, nokta ve slash biçimlerinden normalize edilir', () => {
  assert.equal(normalizeTarih('2026-08-05'), '2026-08-05');
  assert.equal(normalizeTarih('05.08.2026'), '2026-08-05');
  assert.equal(normalizeTarih('5/8/2026'), '2026-08-05');
  assert.equal(normalizeTarih(new Date(2026, 7, 5)), '2026-08-05');
});

test('çözülemeyen tarih null döner ve işi bloklar', () => {
  assert.equal(normalizeTarih('dün'), null);
  assert.equal(normalizeTarih(''), null);
  assert.equal(normalizeTarih(null), null);

  const r = buildIrsaliyeGirisDoc({ ...baseInput, tarih: 'dün' });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.blockedReason, 'tarih_gecersiz');
});

test('tarih Ceomed maskesine çevrilir', () => {
  assert.equal(formatTarihForCeomed('2026-08-05'), '05/08/2026');
  assert.equal(formatTarihForCeomed('2026-08-05', '.'), '05.08.2026');
});

// --- İrsaliye No dönüşümü -----------------------------------------------------
// Kural ÖLÇÜLMÜŞTÜR (ORACLE-IRSALIYE.md → Ölçüm 5-6):
//   * uygulama uyarısı: "ilk 2 karakterinden sonrası, sadece rakam olmalıdır"
//   * alan 8 karakterde SESSİZCE kesiyor ('AB1234567890…' → 'AB123456')

test('Qore form numarası Ceomed biçimine çevrilir', () => {
  assert.equal(ceomedIrsaliyeNo('BT-T0042'), 'BT10042');
  assert.equal(ceomedIrsaliyeNo('BT-A0042'), 'BT20042');
});

test('form tipi harfi rakama çevrilir — harf kalırsa uygulama reddeder', () => {
  // 'BT-T0042' → tire silinse 'BTT0042' olurdu: ilk 2 karakterden sonra 'T' harfi
  // var, uygulama bunu kabul etmiyor.
  const sonuc = ceomedIrsaliyeNo('BT-T0042');
  assert.ok(sonuc);
  assert.match(sonuc as string, /^[A-Z]{2}\d+$/);
});

test('2 harften uzun personel kodu ilk 2 harfe indirilir', () => {
  // "Ahmet Mehmet Yılmaz" → AMY. 'AMYT0042' olsaydı 3. karakter harf kalırdı.
  assert.equal(ceomedIrsaliyeNo('AMY-T0042'), 'AM10042');
});

test('tek harflik personel kodu X ile tamamlanır', () => {
  assert.equal(ceomedIrsaliyeNo('B-T0042'), 'BX10042');
});

test('8 karaktere sığmayan numara null döner — sessiz kesilmeye izin verilmez', () => {
  // Alan fazlasını uyarısızca atıyor; kesilmiş numara muhasebeye yanlış kayıt olur.
  assert.equal(ceomedIrsaliyeNo('BT-T123456'), null);
  assert.equal(ceomedIrsaliyeNo('BT-T9999999'), null);
  // Tam sınır 8 karakter: kabul edilir.
  assert.equal(ceomedIrsaliyeNo('BT-T12345'), 'BT112345');
});

test('tanınmayan form numarası biçimi null döner', () => {
  assert.equal(ceomedIrsaliyeNo('BTT0042'), null);
  assert.equal(ceomedIrsaliyeNo('BT-X0042'), null);
  assert.equal(ceomedIrsaliyeNo('BT-T'), null);
  assert.equal(ceomedIrsaliyeNo(''), null);
});

test('çevrilemeyen form numarası işi bloklar, tahmin edilmez', () => {
  const r = buildIrsaliyeGirisDoc({ ...baseInput, formNo: 'BT-T123456' });
  assert.equal(r.outcome, 'blocked');
  if (r.outcome !== 'blocked') return;
  assert.equal(r.doc.blockedReason, 'form_no_ceomed_formatina_uymuyor');
});

test('doc.irsaliyeNo çevrilmiş değeri taşır, ham form numarasını değil', () => {
  const r = buildIrsaliyeGirisDoc(baseInput);
  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;
  assert.equal(r.doc.irsaliyeNo, 'BT10042');
  assert.equal(r.doc.formNo, 'BT-T0042');
});

// --- Form numarası → irsaliye no dönüşümü ------------------------------------
// Sıra numarası farklıysa dönüşüm de farklı irsaliye numarası üretir. Sıranın
// KİM tarafından tekilleştirileceği ayrı bir konu: şirket bazlı sayaç denendi
// ama Firestore list kuralına takıldı ve geri alındı (bkz. ORACLE-IRSALIYE.md).

test('farklı sıra numarası farklı irsaliye numarası üretir', () => {
  const batuhan = ceomedIrsaliyeNo('BT-T0042');
  const burak = ceomedIrsaliyeNo('BT-T0043');

  assert.equal(batuhan, 'BT10042');
  assert.equal(burak, 'BT10043');
  assert.notEqual(batuhan, burak);
});

test('AÇIK RİSK: aynı baş harf + aynı sıra = aynı irsaliye numarası', () => {
  // Sayaç kullanıcı bazlı olduğu için iki personel de kendi sayacında 42'ye
  // ulaşırsa aynı numarayı üretir. Ceomed mükerrer numarayı REDDEDİYOR
  // (sahada gözlendi), yani ikincisinin irsaliyesi gönderilemez.
  // Çözüm bekliyor; şirket bazlı sayaç denemesi kural hatası verdi.
  assert.equal(ceomedIrsaliyeNo('BT-T0042'), ceomedIrsaliyeNo('BT-T0042'));
});

