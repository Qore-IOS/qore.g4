# Qore Terminal (masaüstü)

Depo terminali için Electron kabuğu. Terminal arayüzünü tam ekran, tek işlik
bir pencerede açar.

## İki çalışma kipi

| Kip | Arayüz nereden gelir | İnternetsiz açılır mı | Güncelleme |
| --- | --- | --- | --- |
| **Gömülü** (varsayılan) | `renderer-dist/`, uygulamayla kurulur | **Evet** | Yeni `.exe` gerekir |
| **Uzak** | Yayındaki `/terminal` adresinden | Hayır | Web deploy'u yeter |

`QORE_TERMINAL_URL` verilmişse uzak kip kazanır. Aksi hâlde `renderer-dist/`
varsa gömülü kip çalışır; o da yoksa kurulum formu adres sorar.

Depoda internet kesiliyorsa **gömülü kipi** kullanın: uygulama internetsiz
açılır, Firestore'un yerel önbelleğinden okur ve yazımları bağlantı gelene
kadar kuyrukta tutar.

## Ne yapar, ne yapmaz

**Yapar**

- Terminal arayüzünü adres çubuğu ve sekme olmadan gösterir
- Gömülü paketi `app://terminal` özel protokolünden sunar (IndexedDB'nin
  çalışması için gerçek bir kaynak gerekir; `file://` bunu sağlamaz)
- Oturumu kalıcı tutar (her açılışta yeniden giriş istemez)
- Yazıcıya diyalogsuz basım imkânı verir (`window.qoreDesktop.print()`)
- Aynı anda tek örnek çalışmasını garanti eder

**Yapmaz**

- Kendi ekranlarını yazmaz — arayüz, web uygulamasıyla AYNI bileşenlerden
  üretilir (`terminal-app/`, `src/app/terminal/**` içeriğini import eder)
- Kendi Firebase yapılandırmasını taşımaz, kimlik bilgisi saklamaz
- Kendi veri modelini tutmaz — yazımlar `src/lib/*/write.ts` üzerinden gider

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

## Gömülü paketi üretmek

Arayüz paketi repo kökünden üretilir ve `desktop/renderer-dist` içine düşer:

```bash
# repo kökünde — .env.local içinde Firebase anahtarları olmalı
pnpm build:terminal
```

Anahtarlar `apphosting.yaml` içindekilerle aynıdır (`NEXT_PUBLIC_FIREBASE_*`).
Eksikse build açık bir hata ile durur — sessizce çalışmayan bir `.exe`
üretmektense.

## Geliştirme

```bash
cd desktop
npm install
npm start                    # gömülü paket varsa onu açar

# Yayındaki siteye bakmak için (gömülü paketi yok sayar):
QORE_TERMINAL_URL=http://localhost:9002/terminal npm start
```

Windows PowerShell'de:

```powershell
$env:QORE_TERMINAL_URL="http://localhost:9002/terminal"; npm start
```

## Paketleme (.exe / .dmg / AppImage)

```bash
# önce arayüz paketi (repo kökünde)
pnpm build:terminal

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
