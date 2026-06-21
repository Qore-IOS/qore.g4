import { VIEWS } from '@/lib/constants';
import type { AppView } from '@/lib/types';

export type ShortcutActionKind = 'navigation' | 'report' | 'mutation' | 'notification';
export type ShortcutParamKey =
  | 'lab'
  | 'depo'
  | 'marka'
  | 'urunGrubu'
  | 'urunKoduMarka'
  | 'tarihAraligi'
  | 'esikDegeri'
  | 'esikGunSayisi'
  | 'alicilar'
  | 'ciktiFormati'
  | 'gonderimKanali';

export type ShortcutParamType = 'string' | 'string[]' | 'date-range' | 'number' | 'output-format' | 'delivery-channel';

export interface ShortcutParamSchemaItem {
  key: ShortcutParamKey;
  label: string;
  type: ShortcutParamType;
  required?: boolean;
}

export interface ShortcutAction {
  key: string;
  label: string;
  description: string;
  kind: ShortcutActionKind;
  params: ShortcutParamSchemaItem[];
  handlerKey: string;
  href?: string;
}

export interface ShortcutPanelCatalogItem {
  panelKey: AppView | string;
  panelLabel: string;
  requiredView: AppView | string;
  actions: ShortcutAction[];
}

const PARAMS = {
  lab: { key: 'lab', label: 'Laboratuvar', type: 'string[]' },
  depo: { key: 'depo', label: 'Depo', type: 'string[]' },
  marka: { key: 'marka', label: 'Marka', type: 'string[]' },
  urunGrubu: { key: 'urunGrubu', label: 'Ürün grubu', type: 'string[]' },
  urunKoduMarka: { key: 'urunKoduMarka', label: 'Ürün kodu / marka', type: 'string[]' },
  tarihAraligi: { key: 'tarihAraligi', label: 'Tarih aralığı', type: 'date-range' },
  esikDegeri: { key: 'esikDegeri', label: 'Eşik değeri', type: 'number' },
  esikGunSayisi: { key: 'esikGunSayisi', label: 'Eşik gün sayısı', type: 'number' },
  alicilar: { key: 'alicilar', label: 'Alıcılar', type: 'string[]' },
  ciktiFormati: { key: 'ciktiFormati', label: 'Çıktı formatı', type: 'output-format' },
  gonderimKanali: { key: 'gonderimKanali', label: 'Gönderim kanalı', type: 'delivery-channel' },
} as const satisfies Record<ShortcutParamKey, ShortcutParamSchemaItem>;

const panelLabel = (key: string, fallback: string) =>
  VIEWS.find((view) => view.key === key)?.label ?? fallback;

const navigationAction = (
  panelKey: string,
  label: string,
  href: string,
  description = `${label} ekranına git.`,
): ShortcutAction => ({
  key: `${panelKey}.open`,
  label,
  description,
  kind: 'navigation',
  params: [],
  handlerKey: `shortcuts.${panelKey}.open`,
  href,
});

const FAULT_OPERATIONS_SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    key: 'ariza-yonetimi.acik-ariza-yaslandirma-raporu',
    label: 'Açık arıza yaşlandırma raporu',
    description: 'Açık arızaları bekleme süresine göre sıralayıp yeni shortcut scheduler ile raporla.',
    kind: 'report',
    params: [PARAMS.lab, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
    handlerKey: 'fault-open-aging-report',
    href: '/ariza-yonetimi',
  },
  {
    key: 'ariza-yonetimi.sla-asimi-uyarisi',
    label: 'SLA aşımı uyarısı',
    description: 'Müdahale veya çözüm SLA eşiğini aşan açık arızaları shortcut scheduler üzerinden bildir.',
    kind: 'notification',
    params: [PARAMS.lab, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.gonderimKanali],
    handlerKey: 'fault-sla-breach-alert',
    href: '/ariza-yonetimi?status=mudahale_bekliyor',
  },
  {
    key: 'ariza-yonetimi.parca-bekleyen-islemler',
    label: 'Parça bekleyen işlemler',
    description: 'Parça beklediği işaretlenen veya açıklamasında parça bekleme bilgisi olan açık arıza işlemlerini listele.',
    kind: 'report',
    params: [PARAMS.lab, PARAMS.alicilar, PARAMS.ciktiFormati],
    handlerKey: 'fault-pending-parts-operations',
    href: '/ariza-yonetimi',
  },
  {
    key: 'ariza-yonetimi.teknisyen-haftalik-is-ozeti',
    label: 'Teknisyen bazlı haftalık iş özeti',
    description: 'Son 7 gündeki atanan, açık ve kapanan arızaları teknisyen bazında özetle.',
    kind: 'report',
    params: [PARAMS.tarihAraligi, PARAMS.alicilar, PARAMS.ciktiFormati],
    handlerKey: 'technician-weekly-work-summary',
    href: '/cihaz-yonetimi-ana',
  },
  {
    key: 'ariza-yonetimi.kapanmis-ariza-kalite-kontrol',
    label: 'Kapanmış arıza kalite kontrol raporu',
    description: 'Kapanmış arızalarda açıklama ve çözüm süresi gibi kalite kontrol sinyallerini raporla.',
    kind: 'report',
    params: [PARAMS.tarihAraligi, PARAMS.lab, PARAMS.alicilar, PARAMS.ciktiFormati],
    handlerKey: 'closed-fault-quality-control-report',
    href: '/ariza-yonetimi?status=cozuldu',
  },
  {
    key: 'cihaz-yonetimi.bakim-yaklasan-tarih-bildirimi',
    label: 'Cihaz bakım yaklaşan tarih bildirimi',
    description: 'Scheduled bakım hatırlatıcılarıyla aynı bakım planı verisini kullanarak yaklaşan bakım tarihlerini bildir.',
    kind: 'notification',
    params: [PARAMS.lab, PARAMS.esikGunSayisi, PARAMS.alicilar, PARAMS.gonderimKanali],
    handlerKey: 'device-maintenance-upcoming-date-notification',
    href: '/cihaz-tanimlamalari/periyodik-bakim-yonetimi',
  },
];

