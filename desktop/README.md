# Qore Terminal (masaüstü)

Depo terminali için Electron kabuğu. Web uygulamasının `/terminal` rotasını
tam ekran, tek işlik bir pencerede açar.

## Ne yapar, ne yapmaz

**Yapar**

- `/terminal` rotasını adres çubuğu ve sekme olmadan gösterir
- Oturumu kalıcı tutar (her açılışta yeniden giriş istemez)
- Yazıcıya diyalogsuz basım imkânı verir (`window.qoreDesktop.print()`)
- Aynı anda tek örnek çalışmasını garanti eder

**Yapmaz**

- Kendi arayüzünü çizmez — tüm ekranlar web uygulamasından gelir
- Kendi Firebase yapılandırmasını taşımaz, kimlik bilgisi saklamaz
- Kendi veri kopyasını tutmaz

Bu ayrım bilinçli: masaüstü uygulaması ile web uygulaması **aynı Firestore
koleksiyonlarına, aynı `src/lib/*/write.ts` modülleriyle** yazar. İkinci bir
yazma yolu olmadığı için iki uygulamanın stoğu farklı güncellemesi mümkün
değildir.

## Çalıştırma

```bash
cd desktop
npm install

# Yerel geliştirme (web uygulaması ayrı terminalde `pnpm dev` ile çalışıyor olmalı)
QORE_TERMINAL_URL=http://localhost:9002/terminal npm start

# Dağıtılmış ortama bağlanmak için
QORE_TERMINAL_URL=https://<alan-adiniz>/terminal npm start
```

`QORE_TERMINAL_URL` verilmezse uygulama boş pencere göstermek yerine ne
eksik olduğunu yazar. Bu bilinçli: yanlış ortama sessizce bağlanan bir depo
terminali, yanlış veritabanına yazmak demektir.

## Paketleme

```bash
cd desktop
npm run dist:win     # Windows kurulumu (NSIS)
npm run dist:mac     # macOS (dmg)
npm run dist:linux   # Linux (AppImage)
```

Üretim kurulumlarında `QORE_TERMINAL_URL`'i kısayola ya da sistem ortam
değişkenlerine yazın.

## Barkod okuyucu

HID (klavye taklidi) okuyucular ek yapılandırma olmadan çalışır — terminal
ekranları `useHidScanner` ile global `keydown` dinler. Okuyucunun sonuna
`Enter` ya da `Tab` göndermesi yeterlidir; idle zamanlayıcı sayesinde
sonlandırıcı göndermeyen okuyucular da desteklenir.

## Yazıcı

```js
if (window.qoreDesktop?.isDesktop) {
  await window.qoreDesktop.print({ silent: true });
}
```

Köprü tarayıcıda tanımsızdır; çağırmadan önce her zaman kontrol edin.
