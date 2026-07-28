import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dagitimYap,
  hesaplaOneri,
  hesaplaRiskliSevk,
  hesaplaTuketimTrendi,
  MIN_TREND_VERI_AYI,
  type AylikTuketim,
  type OneriGirdisi,
} from '../../src/lib/lojistik/supplier-order-advisor';

const seri = (...kutular: Array<number | null>): AylikTuketim[] =>
  kutular.map((kutu, index) => ({ donem: `0${index + 1}-2026`, kutu }));

const yatayTrend = hesaplaTuketimTrendi(seri(100, 100, 100, 100, 100, 100));

const temelGirdi = (over: Partial<OneriGirdisi> = {}): OneriGirdisi => ({
  gunlukMinMax: 6,
  gunlukTuketim: 4,
  basis: 'buyuk',
  trend: yatayTrend,
  hedefGun: 45,
  anaDepoStok: 0,
  sahaStok: 0,
  cihazUstuKutu: 0,
  acikSiparis: 0,
  ...over,
});

/* ——— Trend / ivme ——— */

test('yatay seri talebi değiştirmez', () => {
  const trend = hesaplaTuketimTrendi(seri(100, 100, 100, 100, 100, 100));
  assert.equal(trend.ivme, 'yatay');
  assert.equal(trend.katsayi, 1);
});

test('yükselen seri artış olarak işaretlenir ve talebi yukarı çeker', () => {
  const trend = hesaplaTuketimTrendi(seri(80, 80, 80, 120, 120, 120));
  assert.equal(trend.ivme, 'artis');
  assert.equal(trend.trendYuzde, 50);
  assert.ok(trend.katsayi > 1, 'katsayı 1 üzerinde olmalı');
});

test('son ay da aynı yönde saparsa ivmelenme sayılır ve etki artar', () => {
  const artan = hesaplaTuketimTrendi(seri(80, 80, 80, 100, 120, 200));
  assert.equal(artan.ivme, 'hizlanan-artis');

  const duz = hesaplaTuketimTrendi(seri(80, 80, 80, 120, 120, 120));
  assert.ok(
    artan.katsayi > duz.katsayi,
    'ivmelenen seri, düz artan seriden daha yüksek katsayı üretmeli',
  );
});

test('düşen seri talebi aşağı çeker', () => {
  const trend = hesaplaTuketimTrendi(seri(120, 120, 120, 80, 80, 80));
  assert.equal(trend.ivme, 'azalis');
  assert.ok(trend.katsayi < 1);
});

test('trend tavanı aşırı sıçramayı kırpar', () => {
  const trend = hesaplaTuketimTrendi(seri(10, 10, 10, 1000, 1000, 1000));
  // %60 tavan × 0.5 sönüm → en fazla 1.30
  assert.ok(trend.katsayi <= 1.3 + 1e-9, `katsayı kırpılmalı, gelen: ${trend.katsayi}`);
});

test('yetersiz veri trendi devre dışı bırakır', () => {
  const trend = hesaplaTuketimTrendi(seri(null, null, null, 100, 200, 300));
  assert.ok(trend.veriAyiSayisi < MIN_TREND_VERI_AYI);
  assert.equal(trend.ivme, 'belirsiz');
  assert.equal(trend.katsayi, 1, 'veri yetersizken tahmin yürütülmemeli');
});

test('veri girilmemiş aylar ortalamayı sıfıra çekmez', () => {
  const trend = hesaplaTuketimTrendi(seri(100, null, 100, 100, null, 100));
  assert.equal(trend.son3Ort, 100);
  assert.equal(trend.onceki3Ort, 100);
});

/* ——— Varlık toplamı ——— */

test('cihaz üstü ve yoldaki sipariş varlığa dahil edilir', () => {
  const sonuc = hesaplaOneri(
    temelGirdi({ anaDepoStok: 39, sahaStok: 100, cihazUstuKutu: 12, acikSiparis: 8 }),
  );
  assert.equal(sonuc.toplamVarlik, 159);
});

