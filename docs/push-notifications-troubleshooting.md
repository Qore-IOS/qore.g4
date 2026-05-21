# Push Notifications Troubleshooting

Bu doküman, Firebase Cloud Messaging (FCM) tabanlı web push bildirimlerinde sık karşılaşılan sorunlar ve çözümlerini açıklar.

## Hata: `Installations: Create Installation request failed ... 403 PERMISSION_DENIED`

```
FirebaseError: Installations: Create Installation request failed with error
"403 PERMISSION_DENIED: Requests to this API firebaseinstallations.googleapis.com
method google.firebase.installations.v1.FirebaseInstallationsService.CreateInstallation
are blocked." (installations/request-failed).
```

### Sebep

FCM, token üretmek için **Firebase Installations API**'ı kullanır. Bu hata, istemcinin kullandığı Web API key'in Installations API'ye erişiminin Google Cloud Console tarafından engellenmiş olduğunu gösterir. Üç olası sebebi vardır:

1. **API Library'de etkin değil** — `Firebase Installations API` veya `Firebase Cloud Messaging API` projeye enable edilmemiş.
2. **API Key kısıtlaması** — Anahtarın "API restrictions" listesinde Installations API yok.
3. **HTTP Referrer kısıtlaması** — Anahtarın izin verilen referrer listesinde uygulamanın çalıştığı domain yok.

### Çözüm

#### 1. Gerekli API'ları enable et

[APIs & Services → Library](https://console.cloud.google.com/apis/library?project=invpilot) sayfasında şu API'ları enable et:

- **Firebase Installations API**
- **Firebase Cloud Messaging API**
- **Cloud Messaging** (legacy, hala bazı senaryolarda gerekiyor)
- **Identity Toolkit API** (auth için zaten gerekli)
- **Cloud Firestore API**
- **Firebase Realtime Database API**

#### 2. API Key kısıtlamalarını düzelt

[APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=invpilot) sayfasında `NEXT_PUBLIC_FIREBASE_API_KEY` olarak kullanılan anahtarı aç.

**Application restrictions:**
- "HTTP referrers" seçtiysen şu pattern'ları ekle:
  - `https://qorengine.com/*`
  - `https://*.qorengine.com/*`
  - `http://localhost:*/*` (geliştirme için)
- "None" seçeneği de çalışır ama public anahtar olduğu için güvenli değildir.

**API restrictions:**
- "Don't restrict key" en basit ama en az güvenli seçenek.
- "Restrict key" seçtiysen liste **mutlaka** şunları içermeli:
  - Firebase Installations API
  - Firebase Cloud Messaging API
  - Identity Toolkit API
  - Cloud Firestore API
  - Firebase Realtime Database API
  - Token Service API
  - Cloud Functions API
  - Firebase Management API

Kaydet ve değişikliğin yayılması için 1-5 dakika bekle, ardından tarayıcı önbelleğini temizleyip test et.

#### 3. Hızlı test

Sorunun gerçekten kısıtlamadan kaynaklandığını doğrulamak için:

1. Geçici olarak API restrictions'ı "Don't restrict key" yap.
2. Push bildirimi tekrar dene.
3. Çalışıyorsa, kısıtlamalı moda dönüp eksik API'ları ekle.

## Hata: `VAPID Key is missing`

```
❌ [Push Notifications] VAPID Key is missing! Check your .env file.
```

### Sebep

`NEXT_PUBLIC_FIREBASE_VAPID_KEY` environment variable'ı tanımlanmamış.

### Çözüm

1. Firebase Console → Project Settings → Cloud Messaging → "Web Push certificates" altından mevcut anahtarı kopyala (yoksa "Generate key pair" ile oluştur).
2. Yerel geliştirme için `.env.local` dosyasına ekle:
   ```
   NEXT_PUBLIC_FIREBASE_VAPID_KEY=<key>
   ```
3. Üretim için `apphosting.yaml` içindeki `env` bloğunda tanımlı olduğundan emin ol.

## Hata: Service Worker registration failed

### Olası sebepler

- `firebase-messaging-sw.js` dosyası `/public` altında değil veya erişilemiyor.
- Sayfa HTTPS üzerinden servis edilmiyor (localhost hariç).
- Tarayıcı service worker'ları devre dışı bırakmış (genellikle private/incognito modda).

### Çözüm

- `public/firebase-messaging-sw.js` ve `public/firebase-config.js` dosyalarının deploy çıktısında var olduğunu doğrula.
- Tarayıcı DevTools → Application → Service Workers paneli üzerinden hata mesajını incele.

## Bildirimler geliyor ama tıklayınca yanlış yere yönlendiriyor

`firebase-messaging-sw.js` içindeki `notificationclick` handler payload'daki `data.url`'i kullanır. Backend'in gönderdiği `data` payload'unda `link`, `href` veya `url` alanlarından birinin doğru hedefi içerdiğinden emin ol.

## Token alınıyor ama push gelmiyor

1. Token'in Firestore'da `pushTokens/{token}` koleksiyonuna yazıldığını doğrula.
2. `enabled: true` olarak işaretlendiğinden emin ol.
3. Cloud Function logs (`notificationLogs` koleksiyonu) içinde ilgili gönderim kaydını kontrol et.
4. `successCount > 0` ise FCM gönderim başarılı; problem istemci tarafında (service worker hatası, tarayıcı izni vs.).
