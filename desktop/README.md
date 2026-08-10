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

## Terminal adresi nasıl belirlenir

Uygulama açılışta şu sırayla bakar, ilk bulduğunu kullanır:

1. `QORE_TERMINAL_URL` ortam değişkeni — geliştirme ve geçici override
2. Kullanıcı verisi altındaki `config.json` — **ilk açılışta çıkan formla yazılır**
3. Uygulamayla paketlenen `config.json` — kurumsal dağıtımda önceden basılır

Hiçbiri yoksa kurulum formu açılır ve adres sorulur. Adresi sonradan
değiştirmek için **`Ctrl+Shift+U`**.

Kullanıcı yapılandırmasının konumu:

| İşletim sistemi | Yol |
| --- | --- |
| Windows | `%APPDATA%\Qore Terminal\config.json` |
| macOS | `~/Library/Application Support/Qore Terminal/config.json` |
| Linux | `~/.config/Qore Terminal/config.json` |

Herkese aynı `.exe` dağıtacaksanız, paketlemeden önce
`config.example.json` dosyasını `config.json` olarak kopyalayıp adresi
doldurun — kurulan uygulama form göstermeden doğrudan bağlanır.

## Geliştirme

```bash
cd desktop
npm install

# Web uygulaması ayrı bir terminalde `pnpm dev` ile çalışıyor olmalı
QORE_TERMINAL_URL=http://localhost:9002/terminal npm start
```

Windows PowerShell'de:

```powershell
$env:QORE_TERMINAL_URL="http://localhost:9002/terminal"; npm start
```

## Paketleme (.exe / .dmg / AppImage)

```bash
cd desktop
npm install
npm run dist:win     # Windows kurulumu (NSIS)
npm run dist:mac     # macOS (dmg)
npm run dist:linux   # Linux (AppImage)
```

Çıktılar `desktop/dist/` altına düşer.

**Önemli:** Windows kurulumu **Windows üzerinde** üretilmelidir. `electron-builder`
Linux'tan Windows hedefi için Wine ister; kurumsal bir makinede bunu kurmaktansa
bir Windows makinede `npm run dist:win` çalıştırmak çok daha az sorunludur.

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
