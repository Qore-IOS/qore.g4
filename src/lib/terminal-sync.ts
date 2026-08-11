/**
 * @fileoverview Elle senkron — "her şey gitti mi?" sorusunun tek cevabı.
 *
 * NEDEN GEREKLİ
 *
 * Firestore kuyruğunu kendisi boşaltır ve normalde buna dokunmak gerekmez.
 * Ama sahada iki gerçek durum var:
 *
 *  1. BAYAT BAĞLANTI. Cihaz ağa yeniden bağlandığında (Wi-Fi geri geldi,
 *     kapsama alanına girildi) açık kalan soket ölü olabilir; SDK bunu kendi
 *     zaman aşımıyla fark edene kadar kuyruk beklemeye devam eder. Ağı kapatıp
 *     açmak yeni bir bağlantı kurmaya zorlar ve gönderim anında başlar.
 *
 *  2. YANILAN SAYAÇ. Bekleyen işlemler defteri (`pending-operations.ts`) bir
 *     kaydı, yazımı başlatan sözün çözülmesiyle "gönderildi"ye çevirir. O söz
 *     uygulama kapanınca kaybolur. Yazımın kendisi kaybolmaz — Firestore'un
 *     kuyruğu kalıcıdır ve uygulama açılınca gönderir — ama defterdeki kayıt
 *     sonsuza kadar "bekliyor"da takılı kalır. Kullanıcı gitmiş bir işlemi
 *     gitmemiş sanır.
 *
 * `waitForPendingWrites()` tam bu iş için var: TÜM bekleyen yazımlar sunucu
 * tarafından onaylandığında çözülür. Çözüldüğü anda defterde "bekliyor"da
 * kalmış ne varsa gerçekten gitmiştir ve güvenle "gönderildi" işaretlenir.
 */

'use client';

import { disableNetwork, enableNetwork, waitForPendingWrites } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { listPendingOperations, markOperationSent } from '@/lib/pending-operations';

export type SyncResult = {
  /** Bu turda "gönderildi"ye çevrilen kayıt sayısı. */
  reconciled: number;
  /** Zaman aşımına uğradı mı (bağlantı yok ya da çok yavaş)? */
  timedOut: boolean;
};

/**
 * Elle eşitlemede beklenecek en uzun süre.
 *
 * Çevrimdışıyken `waitForPendingWrites()` ASLA çözülmez — sonsuza kadar
 * beklemek düğmeyi kalıcı bir dönen çarka çevirirdi. 15 saniye, zayıf bir
 * bağlantıda birkaç yüz belgenin gitmesine yetecek kadar uzun; kullanıcıyı
 * ekran başında tutmayacak kadar kısa.
 */
const SYNC_TIMEOUT_MS = 15_000;

/**
 * Defterdeki "bekliyor" kayıtlarını, yazımların onaylandığı DOĞRULANDIKTAN
 * sonra "gönderildi" yapar.
 */
function reconcileLedger(): number {
  const stale = listPendingOperations().filter(op => op.status === 'pending');
  stale.forEach(op => markOperationSent(op.id));
  return stale.length;
}

/**
 * Bekleyen tüm yazımların gitmesini bekler ve defteri düzeltir.
 *
 * Ağı kapatıp açmaz — bkz. `forceResync()`. Bu sürüm uygulama açılışında
 * sessizce çalıştırılmak içindir.
 */
export async function reconcilePendingWrites(): Promise<SyncResult> {
  let timedOut = false;

  await Promise.race([
    waitForPendingWrites(db).catch(() => {
      // Ağ kapatıldığında söz reddedilebilir; bu bir hata değil, "şimdi değil".
      timedOut = true;
    }),
    new Promise<void>(resolve =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, SYNC_TIMEOUT_MS),
    ),
  ]);

  // Onay gelmediyse defter OLDUĞU GİBİ bırakılır. Gitmemiş bir işlemi
  // "gönderildi" göstermek, bu ekrandaki tek gerçek tehlike.
  return { reconciled: timedOut ? 0 : reconcileLedger(), timedOut };
}

/**
 * Elle eşitleme: bağlantıyı tazeler, kuyruğun boşalmasını bekler, defteri
 * düzeltir.
 *
 * @throws Ağ katmanı hiç açılamazsa hatayı aynen fırlatır.
 */
export async function forceResync(): Promise<SyncResult> {
  /**
   * Kapat–aç turu BİLEREK yapılıyor.
   *
   * `enableNetwork` tek başına, zaten "açık" sayılan ama karşı tarafı ölmüş
   * bir bağlantıyı tazelemez. `disableNetwork` ile açıkça kapatmak SDK'nın
   * durumunu sıfırlar ve `enableNetwork` yeni bir oturum açar. Bekleyen
   * yazımlar bu turda kaybolmaz; kuyruk kalıcıdır.
   */
  await disableNetwork(db);
  await enableNetwork(db);

  return reconcilePendingWrites();
}
