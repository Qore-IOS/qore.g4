export const TOTAL_VERIMLILIK_ANALIZ_RAPORU = `
Total Verimlilik Paneli - Çalışma Mantığı ve Algoritma Raporu
Bu rapor, QORE.G4 sisteminde yer alan Total Verimlilik Paneli'nin arka planda nasıl çalıştığını, hesaplamaların hangi formüllere dayandığını ve genel algoritmayı detaylandırmak amacıyla hazırlanmıştır. Bu belge, veri analizi yapacak yapay zeka sistemlerine referans olması ve laboratuvar verimliliğinin nasıl artırılabileceği konusunda yol göstermesi için yapılandırılmıştır.

1. Sistemin Genel Amacı
Total Verimlilik Paneli, çoklu laboratuvar ortamlarında (efficiency pools) kit kullanım verimliliğini, stok doğruluk oranlarını, sevk/transfer süreçlerindeki sapmaları ve maliyet/kâr analizlerini tek bir merkezden izlemeyi sağlar. Sistem, manuel sayımlar, LIS (Laboratuvar Bilgi Sistemi) cihaz verileri (kümülatif total) ve faturalandırmaya esas hak edişleri (SUT kodları vb.) karşılaştırarak kaçaklar (kutu kayıp) ve verimsizlikleri tespit eder.

2. Veri Akışı ve Mimari
Panel, verileri çeşitli kaynaklardan toplayarak bir araya getirir:

Manuel Girişler: Başlangıç stoğu, cihaz üstü testler, dönem sonu sayımları.
Otomatik Sevk Verileri: Lojistik modülünden (transfers koleksiyonu) çekilen depo çıkışlı sevkiyatlar (Göztepe Sevkiyat vb.).
Dönem Devri (Carryover): Bir önceki ayın dönem sonu verileri (Dönem Sonu Stok ve Cihaz Üstü Test), bir sonraki ayın Başlangıç verileri olarak otomatik devredilir.
Kurumlar Arası Transfer (Inter-Lab Transfer): Laboratuvarlar arası acil malzeme kaydırmaları sisteme işlenir, vereni eksiltip alanı artırır.
Finansal Entegrasyon: Gerçek zamanlı döviz kurları (USD, EUR, TRY) ve geçmiş maliyet checkpoint'leri ile maliyet hesabı yapılır.

3. Hesaplama Algoritması ve Formüller
Panel, her bir ürün (stok kodu) ve laboratuvar kombinasyonu için bir satır (row) oluşturur. Tüm hesaplamalar test adedi bazına indirgenerek standartlaştırılır (Kutu * Ambalaj Değeri = Test Adedi).

3.1. Girdi (Input) Değişkenleri
A (Ambalaj Değeri): 1 kutu kitin içerebileceği maksimum test sayısı.
B (Başlangıç Stoğu - Kutu): Dönem başı raftaki tam kutu sayısı.
C (Ay Başı Cihaz Üstü - Test): Cihaz üzerinde takılı, açılmış kitteki kalan test sayısı.
D (Ay Başı Sevkiyat - Kutu): Ayın ilk günü yapılan manuel sevkler.
E (Göztepe Sevkiyat - Kutu): Depodan sistem üzerinden yapılan otomatik sevkiyatlar.
F (Kurumlar Arası Sevk - Kutu): Diğer laboratuvarlardan alınan/verilen miktar.
G (Lojistik Ara Transfer - Kutu): Lojistik tarafından ay içinde yapılan ek transferler.
H (Kümülatif Total - Test): LIS (Laboratuvar Bilgi Sistemi) veya cihazdan alınan o ayki toplam harcanan test sayısı.
I (Dönem Sonu Stok - Kutu): Ay sonu raftaki sayım.
J (Dönem Sonu Cihaz Üstü - Test): Ay sonu cihazdaki kalan test sayımı.
K (Hak Ediş - Test): Kuruma fatura edilen veya hak edilen test sayısı.

3.2. Ara Hesaplamalar (Stok Hareketi)
Tüm hesaplamalar birim cinsinden "Test" olarak yapılır.

Total Ay Başı Stok: Ay başındaki toplam kullanılabilir test. Total Ay Başı Stok = (B * A) + C

Toplam Sevkiyat (Kutu): Ay içindeki tüm girişler. Toplam Sevkiyat = D + E + F + G

Sevkiyatlar Sonrası Total Test (Mevcut Olması Gereken Maksimum Test): Sevkiyatlar Sonrası Total = (Toplam Sevkiyat * A) + Total Ay Başı Stok (Not: Eğer bu laboratuvar başka bir laboratuvara ürün transfer ettiyse, bu formülden transfer edilen test adedi çıkarılır.)

Dönem Sonu Toplam Test (Eldeki Kalan): Dönem Sonu Toplam = (I * A) + J

Beklenen Tüketim: Stok hareketlerine göre cihazda harcanmış olması gereken teorik test sayısı. Beklenen Tüketim = Sevkiyatlar Sonrası Total - Dönem Sonu Toplam

3.3. Verimlilik ve Performans Metrikleri (Çekirdek Analiz)
Yapay zeka analizlerinde odaklanılması gereken en kritik metrikler buradadır.

Stok Doğruluk Farkı: Teorik tüketim ile LIS'ten alınan cihaz tüketimi arasındaki fark. Raftaki kaybı veya sisteme girilmeyen kaçak giriş/çıkışları gösterir. Stok Doğruluk Farkı = Beklenen Tüketim - H (Kümülatif Total) Stok Doğruluk Sapma (%) = (Stok Doğruluk Farkı / H) * 100

Kit Verimlilik Farkı: Cihazın harcadığı test (LIS) ile kuruma fatura edilebilen (Hak Ediş) arasındaki fark. Bu, kalibrasyon, kontrol, tekrar testleri (re-run) veya cihaz firelerini gösterir. Kit Verimlilik Farkı = H (Kümülatif Total) - K (Hak Ediş) Kit Verimlilik Sapma (%) = (Kit Verimlilik Farkı / H) * 100

Kutu Kayıp: Stok Doğruluk Farkının kutu cinsinden karşılığı. Kutu Kayıp = Stok Doğruluk Farkı / A (Ambalaj) (Ekranda ve raporlarda pozitif kayıplar negatif değerle gösterilir ki göze çarpsın).

3.4. Finansal Hesaplamalar
Sarfiyat Maliyeti: Gerçekte tüketilen malzemenin maliyeti. Sarfiyat Maliyeti = Beklenen Tüketim * (Birim Kutu Maliyeti / A)

Hak Ediş Karşılığı (Gelir): Test başına kazanılan ücret. Hak Ediş Karşılığı = Birim Test Ücreti (TL) * K (Hak Ediş)

Kâr / Zarar: Kâr = Hak Ediş Karşılığı - Sarfiyat Maliyeti

4. Yapay Zeka İçin Laboratuvar Analizi ve İyileştirme Yönergeleri
Verileri analiz edecek AI modeli için aşağıdaki başlıklar verimlilik teşhisi ve çözümü açısından temel referanstır:

Senaryo 1: Yüksek "Stok Doğruluk Farkı" (Sapma % > %5)
Anlamı: Depo ve raf yönetimi sorunludur. Gelen mallar ile rafta sayılan mallar tutmuyor.
Olası Nedenler: Sayım hataları, sisteme işlenmemiş laboratuvarlar arası transferler, kayıp/çalıntı kitler, miadı dolup çöpe atılan ama düşümü yapılmayan kitler.
Aksiyon / Çözüm:
Haftalık spot sayımlara geçilmesi.
Kurumlar arası transferlerin anında sisteme girilmesinin zorunlu tutulması.
Miad takibinin sıkılaştırılması.

Senaryo 2: Yüksek "Kit Verimlilik Farkı" (Sapma % > %10)
Anlamı: Cihaz çok fazla test harcıyor ancak bunun faturası (hak edişi) kesilemiyor. Laboratuvar zarara uğruyor.
Olası Nedenler:
Cihazın kalibrasyon veya kontrol testlerinde (QC) çok fazla kit harcaması.
Test tekrarlarının (re-run) çok yüksek olması (hatalı numune alımı, cihaz arızası).
LIS ile HBYS (Hastane Bilgi Yönetim Sistemi) arasındaki entegrasyon hataları (yapılan testin hastaya fatura edilmemesi).
Aksiyon / Çözüm:
Pre-analitik evrenin (numune alım süreçleri) iyileştirilmesi ve personelin eğitilmesi (re-run'ları düşürmek için).
Cihaz bakım periyotlarının incelenmesi (kalibrasyon hatalarını azaltmak).
LIS/HBYS entegrasyonlarında test eşleşmelerinin (SUT kodları) kontrol edilmesi.

Senaryo 3: Eksi (-) Çıkan Beklenen Tüketim
Anlamı: İmkansız bir fiziksel durum. Dönem sonundaki mal, ay başındaki mal ve gelen sevkiyattan daha fazladır.
Olası Nedenler:
Dönem sonu sayımı hatalı (fazla sayılmış).
Sisteme işlenmeyen, kayıt dışı bir depo girişi yapılmış.
Ay başı devri (carryover) hatalı yapılmış.
Aksiyon / Çözüm: Sayım verilerinin denetlenmesi ve sevk irsaliyelerinin kontrolü.

Senaryo 4: Kârlılıkta Negatif (Zarar) Durumu
Anlamı: Sarfiyat maliyeti, hak ediş gelirinden yüksektir.
Olası Nedenler: Kit fiyatı ihalede/anlaşmada yüksek alınmış ancak SUT geri ödemesi düşük kalmıştır veya "Kit Verimliliği" çok düşüktür.
Aksiyon / Çözüm: Cihaz ihale şartnamelerinin veya kit tedarik maliyetlerinin (Cost Checkpoints) gözden geçirilmesi, alternatif ürün/marka aranması.

5. Sistem Mantığında Yapılabilecek Geliştirmeler (AI Tavsiyeleri İçin)
AI modeli bu raporu okuduğunda, sistem yapısına şu tavsiyelerde bulunabilir:
Dinamik Tolerans Limitleri: Stok Doğruluk ve Kit Verimlilik sapmaları için her cihaza/teste özel "Kabul Edilebilir Sapma (Örn: %3)" belirlenmesi ve sadece bu limiti aşanların kırmızı alert vermesi.
Öngörüsel Sipariş (Predictive Ordering): Son 3 ayın "Beklenen Tüketim" ortalaması alınarak, bir sonraki ayın "Göztepe Sevkiyat" miktarının otomatik önerilmesi.
Hata Kök Neden (Root-Cause) Alanları: Manuel giriş yapılan "Hak Ediş" ve "Kümülatif Total" sütunlarının yanına, sapma durumunda seçilebilecek (Örn: "Kalibrasyon Sorunu", "Kayıp Kit") etiketleme sütunları eklenmesi.
`;
