import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kullanım Şartları | Qore',
  description: 'Qore uygulaması ve takvim entegrasyonu özelliğine ilişkin kullanım şartları.',
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

export default function KullanimSartlariPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="space-y-2 border-b pb-6">
        <h1 className="text-3xl font-bold text-foreground">Kullanım Şartları</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LAST_UPDATED}</p>
      </div>

      <div className="mt-8 space-y-8">
        <Section title="1. Kabul">
          <p>
            Qore (&quot;uygulama&quot;) hizmetlerini kullanarak bu Kullanım Şartları&apos;nı kabul
            etmiş olursunuz. Şartları kabul etmiyorsanız uygulamayı kullanmayınız.
          </p>
        </Section>

        <Section title="2. Hizmetin Tanımı">
          <p>
            Qore, envanter ve iş yönetimi işlevleri sunan bir platformdur. Satın-Alma Planlama
            modülü, görevlerinizi yönetmenizi ve isteğe bağlı olarak bunları bağladığınız Google
            veya Microsoft takviminizle senkronize etmenizi sağlar.
          </p>
        </Section>

        <Section title="3. Takvim Entegrasyonu">
          <p>
            Takvim entegrasyonu isteğe bağlıdır ve yalnızca sizin açık yetkilendirmenizle
            etkinleşir. Bağlandığınızda, uygulamada oluşturduğunuz görevler takviminize etkinlik
            olarak eklenir. Erişilen veriler ve nasıl işlendiği{' '}
            <a className="text-primary underline" href="/gizlilik-politikasi">
              Gizlilik Politikası
            </a>
            &apos;nda açıklanmıştır. Bağlantıyı istediğiniz zaman uygulama içinden kaldırabilirsiniz.
          </p>
        </Section>

        <Section title="4. Kullanıcı Sorumlulukları">
          <ul className="list-disc space-y-1 pl-6">
            <li>Hesap kimlik bilgilerinizin gizliliğini korumakla siz sorumlusunuz.</li>
            <li>Uygulamayı yürürlükteki yasalara ve bu şartlara uygun şekilde kullanmalısınız.</li>
            <li>Uygulamaya veya bağlı hizmetlere zarar verecek, yetkisiz erişim sağlayacak eylemlerden kaçınmalısınız.</li>
          </ul>
        </Section>

        <Section title="5. Hizmetin Sürekliliği">
          <p>
            Hizmeti kesintisiz ve hatasız sunmak için makul çaba gösteririz; ancak bakım, teknik
            arıza veya üçüncü taraf hizmetlerdeki (Google, Microsoft, altyapı sağlayıcıları)
            değişiklikler nedeniyle geçici kesintiler yaşanabilir.
          </p>
        </Section>

        <Section title="6. Sorumluluğun Sınırlandırılması">
          <p>
            Uygulama &quot;olduğu gibi&quot; sunulur. Yürürlükteki yasaların izin verdiği ölçüde,
            uygulamanın kullanımından doğan dolaylı veya sonuç niteliğindeki zararlardan sorumlu
            tutulamayız. Takvim senkronizasyonu üçüncü taraf API&apos;lerine bağlı olduğundan, bu
            servislerdeki değişikliklerden kaynaklanan aksaklıklar kapsam dışıdır.
          </p>
        </Section>

        <Section title="7. Değişiklikler">
          <p>
            Bu şartları zaman zaman güncelleyebiliriz. Güncel sürüm bu sayfada yayımlanır ve
            &quot;Son güncelleme&quot; tarihi yenilenir. Değişikliklerden sonra uygulamayı kullanmaya
            devam etmeniz, güncel şartları kabul ettiğiniz anlamına gelir.
          </p>
        </Section>

        <Section title="8. İletişim">
          <p>
            Sorularınız için:{' '}
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
