# Takvim Entegrasyonu (Satın-Alma Planlama)

Satın-Alma **Planlama** paneli (`src/components/purchasing/planlama`) bir to-do
uygulaması gibi çalışır. Bu entegrasyon, her kullanıcının **kendi** Google Takvim
veya Microsoft Outlook hesabını **bir kez** bağlamasına olanak tanır; bağlantı
kurulduktan sonra panelde eklenen/güncellenen/silinen her görev, tüm detaylarıyla
(başlık, not, önem derecesi, alt görevler, tarih/saat aralığı) o hesabın takvimine
otomatik işlenir.

## Kullanıcı akışı

1. Panelin sağ üstündeki **Takvim** butonuna tıklanır.
2. Açılan menüden **Google Takvim** veya **Outlook Takvim** için _Bağlan_'a basılır.
3. Sağlayıcının izin ekranında hesap seçilip onay verilir (bir kerelik).
4. Panele dönülür; buton üzerinde yeşil nokta bağlı olduğunu gösterir.
5. Bundan sonra oluşturulan/değiştirilen görevler otomatik olarak takvime yansır.
   Bağlantı istenildiğinde aynı menüden kaldırılabilir.

## Mimari

Tümü Next.js API route'ları içinde, ek npm paketi olmadan (yalnızca mevcut
`firebase-admin` ve `fetch`) çalışır.

| Parça | Dosya |
|-------|-------|
| OAuth/token/etkinlik yardımcıları | `src/lib/server/calendar-oauth.ts` |
| Bağlantı & token saklama, taze access token | `src/lib/server/calendar-store.ts` |
| Kısa ömürlü OAuth `state` kayıtları (CSRF) | `src/lib/server/calendar-state.ts` |
| connect/callback ortak akışı | `src/lib/server/calendar-route-helpers.ts` |
| Bağlan | `GET /api/calendar/{google\|microsoft}/connect` |
| Sağlayıcı dönüşü | `GET /api/calendar/{google\|microsoft}/callback` |
| Durum / bağlantıyı kaldır | `GET` / `DELETE /api/calendar/status` |
| Görev senkronizasyonu | `POST /api/calendar/sync` |
| Bağlan butonları (UI) | `src/components/purchasing/planlama/CalendarConnect.tsx` |

### Güvenlik

- **Kimlik doğrulama:** connect akışı Firebase ID token'ı (`?token=`) doğrular;
  status/sync `Authorization: Bearer` başlığını `adminAuth.verifyIdToken` ile
  doğrular.
- **Token saklama:** refresh token'lar yalnızca sunucudan erişilebilen
  `calendarConnections/{uid}` koleksiyonunda tutulur. `firestore.rules` bu
  koleksiyona ve `calendarOAuthStates`'e **tüm** client erişimini reddeder.
- **Şifreleme:** `CALENDAR_TOKEN_SECRET` tanımlıysa refresh/access token'lar
  AES-256-GCM ile şifrelenir.
- **Etkinlik eşlemesi kullanıcıya özel:** görev → etkinlik id eşlemesi paylaşılan
  görev dokümanında değil, `calendarConnections/{uid}/events/{taskId}` altında
  tutulur. Böylece aynı şirketteki birden çok kullanıcı aynı görevi kendi
  takvimlerine bağımsız olarak ekleyebilir.

## Kurulum (ortam değişkenleri)

`env.example` içindeki **Takvim Entegrasyonu** bölümüne bakın:

- **Google:** Google Cloud Console → OAuth client (Web). Calendar API etkin.
  Yönlendirme URI: `https://<alan-adiniz>/api/calendar/google/callback`.
  `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`.
- **Microsoft:** Entra ID (Azure) App registration. Graph izinleri:
  `Calendars.ReadWrite`, `User.Read`, `offline_access`. Yönlendirme URI:
  `https://<alan-adiniz>/api/calendar/microsoft/callback`.
  `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`,
  (opsiyonel) `MICROSOFT_CALENDAR_TENANT`.
- Opsiyonel: `CALENDAR_TIMEZONE` (varsayılan `Europe/Istanbul`), `APP_BASE_URL`,
  `CALENDAR_TOKEN_SECRET`.

Bir sağlayıcının değişkenleri tanımlı değilse UI'da o sağlayıcı
_"Yapılandırılmadı"_ olarak görünür ve bağlanma devre dışı kalır; diğer sağlayıcı
ve panelin geri kalanı normal çalışır.
