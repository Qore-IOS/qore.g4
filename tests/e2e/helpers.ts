import { expect, type Page } from '@playwright/test';

// Tohumla tek kaynaktan paylaşılan sabitler — testler kendi kopyalarını
// tutmaz, aksi hâlde tohum değişince testler sessizce yanlış veriye bakar.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require('./seed.js') as {
  USER: { email: string; password: string; name: string };
  DEPOT: { id: string; name: string };
  LAB: { id: string; name: string };
  BARCODES: Record<string, string>;
};

export const { USER, DEPOT, LAB, BARCODES } = seed;

/**
 * Oturum açar ve korumalı alana girildiğini doğrular.
 *
 * Gerçek giriş formu kullanılır (test-only bir bypass değil): oturum açma,
 * özel talep (custom claim) okuma ve şirket kapsamının kurulması bu akışın
 * parçası ve regresyona en açık yerlerden biri.
 */
export async function girisYap(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Bir panelin veri yüklemesini bitirmesini bekler.
 *
 * Paneller açılışta "hazırlanıyor" durumunda kalır ve erken yapılan bir
 * tıklama sessizce kaybolur (bkz. direkt transfer `transferDataReady`).
 * Bu yüzden testler sabit `waitForTimeout` yerine gerçek hazır sinyalini
 * bekler.
 */
export async function panelHazir(page: Page, hazirIsaret: RegExp | string): Promise<void> {
  await expect(page.getByText(hazirIsaret).first()).toBeVisible({ timeout: 60_000 });
}

/**
 * HID barkod okuyucuyu taklit eder.
 *
 * Uygulama fiziksel okuyucuyu klavye olayı olarak dinler (`useHidScanner`):
 * karakterler hızlıca gelir, sonunda Enter. Gerçek kullanıcı yolu budur;
 * bir input'a `fill()` yapmak bu kodu hiç çalıştırmaz ve okutma yolundaki
 * regresyonları kaçırır.
 */
export async function barkodOkut(page: Page, barkod: string): Promise<void> {
  await page.keyboard.type(barkod, { delay: 5 });
  await page.keyboard.press('Enter');
}
