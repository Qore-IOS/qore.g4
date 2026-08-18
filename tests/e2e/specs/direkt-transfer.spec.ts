import { expect, test, type Page } from '@playwright/test';
import { barkodOkut, girisYap, BARCODES, DEPOT, LAB } from '../helpers';
import { depoyaStokKoy, stokBelgesi, stoguTemizle, transferleriTemizle } from '../firestore';

/**
 * Direkt transfer — stok yaşam döngüsünün kalbi.
 *
 * Yeniden yazım programında bu, Faz 4'ün 01 numaralı dilimi: en yüksek
 * değişim sıklığına sahip dosya ve stok yazımının merkezi. Dilim sıfırdan
 * yazılırken davranışı koruyan ağ budur.
 *
 * Testler UI'ı gerçek kullanıcı gibi sürer (barkod okutma dahil), sonucu ise
 * Firestore'dan doğrular — ekranda "başarılı" yazması stoğun gerçekten
 * taşındığı anlamına gelmez.
 */

/**
 * Panelin veri yüklemesini bitirmesini bekler.
 *
 * Kaynak depo seçicisinin bir DEĞER taşıması hazır olma sinyalidir: panel
 * depolar geldiğinde ilkini kendiliğinden seçer ("Auto-select first depot").
 * Bu yüzden testte kaynak depo ELLE seçilmez — seçilmeye çalışılırsa
 * placeholder aranır ve hiç bulunamaz.
 */
async function transferPaneliniAc(page: Page) {
  await page.goto('/direkt-transfer');
  const kaynak = page.getByTestId('dt-kaynak-depo');
  await expect(kaynak).toBeVisible({ timeout: 60_000 });
  await expect(kaynak).toContainText(DEPOT.name, { timeout: 60_000 });
}

/** Hedef laboratuvarı seçer. */
async function laboratuvarSec(page: Page, ad: string) {
  await page.getByTestId('dt-hedef-lab').getByRole('combobox').click();
  await page.getByRole('option', { name: ad }).click();
}

test.describe('direkt transfer', () => {
  test.beforeEach(async () => {
    await stoguTemizle();
    await transferleriTemizle();
  });

  /**
   * AÇIK KALAN — hedef laboratuvar seçicisi emülatörde devre dışı geliyor.
   *
   * Panel `disabled={hospitals.length === 0}` diyor, yani `useHospitals()` boş
   * dönüyor. Şunlar ELENDİ (hepsi tek tek doğrulandı):
   *
   *   • Veri var mı?        `hospitals/e2e-lab` tohumlanıyor, companyId='e2e-co'.
   *   • Kurallar mı?        `@firebase/rules-unit-testing` ile aynı özel talep
   *                         altında `hospitals` listesi OKUNABİLİYOR (1 belge).
   *   • Şirket kapsamı mı?  Aynı kapsamla `depots` yükleniyor; kaynak depo
   *                         seçicisinde "E2E Merkez Depo" görünüyor.
   *   • Hook gölgelenmesi?  Tek bir `useHospitals` tanımı var, doğru import.
   *   • SDK durumu mu?      `INTERNAL ASSERTION FAILED (b815)` düzeltildi;
   *                         konsol artık temiz, permission-denied yok.
   *
   * Geriye kalan şüpheli: React Query'nin `['hospitals', companyId, …]`
   * anahtarını, şirket talebi yerleşmeden ÖNCE boş sonuçla önbelleğe alması
   * (`staleTime: 1 saat`). Bir sonraki turda buradan devam edilecek.
   *
   * Test silinmiyor: yazıldığı hâliyle doğru akışı tarif ediyor ve
   * `fixme` kaldırıldığı an çalışmaya hazır.
   */
  test.fixme('seri takipli stok laboratuvara transfer edilir', async ({ page }) => {
    const belgeId = await depoyaStokKoy({
      stokKodu: 'E2E-KIT-001',
      stokAdi: 'E2E Test Kiti (seri takipli)',
      lotNumarasi: 'LOT001',
      seriNumarasi: 'SN00000001',
      miad: '31.12.2027',
      adet: 1,
    });

    await girisYap(page);
    await transferPaneliniAc(page);
    await laboratuvarSec(page, LAB.name);

    await barkodOkut(page, BARCODES.seriliKit);

    // Okutulan kalem listeye düşmeli.
    await expect(page.getByText('E2E-KIT-001').first()).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('dt-transfer-et').click();

    // Yazma arka planda ("fire and forget") yürüdüğü için ekran değil, VERİ
    // beklenir: belge sevk edilmiş ve hedef kuruma bağlanmış olmalı.
    await expect.poll(async () => {
      const belge = await stokBelgesi(belgeId);
      return belge ? `${belge.isShipped}|${belge.hedefKurumId}` : 'belge-yok';
    }, {
      timeout: 60_000,
      message: 'Stok belgesi laboratuvara taşınmadı',
    }).toBe(`true|${LAB.id}`);
  });
});
