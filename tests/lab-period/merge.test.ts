import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alanHaritasi,
  birlestir,
  bosSnapshot,
  kaynakOzeti,
  kronolojikBirlestir,
  olcumSayisi,
} from '../../src/lib/lab-period/merge';
import {
  donemAnahtari,
  KAYNAK_ADI,
  snapshotDocId,
  type OlcumGirdisi,
} from '../../src/lib/lab-period/types';

const bos = () => bosSnapshot('firma1', 'lab1', 'A Laboratuvarı', 2026, 6);
const girdi = (stokKodu: string, deger: number, alan: OlcumGirdisi['alan'] = 'stok'): OlcumGirdisi => ({
  stokKodu,
  alan,
  deger,
});

/* ——— İlk sayım ——— */

test('boş alana gelen ilk değer sayımı kurar', () => {
  const { snapshot, eklenen, guncellenen } = birlestir(bos(), [girdi('A1', 12)], {
    kaynak: 'lab-sayim',
    zaman: 1000,
  });
  assert.equal(eklenen, 1);
  assert.equal(guncellenen, 0);
  assert.equal(snapshot.stok.A1.deger, 12);
  assert.equal(snapshot.stok.A1.ilkKaynak, 'lab-sayim');
  assert.equal(snapshot.stok.A1.duzenlemeSayisi, 0);
});

test('ilk sayımı yapan panel sonradan düzenlense de korunur', () => {
  const ilk = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  const sonra = birlestir(ilk, [girdi('A1', 15)], { kaynak: 'total-verimlilik', zaman: 2000 }).snapshot;
  assert.equal(sonra.stok.A1.ilkKaynak, 'lab-sayim', 'ilk sayan panel değişmemeli');
  assert.equal(sonra.stok.A1.kaynak, 'total-verimlilik', 'son düzenleyen güncellenmeli');
  assert.equal(sonra.stok.A1.ilkKayitZamani, 1000);
  assert.equal(sonra.stok.A1.guncellemeZamani, 2000);
});

/* ——— Değiştirmeden kaydetme ——— */

test('aynı değeri yazan panel sayımın sahibini değiştirmez', () => {
  const ilk = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  const sonuc = birlestir(ilk, [girdi('A1', 12)], { kaynak: 'maliyet-sayim', zaman: 2000 });
  assert.equal(sonuc.degismeyen, 1);
  assert.equal(sonuc.guncellenen, 0);
  assert.equal(sonuc.snapshot.stok.A1.kaynak, 'lab-sayim', 'dokunulmamalı');
  assert.equal(sonuc.snapshot.stok.A1.duzenlemeSayisi, 0);
});

test('hiçbir şey değişmediyse güncelleme zamanı ilerlemez', () => {
  const ilk = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  const sonuc = birlestir(ilk, [girdi('A1', 12)], { kaynak: 'maliyet-sayim', zaman: 2000 });
  assert.equal(sonuc.snapshot.guncellemeZamani, 1000);
});

/* ——— Düzenleme ——— */

test('farklı değer düzenleme sayılır ve raporlanır', () => {
  const ilk = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  const sonuc = birlestir(ilk, [girdi('A1', 15)], { kaynak: 'total-verimlilik', zaman: 2000 });
  assert.equal(sonuc.guncellenen, 1);
  assert.equal(sonuc.snapshot.stok.A1.deger, 15);
  assert.equal(sonuc.snapshot.stok.A1.duzenlemeSayisi, 1);
  assert.deepEqual(sonuc.degisiklikler, [
    {
      stokKodu: 'A1',
      alan: 'stok',
      eskiDeger: 12,
      yeniDeger: 15,
      eskiKaynak: 'lab-sayim',
      yeniKaynak: 'total-verimlilik',
    },
  ]);
});

test('art arda düzenlemeler sayılır', () => {
  let snap = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  snap = birlestir(snap, [girdi('A1', 15)], { kaynak: 'total-verimlilik', zaman: 2000 }).snapshot;
  snap = birlestir(snap, [girdi('A1', 20)], { kaynak: 'maliyet-sayim', zaman: 3000 }).snapshot;
  assert.equal(snap.stok.A1.deger, 20);
  assert.equal(snap.stok.A1.duzenlemeSayisi, 2);
  assert.equal(snap.stok.A1.ilkKaynak, 'lab-sayim');
});

