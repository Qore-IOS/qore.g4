import { VIEWS } from '@/lib/constants';
import type { AppView } from '@/lib/types';

export type ShortcutActionKind = 'navigation' | 'report' | 'mutation' | 'notification';
export type ShortcutParamKey =
  | 'lab'
  | 'depo'
  | 'marka'
  | 'tarihAraligi'
  | 'esikDegeri'
  | 'alicilar'
  | 'ciktiFormati';

export type ShortcutParamType = 'string' | 'string[]' | 'date-range' | 'number' | 'output-format';

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
  tarihAraligi: { key: 'tarihAraligi', label: 'Tarih aralığı', type: 'date-range' },
  esikDegeri: { key: 'esikDegeri', label: 'Eşik değeri', type: 'number' },
  alicilar: { key: 'alicilar', label: 'Alıcılar', type: 'string[]' },
  ciktiFormati: { key: 'ciktiFormati', label: 'Çıktı formatı', type: 'output-format' },
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