test('cihaz üstü stok siparişi azaltır', () => {
  const cihazsiz = hesaplaOneri(temelGirdi({ anaDepoStok: 100 }));
  const cihazli = hesaplaOneri(temelGirdi({ anaDepoStok: 100, cihazUstuKutu: 40 }));
  assert.equal(cihazli.oneriAdet, cihazsiz.oneriAdet - 40);
});

/* ——— Emirler ——— */

test('eksik varlıkta sipariş emri ve doğru adet üretilir', () => {
  // günlük 6 (min/max büyük) × 45 = 270 gerekli, elde 159 → 111
  const sonuc = hesaplaOneri(
    temelGirdi({ anaDepoStok: 39, sahaStok: 100, cihazUstuKutu: 12, acikSiparis: 8 }),
  );
  assert.equal(sonuc.tip, 'siparis');
  assert.equal(sonuc.baslik, 'SİPARİŞ VER');
  assert.equal(sonuc.gerekliAdet, 270);
  assert.equal(sonuc.oneriAdet, 111);
});

test('kapsama kritik eşiğin altındaysa acil emri verilir', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 30 })); // 30/6 = 5 gün
  assert.equal(sonuc.tip, 'acil-siparis');
  assert.equal(sonuc.baslik, 'ACİL SİPARİŞ VER');
});

test('tedarik süresi kritik eşiği yükseltir', () => {
  // 25 günlük kapsama: tedarik süresi yokken normal, 30 günlük tedarikte acil
  const normal = hesaplaOneri(temelGirdi({ anaDepoStok: 150 }));
  const uzunTedarik = hesaplaOneri(temelGirdi({ anaDepoStok: 150, tedarikGun: 30 }));
  assert.equal(normal.tip, 'siparis');
  assert.equal(uzunTedarik.tip, 'acil-siparis');
});

test('hedef karşılanıyorsa sipariş verilmez', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 280 }));
  assert.equal(sonuc.tip, 'yeterli');
  assert.equal(sonuc.oneriAdet, 0);
});

test('hedefin iki katını aşan stok fazla stok uyarısı üretir', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 600 })); // 100 gün
  assert.equal(sonuc.tip, 'fazla-stok');
  assert.equal(sonuc.oneriAdet, 0);
  assert.match(sonuc.aciklama, /miad/i);
});

test('talep sinyali yoksa sipariş değil veri istenir', () => {
  const sonuc = hesaplaOneri(temelGirdi({ gunlukMinMax: 0, gunlukTuketim: 0 }));
  assert.equal(sonuc.tip, 'veri-yok');
  assert.equal(sonuc.oneriAdet, 0);
  assert.equal(sonuc.guvenilirlik, 'dusuk');
});

/* ——— Trendin öneriye etkisi ——— */

test('artan trend öneriyi tabana göre yükseltir', () => {
  const trend = hesaplaTuketimTrendi(seri(80, 80, 80, 120, 120, 120));
  const sonuc = hesaplaOneri(temelGirdi({ trend, anaDepoStok: 100 }));
  assert.ok(sonuc.trendEtkisi > 0, 'trend etkisi pozitif olmalı');
  assert.ok(sonuc.oneriAdet > sonuc.tabanOneriAdet);
});

test('azalan trend öneriyi tabana göre düşürür', () => {
  const trend = hesaplaTuketimTrendi(seri(120, 120, 120, 80, 80, 80));
  const sonuc = hesaplaOneri(temelGirdi({ trend, anaDepoStok: 100 }));
  assert.ok(sonuc.trendEtkisi < 0, 'trend etkisi negatif olmalı');
});

/* ——— Güvenilirlik ve gerekçe ——— */

test('eksik sayım güvenilirliği düşürür ve uyarı üretir', () => {
  const sonuc = hesaplaOneri(temelGirdi({ sayimEksikLab: 3, toplamLab: 10 }));
  assert.notEqual(sonuc.guvenilirlik, 'yuksek');
  assert.ok(sonuc.uyarilar.some(u => u.includes('3/10')));
});

test('her sonuç sayıları içeren tam bir gerekçe taşır', () => {
  const sonuc = hesaplaOneri(
    temelGirdi({ anaDepoStok: 39, sahaStok: 100, cihazUstuKutu: 12 }),
  );
  assert.match(sonuc.aciklama, /Günlük ihtiyaç/);
  assert.match(sonuc.aciklama, /cihaz üstü 12/);
  assert.match(sonuc.aciklama, /gün yeter/);
  assert.ok(sonuc.aciklama.length > 60, 'gerekçe tek cümlelik olmamalı');
});

