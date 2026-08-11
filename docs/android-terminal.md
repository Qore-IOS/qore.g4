# Android Terminal (APK)

Masaüstü terminalinin **aynısı**, Android paketinde. Ayrı bir uygulama
değildir: ekranlar, yazma mantığı, çevrimdışı davranış ve tema tek kopyadır.
Masaüstü tarafı için bkz. [`masaustu-terminal.md`](./masaustu-terminal.md).

---

## Neden Capacitor

Terminalin tamamı **çevrimdışı açılabilmeye** dayanıyor: oturum cihazda
saklanıyor, ana veri IndexedDB'de duruyor, yazımlar Firestore'un kalıcı
kuyruğuna giriyor. Bunların hepsi **güvenli kaynak** (secure origin) ister.

- Masaüstünde `file://` yetmediği için özel `app://` protokolü kuruldu.
- Android'de karşılığı Capacitor'ın `https://localhost` sunucusudur
  (`capacitor.config.ts` → `server.androidScheme: 'https'`).

Bu satır kaldırılırsa uygulama açılır ama çevrimdışı davranışın tamamı sessizce
bozulur — en tehlikeli arıza biçimi.

---

## Mimari — ne nereden geliyor

```
src/app/terminal/**          ekranlar          ┐
src/lib/**                   yazma mantığı     ├─ TEK KOPYA, üç kabukta ortak
src/components/terminal/**   arayüz parçaları  ┘
             │
             ├─ Next (web)            → /terminal rotası
             ├─ Vite → desktop/renderer-dist → Electron (.exe)
             └─ Vite → android-app/www       → Capacitor (.apk)
```

Vite yapılandırması ikisinde de aynıdır (`vite.config.terminal.ts`); hedefi iki
ortam değişkeni belirler:

| Değişken            | Masaüstü                 | Android            |
| ------------------- | ------------------------ | ------------------ |
| `TERMINAL_OUT_DIR`  | `desktop/renderer-dist`  | `android-app/www`  |
| `TERMINAL_TARGET`   | `desktop`                | `android`          |

---

## APK nasıl üretilir

### Yol 1 — GitHub Actions (kurulum gerektirmez, önerilen)

Actions → **Android APK** → *Run workflow*. İş bitince sayfanın altındaki
`qore-terminal-<commit>` çıktısını indirin; içinden çıkan `.apk` telefona
doğrudan kurulabilir.

Aynı iş akışı, terminal dosyalarına dokunan her PR'da da çalışır — böylece
"derleniyor mu?" sorusu birleştirmeden önce cevaplanmış olur.

### Yol 2 — Kendi makinenizde

Gereken: **JDK 21** ve **Android SDK** (Android Studio ile gelir).

```bash
npm install
node scripts/env-from-apphosting.js   # .env.local yoksa üretir
npm run android:apk                   # hata ayıklama APK'sı
npm run android:apk -- --release      # imzasız yayın APK'sı
```

`android:apk` üç adımı ayrılmaz biçimde çalıştırır: arayüz paketi → `cap sync`
→ Gradle. **Bunları elle ayrı ayrı çalıştırmayın**; masaüstünde tam olarak bu
yüzden bir kez eski arayüzü taşıyan bir kurulum üretildi ve sebebi hiçbir
yerde görünmedi.

Çıktı: `android/app/build/outputs/apk/debug/app-debug.apk`

### Telefona kurma

APK'yı telefona kopyalayın ve dokunun. Android "bilinmeyen kaynak" uyarısı
verir; o uygulamaya (genelde dosya yöneticisi ya da tarayıcı) bir kereliğine
izin vermek yeterlidir.

Hata ayıklama APK'sı şirket içi dağıtım için yeterlidir. Play Store'a
çıkılacaksa yayın APK'sının imzalanması gerekir:

```bash
keytool -genkey -v -keystore qore-terminal.keystore \
  -alias qore -keyalg RSA -keysize 2048 -validity 10000
```

Sonra `android/app/build.gradle` içine `signingConfigs` eklenir. Keystore
dosyası **depoya konmaz**.

---

## Kabuk farkları — nerede ele alındılar

Ekranlarda `if (android)` dallanması **yoktur**. Farklar üç dosyada toplandı:

### 1. `src/lib/native-shell.ts`