/* ——— Alanların bağımsızlığı ——— */

test('farklı alanlar birbirini ezmez', () => {
  let snap = birlestir(bos(), [girdi('A1', 12, 'stok')], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  snap = birlestir(snap, [girdi('A1', 2500, 'cihazUstu')], {
    kaynak: 'cihaz-ustu-hesaplama',
    zaman: 2000,
  }).snapshot;
  snap = birlestir(snap, [girdi('A1', 4000, 'kumulatif')], {
    kaynak: 'kumulatif-hesaplama',
    zaman: 3000,
  }).snapshot;
  assert.equal(snap.stok.A1.deger, 12);
  assert.equal(snap.cihazUstu.A1.deger, 2500);
  assert.equal(snap.kumulatif.A1.deger, 4000);
  assert.equal(olcumSayisi(snap), 3);
});

test('bir panel yalnızca taşıdığı alanları yazar', () => {
  // Cihaz üstü paneli stok yazmaz; stok alanı boş kalmalı.
  const snap = birlestir(bos(), [girdi('A1', 2500, 'cihazUstu')], {
    kaynak: 'cihaz-ustu-hesaplama',
    zaman: 1000,
  }).snapshot;
  assert.equal(snap.stok.A1, undefined);
});

/* ——— Geçersiz veri ——— */

test('geçersiz değerler yazılmaz', () => {
  const sonuc = birlestir(
    bos(),
    [
      girdi('A1', Number.NaN),
      girdi('A2', -5),
      { stokKodu: '', alan: 'stok', deger: 10 },
      { stokKodu: 'A3', alan: 'yok' as never, deger: 10 },
    ],
    { kaynak: 'lab-sayim', zaman: 1000 },
  );
  assert.equal(sonuc.eklenen, 0);
  assert.equal(olcumSayisi(sonuc.snapshot), 0);
});

test('sıfır geçerli bir sayımdır', () => {
  const sonuc = birlestir(bos(), [girdi('A1', 0)], { kaynak: 'lab-sayim', zaman: 1000 });
  assert.equal(sonuc.eklenen, 1);
  assert.equal(sonuc.snapshot.stok.A1.deger, 0);
});

test('birleştirme girdiyi değiştirmez', () => {
  const onceki = bos();
  birlestir(onceki, [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 });
  assert.deepEqual(onceki.stok, {}, 'kaynak snapshot bozulmamalı');
});

/* ——— Geriye dönük aktarım ——— */

test('kronolojik aktarımda en eski kayıt ilk sayım olur', () => {
  // Kayıtlar ters sırada verilse bile zaman sırasına göre işlenir.
  const sonuc = kronolojikBirlestir(bos(), [
    { girdiler: [girdi('A1', 15)], baglam: { kaynak: 'total-verimlilik', kaynakKayitId: 'tv1', zaman: 3000 } },
    { girdiler: [girdi('A1', 12)], baglam: { kaynak: 'lab-sayim', kaynakKayitId: 'ls1', zaman: 1000 } },
  ]);
  assert.equal(sonuc.snapshot.stok.A1.ilkKaynak, 'lab-sayim', 'en eski kayıt sahip olmalı');
  assert.equal(sonuc.snapshot.stok.A1.deger, 15, 'sonraki düzenleme geçerli olmalı');
  assert.equal(sonuc.snapshot.stok.A1.duzenlemeSayisi, 1);
});

test('aktarım tekrar çalıştırıldığında sonuç değişmez', () => {
  const partiler = [
    { girdiler: [girdi('A1', 12)], baglam: { kaynak: 'lab-sayim' as const, kaynakKayitId: 'ls1', zaman: 1000 } },
    { girdiler: [girdi('A1', 15)], baglam: { kaynak: 'total-verimlilik' as const, kaynakKayitId: 'tv1', zaman: 3000 } },
  ];
  const ilk = kronolojikBirlestir(bos(), partiler).snapshot;
  const ikinci = kronolojikBirlestir(ilk, partiler);
  assert.equal(ikinci.guncellenen, 0, 'ikinci geçişte düzenleme olmamalı');
  assert.equal(ikinci.snapshot.stok.A1.deger, 15);
  assert.equal(ikinci.snapshot.stok.A1.duzenlemeSayisi, 1, 'düzenleme sayısı şişmemeli');
});

test('aktarımın tekrarı aradaki canlı düzenlemeyi geri almaz', () => {
  const partiler = [
    { girdiler: [girdi('A1', 12)], baglam: { kaynak: 'lab-sayim' as const, kaynakKayitId: 'ls1', zaman: 1000 } },
  ];
  const aktarilmis = kronolojikBirlestir(bos(), partiler).snapshot;
  // Kullanıcı aktarımdan sonra paneli açıp değeri düzeltiyor.
  const duzeltilmis = birlestir(aktarilmis, [girdi('A1', 20)], {
    kaynak: 'maliyet-sayim',
    zaman: 5000,
  }).snapshot;
  // Aktarım yeniden çalıştırılıyor.
  const tekrar = kronolojikBirlestir(duzeltilmis, partiler);
  assert.equal(tekrar.snapshot.stok.A1.deger, 20, 'canlı düzenleme korunmalı');
  assert.equal(tekrar.guncellenen, 0);
});

test('aktarıma yeni gelen kaynak kaydı işlenir', () => {
  const ilkParti = [
    { girdiler: [girdi('A1', 12)], baglam: { kaynak: 'lab-sayim' as const, kaynakKayitId: 'ls1', zaman: 1000 } },
  ];
  const aktarilmis = kronolojikBirlestir(bos(), ilkParti).snapshot;
  const ikinciParti = [
    ...ilkParti,
    { girdiler: [girdi('A2', 8)], baglam: { kaynak: 'lab-sayim' as const, kaynakKayitId: 'ls2', zaman: 2000 } },
  ];
  const sonuc = kronolojikBirlestir(aktarilmis, ikinciParti);
  assert.equal(sonuc.eklenen, 1, 'yalnızca yeni kayıt işlenmeli');
  assert.equal(sonuc.snapshot.stok.A2.deger, 8);
});

/* ——— Okuma yardımcıları ——— */

test('alan haritası yalın stokKodu -> değer döndürür', () => {
  const snap = birlestir(bos(), [girdi('A1', 12), girdi('A2', 7)], {
    kaynak: 'lab-sayim',
    zaman: 1000,
  }).snapshot;
  assert.deepEqual(alanHaritasi(snap, 'stok'), { A1: 12, A2: 7 });
  assert.deepEqual(alanHaritasi(snap, 'kumulatif'), {});
  assert.deepEqual(alanHaritasi(undefined, 'stok'), {});
});

test('kaynak özeti kimin girdiğini ve düzenlediğini söyler', () => {
  const ilk = birlestir(bos(), [girdi('A1', 12)], { kaynak: 'lab-sayim', zaman: 1000 }).snapshot;
  assert.equal(kaynakOzeti(ilk.stok.A1, KAYNAK_ADI), 'Lab Sayım tarafından girildi');

  const sonra = birlestir(ilk, [girdi('A1', 15)], { kaynak: 'total-verimlilik', zaman: 2000 }).snapshot;
  assert.match(kaynakOzeti(sonra.stok.A1, KAYNAK_ADI), /Lab Sayım tarafından girildi/);
  assert.match(kaynakOzeti(sonra.stok.A1, KAYNAK_ADI), /Total Verimlilik tarafından güncellendi/);
  assert.equal(kaynakOzeti(undefined, KAYNAK_ADI), 'Veri yok');
});

/* ——— Kimlikler ——— */

test('doküman kimliği şirket-lab-dönem üçlüsünde tekildir', () => {
  assert.equal(snapshotDocId('firma1', 'lab1', '2026-06'), 'firma1__lab1__2026-06');
  assert.equal(snapshotDocId('', 'lab1', '2026-06'), '__legacy____lab1__2026-06');
  assert.ok(!snapshotDocId('a/b', 'lab1', '2026-06').includes('/'), 'eğik çizgi kimliği bölmemeli');
});

test('dönem anahtarı sıfır dolgulu YYYY-MM üretir', () => {
  assert.equal(donemAnahtari(2026, 6), '2026-06');
  assert.equal(donemAnahtari(2026, 12), '2026-12');
});