test('ihtiyaç kaynağı seçimi tabanı belirler', () => {
  const buyuk = hesaplaOneri(temelGirdi({ basis: 'buyuk' }));
  const minmax = hesaplaOneri(temelGirdi({ basis: 'minmax' }));
  const tuketim = hesaplaOneri(temelGirdi({ basis: 'tuketim' }));
  assert.equal(buyuk.tabanGunluk, 6);
  assert.equal(minmax.tabanGunluk, 6);
  assert.equal(tuketim.tabanGunluk, 4);
});

/* ——— Depo çıkışı (irsaliye) sinyali ——— */

test('depo çıkışı diğerlerinden büyükse talebi o belirler', () => {
  const sonuc = hesaplaOneri(temelGirdi({ gunlukCikis: 9 }));
  assert.equal(sonuc.tabanGunluk, 9, 'en büyük sinyal depo çıkışı olmalı');
  assert.match(sonuc.aciklama, /depo çıkışı belirledi/);
});

test('depo çıkışı küçükse tabanı değiştirmez', () => {
  const sonuc = hesaplaOneri(temelGirdi({ gunlukCikis: 2 }));
  assert.equal(sonuc.tabanGunluk, 6);
});

test('depo çıkışı kaynağı tek başına seçilebilir', () => {
  const sonuc = hesaplaOneri(temelGirdi({ basis: 'cikis', gunlukCikis: 9 }));
  assert.equal(sonuc.tabanGunluk, 9);
});

test('depo çıkışı verisi yoksa uyarı üretilir ve hesap bozulmaz', () => {
  const sonuc = hesaplaOneri(temelGirdi({ gunlukCikis: 0 }));
  assert.equal(sonuc.tabanGunluk, 6, 'çıkış verisi yokken diğer sinyaller çalışmalı');
  assert.ok(sonuc.uyarilar.some(u => u.includes('çıkış')));
});

test('kullanıcı örneği: aylık ort. 191 çıkış, 185 varlık → sipariş üretir', () => {
  // 3 aylık çıkış 208 + 158 + 208 = 574 kutu / 90 gün ≈ 6,38 kutu/gün
  const gunlukCikis = (208 + 158 + 208) / 90;
  const sonuc = hesaplaOneri(
    temelGirdi({
      gunlukMinMax: 0,
      gunlukTuketim: 0,
      gunlukCikis,
      hedefGun: 30,
      anaDepoStok: 185,
    }),
  );
  // 30 günlük ihtiyaç ≈ 192; elde 185 → ortalamanın altında kalıyor
  assert.equal(sonuc.tip, 'siparis');
  assert.ok(sonuc.oneriAdet > 0, 'ortalama çıkışın altında kalan stok sipariş üretmeli');
  assert.ok(sonuc.kapsamaGun !== null && sonuc.kapsamaGun < 30);
});

test('öneri hiçbir zaman negatif olmaz', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 100000 }));
  assert.equal(sonuc.oneriAdet, 0);
});

/* ——— Sınırlı depo stoğunun hastanelere dağıtımı ——— */

test('stok yeterliyse herkes ihtiyacının tamamını alır', () => {
  const { paylar, kalanStok, toplamKarsilanamayan } = dagitimYap(
    [
      { id: 'a', ihtiyac: 40, kapsamaGun: 30 },
      { id: 'b', ihtiyac: 60, kapsamaGun: 20 },
    ],
    200,
  );
  assert.deepEqual(paylar.map(p => p.sevkAdedi), [40, 60]);
  assert.equal(kalanStok, 100);
  assert.equal(toplamKarsilanamayan, 0);
});

