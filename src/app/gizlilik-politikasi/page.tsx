import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Gizlilik Politikası | Qore',
  description:
    'Qore takvim entegrasyonu kapsamında Google ve Microsoft hesap verilerinin nasıl işlendiğine dair gizlilik politikası.',
};

const LAST_UPDATED = '21 Temmuz 2026';
const CONTACT_EMAIL = 'btubasar@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function GizlilikPolitikasiPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="space-y-2 border-b pb-6">
        <h1 className="text-3xl font-bold text-foreground">Gizlilik Politikası</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LAST_UPDATED}</p>
      </div>

      <div className="mt-8 space-y-8">
        <Section title="1. Genel Bakış">
          <p>
            Qore (&quot;uygulama&quot;, &quot;biz&quot;), medikal ve lojistik operasyonlar için bir
            envanter ve iş yönetimi platformudur. Bu gizlilik politikası, uygulamanın Satın-Alma
            Planlama modülündeki <strong>takvim entegrasyonu</strong> özelliğini kullandığınızda
            Google ve Microsoft hesabınıza ait hangi verilere eriştiğimizi, bunları nasıl
            kullandığımızı, sakladığımızı ve koruduğumuzu açıklar. Uygulamayı kullanarak bu
            politikayı kabul etmiş olursunuz.
          </p>
        </Section>

        <Section title="2. Eriştiğimiz Veriler">
          <p>Takvim entegrasyonunu bağladığınızda, yalnızca sizin açık izninizle şu verilere erişiriz:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Hesap e-posta adresiniz</strong> (Google veya Microsoft): Yalnızca hangi
              hesabın bağlı olduğunu göstermek için kullanılır.
            </li>
            <li>
              <strong>Takvim etkinlikleri</strong> (Google Calendar için{' '}
              <code>calendar.events</code>, Microsoft için <code>Calendars.ReadWrite</code>):
              Uygulamada oluşturduğunuz görevleri takviminize etkinlik olarak eklemek, güncellemek ve
              silmek için kullanılır.
            </li>
          </ul>
          <p>
            Takviminizdeki, uygulama tarafından oluşturulmayan diğer etkinlikleri okumaz, analiz
            etmez veya saklamayız.
          </p>
        </Section>

        <Section title="3. Verileri Nasıl Kullanıyoruz">
          <p>
            Erişilen veriler <strong>yalnızca</strong> takvim senkronizasyonu özelliğini sağlamak
            için kullanılır: Planlama modülünde eklediğiniz/güncellediğiniz/sildiğiniz her görev,
            bağladığınız takvimde ilgili etkinliğe (başlık, not, önem derecesi, alt görevler,
            tarih ve saat) yansıtılır. Verileriniz reklam, profilleme veya bu özellik dışında
            herhangi bir amaç için kullanılmaz.
          </p>
        </Section>

        <Section title="4. Google API Hizmetleri — Sınırlı Kullanım (Limited Use)">
          <p>
            Qore&apos;un Google API&apos;lerinden aldığı bilgileri kullanması ve başka taraflara
            aktarması,{' '}
            <a
              className="text-primary underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Hizmetleri Kullanıcı Verileri Politikası
            </a>
            &apos;na (Sınırlı Kullanım gereklilikleri dâhil) uygundur. Özellikle:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Google kullanıcı verileri yalnızca kullanıcıya sunulan özelliği sağlamak için kullanılır.</li>
            <li>Veriler üçüncü taraflara satılmaz ve reklam amacıyla kullanılmaz.</li>
            <li>Veriler insan tarafından okunmaz; yalnızca güvenlik, mevzuat veya kullanıcı onayı gerektiren durumlarda erişilir.</li>
          </ul>
        </Section>

        <Section title="5. Veri Saklama ve Güvenlik">
          <p>
            Takvim erişimi için gereken yetkilendirme (refresh token) bilgileri, yalnızca sunucu
            tarafından erişilebilen güvenli bir veritabanında saklanır ve mümkün olduğunda şifrelenir
            (AES-256-GCM). Bu bilgilere istemci (tarayıcı) tarafından erişilemez ve veritabanı erişim
            kuralları tüm istemci erişimini reddeder. Görev–etkinlik eşleşmeleri her kullanıcı için
            ayrı tutulur.
          </p>
        </Section>

        <Section title="6. Veri Paylaşımı">
          <p>
            Google/Microsoft hesap verilerinizi üçüncü taraflarla paylaşmayız, satmayız veya
            kiralamayız. Veriler yalnızca Google ve Microsoft&apos;un ilgili API&apos;leriyle, size
            özelliği sunmak için doğrudan iletişimde kullanılır.
          </p>
        </Section>

        <Section title="7. Erişimi Kaldırma ve Veri Silme">
          <p>Bağlantınızı istediğiniz zaman kaldırabilirsiniz:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Uygulama içinde Planlama modülündeki <strong>Takvim</strong> menüsünden ilgili
              sağlayıcıyı <strong>&quot;Bağlantıyı kaldır&quot;</strong> ile ayırın. Bu işlem, saklanan
              yetkilendirme bilgilerinizi siler.
            </li>
            <li>
              Ayrıca{' '}
              <a
                className="text-primary underline"
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Hesap İzinleri
              </a>{' '}
              veya{' '}
              <a
                className="text-primary underline"
                href="https://account.microsoft.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Microsoft Hesap Gizliliği
              </a>{' '}
              sayfalarından uygulamanın erişimini kaldırabilirsiniz.
            </li>
          </ul>
          <p>
            Erişim kaldırıldığında ilgili yetkilendirme verileriniz sistemimizden silinir. Ek veri
            silme talepleri için aşağıdaki iletişim adresinden bize ulaşabilirsiniz.
          </p>
        </Section>

        <Section title="8. Değişiklikler">
          <p>
            Bu politikayı zaman zaman güncelleyebiliriz. Önemli değişikliklerde bu sayfadaki
            &quot;Son güncelleme&quot; tarihini yenileriz.
          </p>
        </Section>

        <Section title="9. İletişim">
          <p>
            Bu gizlilik politikası veya verilerinizle ilgili sorularınız için:{' '}
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
