# Cihaz Yönetimi Modülü – Light Neumorphic Standardizasyon Raporu

Bu doküman, Cihaz Yönetimi kapsamındaki ekranların tek bir **light neumorphic design system** altında standardize edilmesi için iki katmanda hazırlanmıştır:

1. **Tasarım Katmanı** (UI dili, hiyerarşi, görsel token standardı)
2. **Teknik Katman** (Next.js/React + Tailwind implementasyon modeli, komponent kütüphanesi, performans ve erişilebilirlik)

Kapsam:

- `/teknik-servis`
- `/teknik-servis/[labId]`
- `/teknik-servis/islem-formu/[cihazId]`
- `/aplikasyon-paneli`
- `/aplikasyon-paneli/[labId]`
- `/aplikasyon-paneli/islem-formu/[cihazId]`
- `/ariza-yonetimi`
- `/ariza-yonetimi/[arizaId]`
- `/ariza-yonetimi/istatistikler`
- `/personel-izlem`
- `/kurum-ziyaret-analizi`

---

## 1) Genel Teşhis – Tüm Ekranlarda Ortak Problemler

### En kritik 7 problem

1. **Hiyerarşi zayıf:** Başlık/alt başlık/aksiyon/içerik arasında net göz yolu oluşmuyor.
2. **Aşırı gölge ve blur:** Kartlar gereğinden fazla “floating” görünüyor; okunabilirlik ve performans düşüyor.
3. **Ölçü tutarsızlığı:** Buton, radius, padding, ikon ve pill ölçüleri ekranlar arasında değişiyor.
4. **Tablo/filtre kontrastı düşük:** Satır ayrımları ve metin kontrastı kritik eşiklerin altına iniyor.
5. **Navigasyon kalabalık:** Özellikle çok ikonlu yapılar bilgi mimarisini zayıflatıyor.
6. **Boşluk yönetimi dengesiz:** Bazı ekranlar sıkışık, bazıları boş; ürün hissi parçalanıyor.
7. **Durum renkleri sistematik değil:** Success/warn/danger anlamları ekranlar arasında farklı hissediliyor.

### Hedef sonuç

- Soft-neumorphism hissi korunacak.
- Hiyerarşi, **typography + spacing** ile güçlendirilecek.
- Gölge sistemi 3 seviyeye indirilecek.
- Navigasyon sadeleşecek.
- Form ve tablo okunabilirliği artacak.
- Mobil/masaüstü aynı ürün ailesi deneyimi verecek.

---

## 2) Katman A – Tasarım Sistemi Standardı

## 2.1 Görsel dil

- **Stil:** soft-neumorphism + hafif claymorphism
- **Arka plan:** açık nötr gri
- **Yüzeyler:** aynı tonal ailede kabarık kartlar
- **Aksiyon vurgusu:** kontrollü turuncu
- **Durum renkleri:** tutarlı semantik kullanım

> Kritik ilke: “Her şey kart, her şey vurgulu” yaklaşımı terk edilecek. Primary ve secondary yüzeyler net ayrılacak.

## 2.2 Renk token seti

```css
:root {
  /* Neutrals */
  --bg: #ECEDEF;
  --surface: #F3F4F6;
  --surface-2: #E7E9ED;
  --border: rgba(20, 23, 28, 0.08);
  --text: #1F2328;
  --muted: #6B7280;

  /* Accent */
  --accent: #F59E0B;
  --accent-weak: rgba(245, 158, 11, 0.18);

  /* Status */
  --success: #16A34A;
  --danger: #B91C1C;
  --info: #2563EB;
  --purple: #7C3AED;
}
```

Notlar:

- Accent sadece CTA ve kritik vurguda kullanılmalı.
- Turuncu metin kullanımı sınırlı olmalı; başlıklarda nötr koyu ton tercih edilmeli.

## 2.3 Elevation standardı (3 seviye)