test('stok kıtken en acil kurum tam karşılanır', () => {
  // Depoda 100 var; b daha acil (5 gün) olduğu için önce o doyurulur.
  const { paylar } = dagitimYap(
    [
      { id: 'a', ihtiyac: 80, kapsamaGun: 40 },
      { id: 'b', ihtiyac: 80, kapsamaGun: 5 },
    ],
    100,
  );
  const a = paylar.find(p => p.id === 'a')!;
  const b = paylar.find(p => p.id === 'b')!;
  assert.equal(b.sevkAdedi, 80, 'acil olan tam karşılanmalı');
  assert.equal(a.sevkAdedi, 20, 'kalan stok diğerine gitmeli');
  assert.equal(a.karsilanamayan, 60);
});

test('stok yoksa hiçbir sevk önerilmez ama ihtiyaç korunur', () => {
  const { paylar, toplamKarsilanamayan } = dagitimYap(
    [{ id: 'a', ihtiyac: 50, kapsamaGun: 10 }],
    0,
  );
  assert.equal(paylar[0].sevkAdedi, 0);
  assert.equal(paylar[0].ihtiyac, 50);
  assert.equal(toplamKarsilanamayan, 50);
});

test('talep sinyali olmayan kurum en sona düşer', () => {
  const { paylar } = dagitimYap(
    [
      { id: 'bilinmeyen', ihtiyac: 50, kapsamaGun: null },
      { id: 'acil', ihtiyac: 50, kapsamaGun: 3 },
    ],
    50,
  );
  assert.equal(paylar.find(p => p.id === 'acil')!.sevkAdedi, 50);
  assert.equal(paylar.find(p => p.id === 'bilinmeyen')!.sevkAdedi, 0);
});

test('dağıtım çağıranın sırasını korur ve toplamı stoğu aşmaz', () => {
  const adaylar = [
    { id: 'x', ihtiyac: 30, kapsamaGun: 25 },
    { id: 'y', ihtiyac: 30, kapsamaGun: 10 },
    { id: 'z', ihtiyac: 30, kapsamaGun: 15 },
  ];
  const { paylar } = dagitimYap(adaylar, 45);
  assert.deepEqual(paylar.map(p => p.id), ['x', 'y', 'z'], 'satır sırası bozulmamalı');
  assert.equal(paylar.reduce((s, p) => s + p.sevkAdedi, 0), 45, 'toplam stoğu aşmamalı');
});

test('aynı girdi her zaman aynı dağıtımı üretir', () => {
  const adaylar = [
    { id: 'a', ihtiyac: 50, kapsamaGun: 10 },
    { id: 'b', ihtiyac: 50, kapsamaGun: 10 },
  ];
  const ilk = dagitimYap(adaylar, 50).paylar.map(p => p.sevkAdedi);
  const ikinci = dagitimYap(adaylar, 50).paylar.map(p => p.sevkAdedi);
  assert.deepEqual(ilk, ikinci);
});

/* ——— Kurum max tavanı ——— */

test('kurum max tanımlıysa öneri tavanı aşmaz', () => {
  // Günlük 6 kutu, 45 gün hedef → 270 gerekli. Elde 20 var → tavansız 250.
  // Kurum max'ı 100 ise yalnızca 80 kutu sevk edilebilir.
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 20, kurumMax: 100 }));
  assert.equal(sonuc.tavansizOneriAdet, 250);
  assert.equal(sonuc.oneriAdet, 80, 'max − eldeki = 80 kutu');
  assert.equal(sonuc.maxKirpma, 170);
});

test('max tavanı yoksa öneri kırpılmaz', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 20 }));
  assert.equal(sonuc.oneriAdet, sonuc.tavansizOneriAdet);
  assert.equal(sonuc.maxKirpma, 0);
});

test('eldeki miktar max ile aynıysa sevk önerilmez', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 100, kurumMax: 100 }));
  assert.equal(sonuc.oneriAdet, 0);
  assert.equal(sonuc.tip, 'yeterli');
  assert.equal(sonuc.baslik, 'SEVK ETME — MAX DOLU');
});

test('cihaz üstü de max tavanına sayılır', () => {
  // 60 kutu stok + 40 kutu cihaz üstü = 100; max 100 → boşluk yok.
  const sonuc = hesaplaOneri(
    temelGirdi({ anaDepoStok: 60, cihazUstuKutu: 40, kurumMax: 100 }),
  );
  assert.equal(sonuc.toplamVarlik, 100);
  assert.equal(sonuc.oneriAdet, 0);
});

