/**
 * `src/lib/date.ts` — metinsel tarih çözümü.
 *
 * Buradaki asıl regresyon `dd.MM.yyyy` metinlerinin gün/ay sırasıdır.
 * `toDateSafe` eskiden metni önce `new Date(str)`'e veriyordu; V8'in hoşgörülü
 * ayrıştırıcısı `"01.02.2027"` değerini ABD kuralıyla 2 Ocak 2027 olarak
 * kabul ediyor, yani günü 12'den küçük her tarihte gün ile ay yer
 * değiştiriyordu. `depoStok.miad` tam olarak bu biçimde saklandığı için hata
 * hem miad gösterimini hem FEFO sıralamasını bozuyordu.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareMiadAsc, formatMiad, toDateSafe } from '../src/lib/date.js';

const gun = (d: Date | undefined) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);

describe('toDateSafe — metinsel tarihler', () => {
  it('nokta ile ayrılmış TR tarihini gün önde okur', () => {
    assert.equal(gun(toDateSafe('01.02.2027')), '2027-2-1');
    assert.equal(gun(toDateSafe('05.11.2026')), '2026-11-5');
    assert.equal(gun(toDateSafe('12.12.2027')), '2027-12-12');
    assert.equal(gun(toDateSafe('31.12.2027')), '2027-12-31');
  });

  it('eğik çizgi ve tire ayraçlarını da TR kuralıyla okur', () => {
    assert.equal(gun(toDateSafe('01/02/2027')), '2027-2-1');
    assert.equal(gun(toDateSafe('01-02-2027')), '2027-2-1');
  });

  it('tek haneli gün/ay kabul eder', () => {
    assert.equal(gun(toDateSafe('1.2.2027')), '2027-2-1');
  });

  it('ISO biçimini bozmaz', () => {
    assert.equal(gun(toDateSafe('2027-12-31')), '2027-12-31');
    assert.equal(gun(toDateSafe('20271231')), '2027-12-31');
  });

  it('takvimde olmayan günü reddeder', () => {
    // `new Date(2027, 1, 31)` sessizce 3 Mart'a taşardı.
    assert.equal(toDateSafe('31.02.2027'), undefined);
    assert.equal(toDateSafe('32.01.2027'), undefined);
    assert.equal(toDateSafe('01.13.2027'), undefined);
  });

  it('çözülemeyen değerlerde undefined döner', () => {
    assert.equal(toDateSafe(''), undefined);
    assert.equal(toDateSafe('yok'), undefined);
    assert.equal(toDateSafe(null), undefined);
    assert.equal(toDateSafe(undefined), undefined);
  });

  it('Date ve toDate() sunan değerleri korur', () => {
    const d = new Date(2027, 1, 1);
    assert.equal(gun(toDateSafe(d)), '2027-2-1');
    assert.equal(gun(toDateSafe({ toDate: () => d } as never)), '2027-2-1');
  });
});

describe('formatMiad', () => {
  it('gün/ay sırasını koruyarak geri yazar', () => {
    assert.equal(formatMiad('01.02.2027'), '01.02.2027');
    assert.equal(formatMiad('05.11.2026'), '05.11.2026');
  });

  it('çözülemeyen değerde fallback döner', () => {
    assert.equal(formatMiad('', ''), '');
    assert.equal(formatMiad(null), '-');
  });
});

describe('compareMiadAsc', () => {
  it('erken miadı öne alır', () => {
    assert.ok(compareMiadAsc('05.01.2027', '01.02.2027') < 0);
    assert.ok(compareMiadAsc('01.02.2027', '05.01.2027') > 0);
    assert.equal(compareMiadAsc('01.02.2027', '01.02.2027'), 0);
  });

  it('boş miadı sona atar', () => {
    assert.ok(compareMiadAsc('', '01.02.2027') > 0);
    assert.ok(compareMiadAsc('01.02.2027', '') < 0);
  });
});
