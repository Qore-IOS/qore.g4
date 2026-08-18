import { expect, test } from '@playwright/test';
import { girisYap, USER } from '../helpers';

/**
 * Duman testi: yığının tamamı ayakta mı?
 *
 * Bu dosya bir özelliği değil, ALTYAPIYI doğrular — emülatör, tohumlanan
 * kullanıcı, özel talepler (custom claims), şirket kapsamı ve uygulamanın
 * emülatöre bağlanması. Buradaki bir kırmızı, aşağıdaki akış testlerinin
 * hepsini şüpheli yapar; o yüzden ilk koşan bu olmalı.
 */
test.describe('oturum ve şirket kapsamı', () => {
  test('geçerli kullanıcı giriş yapar ve korumalı alana girer', async ({ page }) => {
    await girisYap(page);
    expect(page.url()).not.toContain('/login');
  });

  test('yanlış parola girişi reddedilir', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(USER.email);
    await page.locator('#password').fill('yanlis-parola');
    await page.getByRole('button', { name: /giriş/i }).click();

    // /login'de kalınmalı — yönlendirme olursa kimlik doğrulama kırık demektir.
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('/login');
  });

  test('oturum açmamış kullanıcı korumalı sayfadan login\'e yönlendirilir', async ({ page }) => {
    await page.goto('/direkt-transfer');
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    expect(page.url()).toContain('/login');
  });
});
