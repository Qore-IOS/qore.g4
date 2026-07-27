import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hesaplaOneri,
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

test('öneri hiçbir zaman negatif olmaz', () => {
  const sonuc = hesaplaOneri(temelGirdi({ anaDepoStok: 100000 }));
  assert.equal(sonuc.oneriAdet, 0);
});