```css
:root {
  --shadow-hi: rgba(255, 255, 255, 0.85);
  --shadow-lo: rgba(17, 24, 39, 0.10);
}

.elev-1 {
  box-shadow:
    -6px -6px 12px var(--shadow-hi),
     6px  6px 12px var(--shadow-lo);
}

.elev-2 {
  box-shadow:
    -10px -10px 20px var(--shadow-hi),
     10px  10px 20px var(--shadow-lo);
}

.pressed {
  box-shadow:
    inset -6px -6px 12px var(--shadow-hi),
    inset  6px  6px 12px var(--shadow-lo);
}
```

## 2.4 Boyutlandırma, spacing, tipografi

- **Radius:**
  - Kart: 20–24px
  - Input/Button: 14–16px
  - Pill: 999px
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32
- **Typography:**
  - Page title: 24–28
  - Card title: 16–18 semibold
  - Body: 14–16
  - Meta: 12–13

---

## 3) Katman B – Teknik Sistemleşme (Next.js + Tailwind)

## 3.1 Tek kaynak yaklaşımı

- `globals.css`: CSS variables (renk, gölge, radius, focus)
- `tailwind.config.*`: `theme.extend` üzerinden colors, boxShadow, borderRadius
- Custom utility: `shadow-neumo-1`, `shadow-neumo-2`, `shadow-neumo-inset`

## 3.2 Standart komponent seti (minimum)

1. `Card`
2. `Button` (primary/secondary/ghost)
3. `Input/Select/Textarea`
4. `Badge/Pill`
5. `SegmentedControl`
6. `Toolbar/FilterBar`
7. `DataTable`
8. `StatCard/KPICard`

## 3.3 Erişilebilirlik

