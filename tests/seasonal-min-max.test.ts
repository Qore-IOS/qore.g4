import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveMinMaxPeriod,
  normalizePeriodId,
  resolveSeasonalMinMaxRule,
  seasonalMinMaxPatch,
  seasonalMinMaxStale,
} from '../src/lib/seasonal-min-max';

const config = {
  periods: [{ id: 'kis', name: 'Kış' }, { id: 'yaz', name: 'Yaz' }],
  monthPeriodMap: { 1: 'kis', 7: 'yaz' },
};

test('getActiveMinMaxPeriod selects the period assigned to the current month', () => {
  assert.deepEqual(getActiveMinMaxPeriod(config, new Date(2026, 0, 15)), { id: 'kis', name: 'Kış' });
  assert.deepEqual(getActiveMinMaxPeriod(config, new Date(2026, 6, 15)), { id: 'yaz', name: 'Yaz' });
});

test('resolveSeasonalMinMaxRule uses seasonal values and preserves other rule fields', () => {
  const result = resolveSeasonalMinMaxRule({ stokKodu: 'R1', min: 1, max: 2, maxGun: 30, donemDegerleri: { kis: { min: 10, max: 20 }, yaz: { min: 4, max: 8 } } }, config, new Date(2026, 6, 1));
  assert.equal(result.min, 4);
  assert.equal(result.max, 8);
  assert.equal(result.maxGun, 30);
});

test('normalizePeriodId creates stable Turkish-compatible ids', () => {
  assert.equal(normalizePeriodId('  Kış Dönemi  '), 'kis-donemi');
});

/* ——— Dönem geçişinde düz alanların yenilenmesi ——— */

const kural = (min: number, max: number) => ({
  stokKodu: 'R1',
  min,
  max,
  maxGun: 30,
  donemDegerleri: { kis: { min: 10, max: 20 }, yaz: { min: 4, max: 8 } },
});

test('düz alanlar aktif dönemle uyuşuyorsa eskimiş sayılmaz', () => {
  assert.equal(seasonalMinMaxStale(kural(10, 20), config, new Date(2026, 0, 15)), false);
  assert.equal(seasonalMinMaxPatch(kural(10, 20), config, new Date(2026, 0, 15)), null);
});

test('dönem değiştiğinde düz alanlar eskimiş sayılır ve yama üretilir', () => {
  // Kış değerleriyle kaydedilmiş kural, Temmuz'da açılıyor.
  const kis = kural(10, 20);
  assert.equal(seasonalMinMaxStale(kis, config, new Date(2026, 6, 15)), true);
  assert.deepEqual(seasonalMinMaxPatch(kis, config, new Date(2026, 6, 15)), {
    min: 4,
    max: 8,
    aktifDonemId: 'yaz',
  });
});

test('dönem içinde tanım düzeltilirse de yama üretilir', () => {
  // Aktif dönem aynı (kış) ama düz alanlar tanımdan farklı — elle değiştirilmiş.
  const bozuk = kural(99, 99);
  assert.equal(seasonalMinMaxStale(bozuk, config, new Date(2026, 0, 15)), true);
  assert.deepEqual(seasonalMinMaxPatch(bozuk, config, new Date(2026, 0, 15)), {
    min: 10,
    max: 20,
    aktifDonemId: 'kis',
  });
});

test('dönemsel tanımı olmayan kural asla dokunulmaz', () => {
  const donemsiz = { stokKodu: 'R2', min: 5, max: 9, maxGun: 30 };
  assert.equal(seasonalMinMaxStale(donemsiz, config, new Date(2026, 6, 15)), false);
  assert.equal(seasonalMinMaxPatch(donemsiz, config, new Date(2026, 6, 15)), null);
});

test('yama yalnızca min/max taşır — maxGün ve diğer alanlar korunur', () => {
  const yama = seasonalMinMaxPatch(kural(10, 20), config, new Date(2026, 6, 15));
  assert.deepEqual(Object.keys(yama!).sort(), ['aktifDonemId', 'max', 'min']);
});