| Konu | Neden gerekli |
| --- | --- |
| Durum çubuğu teması | Açık temada beyaz zemin üstünde beyaz saat okunmuyordu. |
| Donanım geri tuşu | Capacitor'ın varsayılanı WebView geçmişinde geri gitmek. Hash router'da bir vardiya boyunca onlarca kayıt birikiyor ve geri tuşu kullanıcıyı saatler önceki ekranlara gezdiriyordu. Yerine: bir üst seviye, ana ekranda çıkış. |
| İşleyici yığını | Kamera örtüsü açıkken geri tuşu örtüyü kapatmalı, ekranı değiştirmemeli. Yalnızca en üstteki işleyici çağrılır. |

Capacitor eklentileri **dinamik** import edilir — web ve masaüstü paketlerine
girmesinler diye. Yerel platform dışında her fonksiyon sessizce hiçbir şey
yapmaz.

### 2. `src/lib/pdf-delivery.ts`

`jsPDF.save()` gizli bir `<a download>` bağlantısına tıklar. Tarayıcıda ve
Electron'da çalışır; **Android WebView'ında sessizce hiçbir şey yapmaz** —
hata bile çıkmaz. Transfer tutanağı düğmesi basıldığında hiçbir şey olmazdı.

Android'de PDF önbelleğe yazılıp sistem paylaşım sayfası açılır: kullanıcı
yazıcıya, WhatsApp'a ya da Drive'a kendi gönderir. Web ve masaüstünde davranış
birebir aynı kaldı.

### 3. `src/components/terminal/camera-scan-button.tsx`

El terminallerindeki (Zebra, Honeywell, Urovo…) barkod okuyucular *keyboard
wedge* kipinde tuş vuruşu üretir; `useHidScanner` bunu zaten dinler ve
Android'de de **olduğu gibi çalışır** (`capacitor.config.ts` →
`android.captureInput: true`).

Ama aynı APK sıradan bir telefona da kurulabiliyor ve orada okutacak donanım
yok. Kamera düğmesi **yalnızca Android kabuğunda** görünür; okunan kod, HID
okuyucununkiyle aynı yoldan (`onScan({ raw })`) ekrana verilir — doğrulama ve
yazma mantığı tek kopya kalır.

Kamera izni yalnızca düğmeye basıldığında istenir ve
`<uses-feature … required="false">` sayesinde kamerası olmayan sabit
terminaller kurulum dışında kalmaz.

---

## İçerik Güvenlik Politikası

Politika `index.html` içinde değil, `vite.config.terminal.ts` → `injectCsp()`
içinde tek yerde tanımlıdır. İki hedef arasındaki **tek fark** `script-src`:

Capacitor, yerel köprüsünü sunucu tarafında satır içi bir `<script>` olarak
`<head>`in hemen ardına enjekte eder (`JSInjector.java`). Bu betik bizim meta
etiketimizden önce geldiği için ayrıştırıcıya göre politikaya takılmayabilir —
ama bu WebView sürümüne bağlı bir ayrıntı ve tutmadığında uygulama **köprüsüz**
açılır: geri tuşu, tutanak kaydı ve durum çubuğu çalışmaz.

Uygulamanın açılmasını ayrıştırıcı sırasına bağlamak yerine Android hedefinde
`'unsafe-inline'` açıkça veriliyor. Pakette bizim yazmadığımız betik zaten yok;
asıl koruma `default-src 'self'` ve `connect-src` beyaz listesi.

---

## Bilinen sınırlar

- **İlk giriş internet ister.** Firebase Auth parolayı sunucuda doğrular. Bir
  kez girildikten sonra oturum cihazda kalır ve çevrimdışı açılışlarda korunur.
- **Sessiz yazdırma yok.** Masaüstündeki `window.qoreDesktop.print()`in Android
  karşılığı yoktur; tutanak paylaşım sayfasından yazıcıya gönderilir.
- **Ekran boyutu.** Arayüz el terminali/tablet ölçüsüne göre tasarlandı. Küçük
  telefonlarda başlık şeridi alt satıra sarar (`TerminalShell`), okunur kalır
  ama ferah değildir.
- **Cihazda elle test edilmedi.** APK bu ortamda derlendi ve içeriği
  doğrulandı; gerçek cihazda okutma/çevrimdışı davranış testi sizde.