- Metin kontrastı hedefi: minimum **4.5:1**
- Klavye odak görünürlüğü zorunlu

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
}
```

## 3.4 Performans

- Büyük blur gölgeler sadece ana kartlarda kullanılmalı.
- Tablo satırlarında gölge yerine border/separator kullanılmalı.
- Mobilde gölge yoğunluğu düşürülmeli (`elev-1` ağırlıklı).

---

## 4) Ekran Bazlı İyileştirme Planı

## 4.1 Cihaz Yönetim Merkezi (Mobil ana ekran)

- 4 büyük aksiyon, 2x2 grid düzenine çekilecek.
- “Diğer Araçlar” bölümünde ikonlu kompakt liste kullanılacak.
- Bottom nav 4 sekme ile sınırlandırılacak.

**Komponentler:** `ActionTile`, `BottomNav`, `CompactListItem`

## 4.2 Teknik Servis / Aplikasyon – Kurum/Lab listesi (Mobil)

- Kartlarda yalnız isim değil, operasyon özeti gösterilecek.
- Sticky üstte arama + filtre eklenecek.
- Favoriler/Son ziyaret edilen/Tümü gruplaması getirilecek.

**Komponent:** `ListItemCard`

## 4.3 Cihaz listesi (Mobil)

- Cihaz görseli küçültülecek veya collapsible olacak.
- Status pill üst başlığa taşınacak.
- İçerik accordion yapısına alınacak.

**Komponentler:** `DeviceHeader`, `AccordionSection`, `StatusPill`

## 4.4 İşlem formu (Mobil)

- 3 adımlı stepper akışı:
  1) İşlem tipi
  2) Tarih/Saat
  3) Açıklama + parça/işlem
- Altta sticky action bar: Taslak / Kaydet
- Parça/işlem ekleme modal veya drawer ile yapılacak.

**Teknik gereksinim:** `padding-bottom = sticky bar + safe-area`

## 4.5 Cihaz durumları (Masaüstü)

- Her cihaz için tek `DeviceCard` modeli kullanılacak.
- Header’da status + quick actions birlikte yer alacak.
- Grid düzeni `auto-fit minmax(240px,1fr)` ile responsive olacak.

## 4.6 İşlem formu (Masaüstü)

- Sol form, sağ sticky summary olacak şekilde 2 kolon yapı.
- Section başlıkları güçlendirilecek.
- Primary CTA sticky ve sürekli görünür olacak.

**Komponentler:** `StickySummaryCard`, `SectionHeader`

## 4.7 Personel Performans İzleme

- Kart yapısı: header + 3 ana metrik + collapsible detay.
- Skor halkası küçültülerek yardımcı role alınacak.

**Komponent:** `MetricRow`

## 4.8 Arıza İstatistikleri (KPI + filtre)

- KPI kartlarına delta ve mini sparkline eklenecek.
- Segment seçimi pressed/inset state ile netleştirilecek.

## 4.9 Arıza İstatistikleri (grafik + SLA tablo + top cihaz)

- Pie chart tonu yumuşatılarak donut + legend modeli tercih edilecek.
- SLA tablosu sticky header + row hover ile güçlendirilecek.
- Top cihaz tıklamasında detay drawer açılacak.

## 4.10 Kurum Ziyaret Analizi

- Üst KPI şeridi + chart + insight paneli düzeni kurulacak.
- Filtre bar sticky hale getirilecek.
- Mobilde top-N + “tümünü gör” yaklaşımı uygulanacak.

## 4.11 Ürün detayı / değişim ekstresi / kullanılan cihazlar

- Üst filtre bar sticky yapılacak.
- “Ekstre” data table, mobilde card list olarak sunulacak.
- “Kullanıldığı cihazlar” satırları cihaz detayına drill-down verecek.

## 4.12 Tüm Arıza Kayıtları

- Silme aksiyonu confirm dialog ile güvenli hale getirilecek.
- Satır aksiyonları görünür menüye taşınacak.
- Bulk select/export, sort ve arama standartlaştırılacak.

**Komponentler:** `ConfirmDialog`, `RowActionsMenu`, `DataTable`

## 4.13 Arıza Detay

- Geçmiş tablo yerine vertical timeline kullanılacak.
- Üst kritik bloklar (SLA, atama, durum) iki kolonda vurgulanacak.
- Floating edit yerine bağlamsal üst aksiyon butonu kullanılacak.

**Komponent:** `Timeline (event enum mapping)`

---

## 5) Navigasyon ve Bilgi Mimarisi

## Masaüstü

**Sidebar:**

- Cihaz Yönetimi
- Arızalar
- Cihazlar
- Personel
- Raporlar
- Tanımlar

**Topbar:**

- Kurum/Line seçici
- Global search
- Sağ aksiyonlar: Paylaş, PDF, Asistan

## Mobil

**Bottom tab (max 4):**

- Ana
- Arızalar
- Cihazlar
- Raporlar

**FAB:** yalnız tek kritik işlem için (örn. Arıza Aç)

---

## 6) Mobil vs Masaüstü Kural Seti

## Mobil öncelikler

- Kritik aksiyon tek bakışta görünür olmalı.
- Kart yüksekliği düşürülmeli, bilgi yoğunluğu artırılmalı.
- Formlar stepper + sticky CTA ile yönetilmeli.
- Gölge hafifletilmeli.

## Masaüstü öncelikler

- 12 kolon grid + max-width düzeni korunmalı.
- Sticky toolbar ve sağ summary panel kullanılmalı.
- Drill-down akışı net olmalı: liste → detay → timeline.

---

## 7) Uygulama Yol Haritası (Öneri)

1. **Foundation Sprint:** token seti, shadow utilities, radius/spacing/typography standardı
2. **Core Components Sprint:** Card/Button/Input/Badge/FilterBar/DataTable/KPICard
3. **Navigation Sprint:** masaüstü sidebar + mobil bottom tab sadeleştirmesi
4. **Form Modernizasyonu:** teknik servis/aplikasyon formlarında stepper + sticky CTA
5. **Arıza Modülü Modernizasyonu:** kayıt listesi, detay timeline, istatistik ekranları
6. **Kalite Geçişi:** kontrast, performans, responsive, kullanılabilirlik testleri

Başarı metrikleri:

- Görev tamamlama süresi (mobil form) düşüşü
- Hatalı aksiyon oranı (silme/yanlış kayıt) düşüşü
- KPI/table okunabilirlik geri bildirimi artışı
- Görsel tutarlılık skorunun (UI checklist) yükselmesi