export const SHORTCUT_CATALOG: ShortcutPanelCatalogItem[] = [
  {
    panelKey: 'dashboard',
    panelLabel: panelLabel('dashboard', 'Ana Panel'),
    requiredView: 'dashboard',
    actions: [navigationAction('dashboard', 'Ana paneli aç', '/dashboard')],
  },
  {
    panelKey: 'arama',
    panelLabel: panelLabel('arama', 'Arama'),
    requiredView: 'arama',
    actions: [navigationAction('arama', 'Genel arama yap', '/arama', 'Ürün, depo, laboratuvar ve işlem kayıtlarında arama yap.')],
  },
  {
    panelKey: 'mal-kabul',
    panelLabel: panelLabel('mal-kabul', 'Mal Kabul'),
    requiredView: 'mal-kabul',
    actions: [
      navigationAction('mal-kabul', 'Mal kabul başlat', '/mal-kabul', 'Yeni mal kabul akışını aç.'),
      navigationAction('mal-kabul-gecmis', 'Mal kabul geçmişi', '/mal-kabul/gecmis', 'Geçmiş mal kabul kayıtlarını listele.'),
    ],
  },
  {
    panelKey: 'siparisler',
    panelLabel: panelLabel('siparisler', 'Siparişler'),
    requiredView: 'siparisler',
    actions: [
      navigationAction('siparisler', 'Siparişleri aç', '/siparisler'),
      navigationAction('siparis-gecmis', 'Sipariş geçmişi', '/siparisler?tab=tamamlanan', 'Tamamlanan siparişleri göster.'),
      navigationAction('direkt-transfer', 'Direkt transfer oluştur', '/direkt-transfer', 'Depolar arası direkt transfer ekranını aç.'),
    ],
  },
  {
    panelKey: 'direkt-transfer',
    panelLabel: panelLabel('direkt-transfer', 'Direkt Transfer'),
    requiredView: 'direkt-transfer',
    actions: [navigationAction('direkt-transfer', 'Direkt transfer aç', '/direkt-transfer')],
  },
  {
    panelKey: 'route-planlayici',
    panelLabel: panelLabel('route-planlayici', 'Route Planlayıcı'),
    requiredView: 'route-planlayici',
    actions: [navigationAction('route-planlayici', 'Route planlayıcıyı aç', '/route-planlayici')],
  },
  {
    panelKey: 'stok-yonetimi',
    panelLabel: panelLabel('stok-yonetimi', 'Stok Yönetimi'),
    requiredView: 'stok-yonetimi',
    actions: [
      navigationAction('stok-yonetimi', 'Stok yönetimini aç', '/stok-yonetimi'),
      {
        key: 'stok-yonetimi.esik-raporu',
        label: 'Eşik altı stok raporu',
        description: 'Seçilen depo, marka ve eşik değerine göre düşük stok listesini üret.',
        kind: 'report',
        params: [PARAMS.depo, PARAMS.marka, PARAMS.esikDegeri, PARAMS.ciktiFormati],
        handlerKey: 'shortcuts.stokYonetimi.lowStockReport',
      },
    ],
  },
  {
    panelKey: 'depo-sayim',
    panelLabel: panelLabel('depo-sayim', 'Depo Sayım'),
    requiredView: 'depo-sayim',
    actions: [navigationAction('depo-sayim', 'Depo sayımını aç', '/depo-sayim')],
  },
  {
    panelKey: 'laboratuvar-yonetimi',
    panelLabel: panelLabel('laboratuvar-yonetimi', 'Lab. Stok Yönetimi'),
    requiredView: 'laboratuvar-yonetimi',
    actions: [
      navigationAction('laboratuvar-yonetimi', 'Lab stoklarını aç', '/laboratuvar-yonetimi'),
      {
        key: 'laboratuvar-yonetimi.miad-bildirimi',
        label: 'Miad uyarısı gönder',
        description: 'Laboratuvar ve tarih aralığına göre miad uyarısı bildirimi hazırla.',
        kind: 'notification',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.alicilar],
        handlerKey: 'shortcuts.laboratuvarYonetimi.expiryNotification',
      },
    ],
  },
  {
    panelKey: 'urun-kullanim',
    panelLabel: panelLabel('urun-kullanim', 'Ürün Kullanım'),
    requiredView: 'urun-kullanim',
    actions: [
      navigationAction('urun-talep', 'Ürün talebi oluştur', '/urun-talep', 'Ürün talep ekranını aç.'),
      navigationAction('tuketim-istatistikleri', 'Tüketim istatistikleri', '/tuketim-istatistikleri', 'Ürün kullanım istatistiklerini aç.'),
      navigationAction('kullanim-dogrulama', 'Kullanım doğrulama', '/kullanim-dogrulama', 'Kullanım doğrulama kuyruğunu aç.'),
      {
        key: 'urun-kullanim.gunluk-tuketim-ozeti',
        label: 'Günlük tüketim özeti',
        description: 'Seçilen laboratuvar, tarih aralığı, ürün kodu/marka, eşik miktar ve alıcı grubuna göre günlük tüketim özetini PDF, Excel ve kısa mesaj özeti olarak üret.',
        kind: 'report',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.urunKoduMarka, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'urun-kullanim.daily-consumption-summary',
      },
      {
        key: 'urun-kullanim.haftalik-lab-tuketim-raporu',
        label: 'Haftalık lab tüketim raporu',
        description: 'Laboratuvar bazlı haftalık tüketim raporunu filtrelere göre PDF, Excel ve kısa mesaj özeti olarak hazırla.',
        kind: 'report',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.urunKoduMarka, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'urun-kullanim.weekly-lab-consumption-report',
      },
      {
        key: 'urun-kullanim.fefo-disi-kullanim-listesi',
        label: 'FEFO dışı kullanım listesi',
        description: 'Miad önceliğine uymayan kullanımları seçili filtrelerle listeleyip PDF, Excel ve kısa mesaj özeti olarak üret.',
        kind: 'report',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.urunKoduMarka, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'urun-kullanim.non-fefo-usage-list',
      },
      {
        key: 'urun-kullanim.seri-lot-tekrar-kullanim-suphesi',
        label: 'Seri/lot tekrar kullanım şüphesi',
        description: 'Aynı seri/lot için tekrar kullanım şüphesi oluşturan kayıtları PDF, Excel ve kısa mesaj özetiyle raporla.',
        kind: 'report',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.urunKoduMarka, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'urun-kullanim.serial-lot-reuse-suspicions',
      },
      {
        key: 'urun-kullanim.cihaz-lab-bazli-sarf-kirilimi',
        label: 'Cihaz/lab bazlı sarf kırılımı',
        description: 'Cihaz ve laboratuvar bazında sarf tüketim kırılımını PDF, Excel ve kısa mesaj özeti olarak üret.',
        kind: 'report',
        params: [PARAMS.lab, PARAMS.tarihAraligi, PARAMS.urunKoduMarka, PARAMS.esikDegeri, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'urun-kullanim.device-lab-consumable-breakdown',
      },
    ],
  },
  {
    panelKey: 'sarf-dagitim',
    panelLabel: panelLabel('sarf-dagitim', 'Sarf Dağıtım'),
    requiredView: 'sarf-dagitim',
    actions: [navigationAction('sarf-dagitim', 'Sarf dağıtımı aç', '/sarf-dagitim')],
  },
  {
    panelKey: 'numune-arsivi',
    panelLabel: panelLabel('numune-arsivi', 'Numune Arşivi'),
    requiredView: 'numune-arsivi',
    actions: [navigationAction('numune-arsivi', 'Numune arşivini aç', '/numune-arsivi')],
  },
  {
    panelKey: 'cihazdan-cikan-kit',
    panelLabel: panelLabel('cihazdan-cikan-kit', 'Cihazdan Çıkan Kit'),
    requiredView: 'cihazdan-cikan-kit',
    actions: [navigationAction('cihazdan-cikan-kit', 'Cihazdan çıkan kitleri aç', '/cihazdan-cikan-kit')],
  },
  {
    panelKey: 'raporlama',
    panelLabel: panelLabel('raporlama', 'Raporlama'),
    requiredView: 'raporlama',
    actions: [
      navigationAction('hareketsiz-stok', 'Hareketsiz stok raporu', '/raporlama/hareketsiz-stok-raporu'),
      navigationAction('minmax-grafik', 'Min-Max grafik', '/raporlama/minmax-urun-grafik'),
      navigationAction('gecmis-stok', 'Geçmiş stok raporu', '/raporlama/gecmis-stok-raporu'),
      {
        key: 'raporlama.stock-risk-report',
        label: 'Stok risk raporu otomasyonu',
        description: 'Riskli stok, miad yaklaşımı, hareketsiz stok, kritik depo özeti ve fazla stok raporlarını filtre, çıktı ve gönderim parametreleriyle üret.',
        kind: 'report',
        params: [PARAMS.depo, PARAMS.lab, PARAMS.urunGrubu, PARAMS.marka, PARAMS.esikGunSayisi, PARAMS.ciktiFormati, PARAMS.gonderimKanali],
        handlerKey: 'shortcuts.raporlama.stockRiskReport',
        href: '/raporlama/stock-risk-report',
      },
      {
        key: 'raporlama.planli-rapor',
        label: 'Planlı rapor oluştur',
        description: 'Tarih aralığı, alıcılar ve çıktı formatına göre rapor üretimini sıraya al.',
        kind: 'report',
        params: [PARAMS.tarihAraligi, PARAMS.alicilar, PARAMS.ciktiFormati],
        handlerKey: 'shortcuts.raporlama.scheduledReport',
      },
    ],
  },
  {
    panelKey: 'is-analizi',
    panelLabel: panelLabel('is-analizi', 'İş Analizi'),
    requiredView: 'is-analizi',
    actions: [navigationAction('is-analizi', 'İş analizini aç', '/is-analizi')],
  },
  {
    panelKey: 'total-verimlilik',
    panelLabel: panelLabel('total-verimlilik', 'Total Verimlilik'),
    requiredView: 'total-verimlilik',
    actions: [navigationAction('total-verimlilik', 'Total verimlilik aç', '/total-verimlilik')],
  },
  {
    panelKey: 'cost-dashboard',
    panelLabel: panelLabel('cost-dashboard', 'Maliyet Paneli'),
    requiredView: 'cost-dashboard',
    actions: [navigationAction('cost-dashboard', 'Maliyet panelini aç', '/cost-dashboard')],
  },
  {
    panelKey: 'kumulatif-hesaplama',
    panelLabel: panelLabel('kumulatif-hesaplama', 'Kümülatif Hesaplama'),
    requiredView: 'kumulatif-hesaplama',
    actions: [navigationAction('kumulatif-hesaplama', 'Kümülatif hesaplama aç', '/kumulatif-hesaplama')],
  },
  {
    panelKey: 'cihaz-ustu-hesaplama',
    panelLabel: panelLabel('cihaz-ustu-hesaplama', 'Cihaz Üstü Hesaplama'),
    requiredView: 'cihaz-ustu-hesaplama',
    actions: [navigationAction('cihaz-ustu-hesaplama', 'Cihaz üstü hesaplama aç', '/cihaz-ustu-hesaplama')],
  },
  {
    panelKey: 'cihaz-yonetimi-ana',
    panelLabel: panelLabel('cihaz-yonetimi-ana', 'Cihaz Yönetimi'),
    requiredView: 'cihaz-yonetimi-ana',
    actions: [
      navigationAction('teknik-servis', 'Teknik servis', '/teknik-servis'),
      navigationAction('ariza-yonetimi', 'Tüm arızalar', '/ariza-yonetimi'),
      ...FAULT_OPERATIONS_SHORTCUT_ACTIONS.map((action) => ({
        ...action,
        key: action.key.replace('ariza-yonetimi.', 'cihaz-yonetimi-ana.'),
      })),
    ],
  },
  {
    panelKey: 'teknik-servis',
    panelLabel: panelLabel('teknik-servis', 'Teknik Servis'),
    requiredView: 'teknik-servis',
    actions: [
      navigationAction('teknik-servis', 'Teknik servis panelini aç', '/teknik-servis'),
      ...FAULT_OPERATIONS_SHORTCUT_ACTIONS.map((action) => ({
        ...action,
        key: action.key.replace('ariza-yonetimi.', 'teknik-servis.').replace('cihaz-yonetimi.', 'teknik-servis.'),
      })),
    ],
  },
  {
    panelKey: 'aplikasyon-paneli',
    panelLabel: panelLabel('aplikasyon-paneli', 'Aplikasyon Paneli'),
    requiredView: 'aplikasyon-paneli',
    actions: [
      navigationAction('aplikasyon-paneli', 'Aplikasyon panelini aç', '/aplikasyon-paneli'),
      ...FAULT_OPERATIONS_SHORTCUT_ACTIONS.map((action) => ({
        ...action,
        key: action.key.replace('ariza-yonetimi.', 'aplikasyon-paneli.').replace('cihaz-yonetimi.', 'aplikasyon-paneli.'),
      })),
    ],
  },
  {
    panelKey: 'ariza-yonetimi',
    panelLabel: panelLabel('ariza-yonetimi', 'Arıza Yönetimi'),
    requiredView: 'ariza-yonetimi',
    actions: [
      navigationAction('ariza-yonetimi', 'Tüm arızaları aç', '/ariza-yonetimi'),
      ...FAULT_OPERATIONS_SHORTCUT_ACTIONS,
    ],
  },
  {
    panelKey: 'personel-islemleri',
    panelLabel: panelLabel('personel-islemleri', 'Personel İşlemleri'),
    requiredView: 'personel-islemleri',
    actions: [navigationAction('ek-mesai-bildirimi', 'Ek mesai bildirimi', '/personel-islemleri/ek-mesai')],
  },
  {
    panelKey: 'satin-alma',
    panelLabel: panelLabel('satin-alma', 'Planlama Birimi'),
    requiredView: 'satin-alma',
    actions: [navigationAction('satin-alma', 'Planlama birimini aç', '/satin-alma')],
  },
  {
    panelKey: 'kullanici-talepleri',
    panelLabel: panelLabel('kullanici-talepleri', 'Talepler'),
    requiredView: 'kullanici-talepleri',
    actions: [navigationAction('kullanici-talepleri', 'Talepleri aç', '/kullanici-talepleri')],
  },
  {
    panelKey: 'cari-odeme',
    panelLabel: panelLabel('cari-odeme', 'Cari Ödeme'),
    requiredView: 'cari-odeme',
    actions: [
      navigationAction('cari-odeme-genel', 'Cari ödeme paneli', '/cari-odeme'),
      navigationAction('cari-odemeler', 'Ödemeler', '/cari-odeme/odemeler'),
      navigationAction('cari-sablonlar', 'Ödeme talimatları', '/cari-odeme/sablonlar'),
      navigationAction('cari-firmalar', 'Cari firmalar', '/cari-odeme/firmalar'),
    ],
  },
  {
    panelKey: 'yonetim',
    panelLabel: panelLabel('yonetim', 'Yönetim'),
    requiredView: 'yonetim',
    actions: [
      navigationAction('tanimlar', 'Tanımlar', '/yonetim/tanimlar'),
      navigationAction('depolar', 'Depo yönetimi', '/yonetim/depolar'),
      navigationAction('laboratuvarlar', 'Laboratuvar yönetimi', '/yonetim/laboratuvarlar'),
      navigationAction('kullanicilar', 'Kullanıcı yönetimi', '/yonetim/kullanicilar'),
      {
        key: 'yonetim.toplu-bildirim',
        label: 'Toplu bildirim gönder',
        description: 'Seçilen alıcılara panel erişimi ve laboratuvar/depo hedefli bildirim gönder.',
        kind: 'notification',
        params: [PARAMS.lab, PARAMS.depo, PARAMS.alicilar],
        handlerKey: 'shortcuts.yonetim.bulkNotification',
      },
    ],
  },
];

export const getShortcutCatalogForViews = (accessibleViews: readonly string[]) => {
  const allowed = new Set(accessibleViews);
  return SHORTCUT_CATALOG.filter((panel) => allowed.has(panel.requiredView));
};

export const getShortcutActionsForViews = (accessibleViews: readonly string[]) =>
  getShortcutCatalogForViews(accessibleViews).flatMap((panel) =>
    panel.actions.map((action) => ({ ...action, panelKey: panel.panelKey, panelLabel: panel.panelLabel, requiredView: panel.requiredView })),
  );