test('max kırpması gerekçede ve uyarılarda görünür', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 20, kurumMax: 100 }));
  assert.match(sonuc.aciklama, /max/i);
  assert.ok(
    sonuc.uyarilar.some(u => u.includes('max')),
    'tavan uyarısı listelenmeli',
  );
});

/* ——— Sevk edilen lotların miad riski ——— */

test('miada kadar tüketilemeyen kısım riskli sayılır', () => {
  // Günde 2 kutu, 30 gün sonra dolan lotta 100 kutu: 60 tüketilir, 40 riskli.
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 30, adet: 100 }],
    gunlukIhtiyac: 2,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 40);
  assert.equal(sonuc.detay.length, 1);
  assert.equal(sonuc.detay[0].lot, 'L1');
});

test('miada kadar tamamı tüketilebiliyorsa risk yoktur', () => {
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 90, adet: 100 }],
    gunlukIhtiyac: 2,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 0);
  assert.deepEqual(sonuc.detay, []);
});

test('kurumdaki mevcut stok tüketim sırasını geciktirir ve riski artırır', () => {
  // Aynı lot, ama kurumda önce tüketilecek 40 kutu daha var: lot 20. günde
  // açılır, miada 10 gün kalır → yalnızca 20 kutu tüketilebilir, 80 riskli.
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 30, adet: 100 }],
    gunlukIhtiyac: 2,
    mevcutStok: 40,
  });
  assert.equal(sonuc.riskliAdet, 80);
});

test('lotlar FEFO sırasıyla değerlendirilir', () => {
  // Günde 10 kutu. Yakın miatlı lot (20 gün) önce tüketilir ve tamamı erir;
  // uzak miatlı lot (60 gün) 10. günde açılır, 50 günde 500 kutu tüketilebilir.
  const sonuc = hesaplaRiskliSevk({
    lotlar: [
      { lot: 'UZAK', miatGun: 60, adet: 400 },
      { lot: 'YAKIN', miatGun: 20, adet: 100 },
    ],
    gunlukIhtiyac: 10,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 0, 'FEFO ile ikisi de zamanında tükenir');
  assert.equal(sonuc.enYakinMiatGun, 20);
});

test('miadı geçmiş lotun tamamı risklidir', () => {
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'GECMIS', miatGun: -5, adet: 30 }],
    gunlukIhtiyac: 10,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 30);
});

test('miadı bilinmeyen lot riske sayılmaz ama ayrıca raporlanır', () => {
  const sonuc = hesaplaRiskliSevk({
    lotlar: [
      { lot: 'BILINMEYEN', miatGun: null, adet: 25 },
      { lot: 'L1', miatGun: 90, adet: 10 },
    ],
    gunlukIhtiyac: 2,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 0);
  assert.equal(sonuc.degerlendirilemeyenAdet, 25);
  assert.equal(sonuc.enYakinMiatGun, 90);
});

test('talep sinyali yoksa risk hesaplanmaz, tamamı değerlendirilemedi sayılır', () => {
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 10, adet: 40 }],
    gunlukIhtiyac: 0,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 0);
  assert.equal(sonuc.degerlendirilemeyenAdet, 40);
});

test('riskli adet hiçbir zaman lot adedini aşmaz', () => {
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 1, adet: 5 }],
    gunlukIhtiyac: 0.01,
    mevcutStok: 1000,
  });
  assert.equal(sonuc.riskliAdet, 5);
});

test('stok yönetimi panelindeki tek satır formülüne indirgenir', () => {
  // Panel: dailyNeed = max/maxGun = 100/30 ≈ 3,33; stok 200, miat 30 gün.
  // Tüketilebilir = 30 × 3,33 = 100 → riskli ≈ 100 kutu.
  const gunlukIhtiyac = 100 / 30;
  const sonuc = hesaplaRiskliSevk({
    lotlar: [{ lot: 'L1', miatGun: 30, adet: 200 }],
    gunlukIhtiyac,
    mevcutStok: 0,
  });
  assert.equal(sonuc.riskliAdet, 100);
});
