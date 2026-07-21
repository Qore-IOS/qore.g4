import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Qore — Envanter ve İş Yönetimi Platformu',
  description:
    'Qore, medikal tedarik ve lojistik operasyonları için envanter takibi, satın-alma planlama ve takvim entegrasyonu sunan bir web uygulamasıdır.',
};

const CONTACT_EMAIL = 'btubasar@gmail.com';

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export default function HakkindaPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Üst bar */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-2xl font-extrabold tracking-tight">Qore</span>
        <nav className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
          <Link href="/gizlilik-politikasi" className="hover:text-foreground">
            Gizlilik
          </Link>
          <Link href="/kullanim-sartlari" className="hover:text-foreground">
            Şartlar
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            Giriş yap
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-8 pt-10 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Envanter ve iş süreçleri için tek platform: <span className="text-primary">Qore</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Qore, medikal tedarik ve lojistik operasyonları için geliştirilmiş bir web uygulamasıdır.
          Merkezi depo ve sahadaki stokları gerçek zamanlı takip eder; satın-alma planlaması, görev
          yönetimi, sevkiyat ve raporlama süreçlerini tek bir yerde toplar.
        </p>
      </section>

      {/* Özellikler */}
      <section className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature title="Envanter Takibi">
            Barkod tabanlı seri numarası takibi, son kullanma (miad) uyarıları ve konumlar arası stok
            görünürlüğü.
          </Feature>
          <Feature title="Satın-Alma Planlama">
            Görevleri planlayın, önceliklendirin ve takip edin; to-do tarzı bir arayüzle ekip iş
            akışını yönetin.
          </Feature>
          <Feature title="Takvim Entegrasyonu">
            Google Takvim veya Microsoft Outlook hesabınızı bir kez bağlayın; planladığınız görevler
            tüm detaylarıyla takviminize otomatik işlensin.
          </Feature>
          <Feature title="Sevkiyat ve Sipariş">
            FIFO/FEFO mantığıyla toplama, sipariş oluşturma ve sevkiyat geçmişi yönetimi.
          </Feature>
          <Feature title="Raporlama">
            Tüketim, verimlilik ve maliyet analizleri için görselleştirilmiş raporlar.
          </Feature>
          <Feature title="Çok Kiracılı Yapı">
            Her kurumun verisi izole; rol bazlı erişim ve güvenli yetkilendirme.
          </Feature>
        </div>
      </section>

      {/* Takvim entegrasyonu detayı */}
      <section className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-2xl border bg-card p-8">
          <h2 className="text-2xl font-bold">Takvim Entegrasyonu Nasıl Çalışır?</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Satın-Alma Planlama modülünde, sağ üstteki <strong>Takvim</strong> menüsünden Google veya
            Microsoft hesabınızı bağlarsınız. Bağlandıktan sonra eklediğiniz, güncellediğiniz veya
            sildiğiniz her görev; başlığı, notu, önem derecesi, alt görevleri ve tarih/saat bilgisiyle
            birlikte bağlı takviminize senkronize edilir. Bağlantıyı istediğiniz zaman aynı menüden
            kaldırabilirsiniz. Erişilen verilerin nasıl işlendiğini{' '}
            <Link href="/gizlilik-politikasi" className="text-primary underline">
              Gizlilik Politikası
            </Link>{' '}
            sayfamızda bulabilirsiniz.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">
        <div className="flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row">
          <span className="font-semibold text-foreground">Qore</span>
          <div className="flex items-center gap-4">
            <Link href="/gizlilik-politikasi" className="hover:text-foreground">
              Gizlilik Politikası
            </Link>
            <Link href="/kullanim-sartlari" className="hover:text-foreground">
              Kullanım Şartları
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
              İletişim
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
