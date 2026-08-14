import assert from "node:assert/strict";
import test from "node:test";

import {
  depotStorageKey,
  getDepot,
  hasDepot,
  resetDepotStoreForTests,
  setDepot,
  subscribeToDepot,
} from "../src/lib/terminal-depot-store";

test("depotStorageKey şirkete göre ayrışır", () => {
  assert.notEqual(depotStorageKey("firma-a"), depotStorageKey("firma-b"));
  // Şirket bilinmiyorsa da kararlı bir anahtar üretilmeli.
  assert.equal(depotStorageKey(null), depotStorageKey(undefined));
});

test("hiç yazılmamış anahtar boş döner", () => {
  resetDepotStoreForTests();
  const key = depotStorageKey("firma-a");
  assert.equal(hasDepot(key), false);
  assert.equal(getDepot(key), "");
});

/**
 * ASIL REGRESYON.
 *
 * Ana ekran depoyu seçtiğinde önyükleme sağlayıcısı bunu DUYMAYINCA, depoya
 * bağlı koleksiyonlar (depoStok, orders) o oturumda hiç dinlenmiyordu:
 * transfer ekranı "Depo stoğu yükleniyor"da takılıyor ve okutulan her ürün
 * "bu depoda değil" cevabı alıyordu. Değer bileşen state'inde tutulduğu için
 * her kullanan kendi kopyasını taşıyordu.
 */
test("bir yerde yapılan seçimi tüm aboneler görür", () => {
  resetDepotStoreForTests();
  const key = depotStorageKey("firma-a");

  const anaEkran: string[] = [];
  const onyukleme: string[] = [];

  subscribeToDepot(key, value => anaEkran.push(value));
  subscribeToDepot(key, value => onyukleme.push(value));

  setDepot(key, "depo-1");

  assert.deepEqual(anaEkran, ["depo-1"]);
  assert.deepEqual(onyukleme, ["depo-1"]);
  assert.equal(getDepot(key), "depo-1");
});

test("abonelik bırakıldıktan sonra bildirim gelmez", () => {
  resetDepotStoreForTests();
  const key = depotStorageKey("firma-a");

  const seen: string[] = [];
  const unsubscribe = subscribeToDepot(key, value => seen.push(value));

  setDepot(key, "depo-1");
  unsubscribe();
  setDepot(key, "depo-2");

  assert.deepEqual(seen, ["depo-1"]);
  // Kutu güncel kalmalı; yalnızca bu dinleyici sustu.
  assert.equal(getDepot(key), "depo-2");
});

test("farklı şirketlerin seçimleri birbirine karışmaz", () => {
  resetDepotStoreForTests();
  const a = depotStorageKey("firma-a");
  const b = depotStorageKey("firma-b");

  const seenB: string[] = [];
  subscribeToDepot(b, value => seenB.push(value));

  setDepot(a, "depo-1");

  assert.equal(getDepot(a), "depo-1");
  assert.equal(getDepot(b), "");
  assert.deepEqual(seenB, []);
});

test("depo seçimi temizlenebilir", () => {
  resetDepotStoreForTests();
  const key = depotStorageKey("firma-a");

  setDepot(key, "depo-1");
  setDepot(key, "");

  assert.equal(getDepot(key), "");
  // Anahtar yazılmış sayılır: kalıcı depodan tekrar okumaya gerek yok.
  assert.equal(hasDepot(key), true);
});
