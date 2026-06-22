export type StockRiskReportId =
  | 'low-stock'
  | 'expiry-watch'
  | 'inactive-stock'
  | 'critical-location-summary'
  | 'overstock';

export type StockRiskOutputFormat = 'table' | 'pdf' | 'excel';
export type StockRiskDeliveryChannel = 'email' | 'whatsapp' | 'app-notification';

export interface StockRiskReportAutomation {
  id: StockRiskReportId;
  title: string;
  description: string;
  trigger: string;
  defaultThresholdDays?: number;
  thresholdDayOptions?: number[];
  riskSignal: string;
  stockManagementFilter: Record<string, string>;
}

export const STOCK_RISK_REPORT_AUTOMATIONS: StockRiskReportAutomation[] = [
  {
    id: 'low-stock',
    title: 'Riskli stoklar',
    description: 'Mevcut miktarı tanımlı min-max kuralındaki minimum seviyenin altına düşen ürünleri listeler.',
    trigger: 'stockQuantity < minQuantity',
    riskSignal: 'Min altı stok',
    stockManagementFilter: { risk: 'low-stock', compare: 'below-min' },
  },
  {
    id: 'expiry-watch',
    title: 'Miadı yaklaşan ürünler',
    description: 'Miad tarihine kalan gün sayısı seçilen 7/15/30/60 gün eşiğine giren lotları izler.',
    trigger: 'daysUntilExpiry <= thresholdDays',
    defaultThresholdDays: 30,
    thresholdDayOptions: [7, 15, 30, 60],
    riskSignal: 'Miad yaklaşımı',
    stockManagementFilter: { risk: 'expiry-watch' },
  },
  {
    id: 'inactive-stock',
    title: 'Hareketsiz stok',
    description: 'X gündür giriş, çıkış, transfer veya tüketim hareketi görmeyen ürünleri raporlar.',
    trigger: 'daysSinceLastMovement >= thresholdDays',
    defaultThresholdDays: 90,
    thresholdDayOptions: [30, 60, 90, 180, 365],
    riskSignal: 'Hareketsiz ürün',
    stockManagementFilter: { risk: 'inactive-stock' },
  },
  {
    id: 'critical-location-summary',
    title: 'Kritik depo özeti',
    description: 'Depo/lab bazında min altı, miad yaklaşımı, hareketsiz ve fazla stok durumunu tek özet halinde gösterir.',
    trigger: 'groupBy(locationId, labId, riskSignal)',
    riskSignal: 'Lokasyon kırılımı',
    stockManagementFilter: { risk: 'critical-location-summary', groupBy: 'location' },
  },
  {
    id: 'overstock',
    title: 'Fazla stok',
    description: 'Maksimum seviyenin üstündeki veya tüketim hızı düşük olduğu için elde kalma riski taşıyan ürünleri belirler.',
    trigger: 'stockQuantity > maxQuantity || consumptionRate <= lowConsumptionThreshold',
    defaultThresholdDays: 60,
    thresholdDayOptions: [30, 60, 90, 180],
    riskSignal: 'Max üstü / düşük tüketim',
    stockManagementFilter: { risk: 'overstock', compare: 'above-max-or-low-consumption' },
  },
];

export const STOCK_RISK_REPORT_PARAMETERS = [
  'depo/lab seçimi',
  'ürün grubu / marka',
  'eşik gün sayısı',
  'çıktı formatı: tablo, PDF, Excel',
  'gönderim kanalı: e-posta, WhatsApp, uygulama bildirimi',
] as const;

export function buildStockRiskDeepLink(
  automation: StockRiskReportAutomation,
  options: {
    depotOrLab?: string;
    productGroup?: string;
    brand?: string;
    thresholdDays?: number;
    outputFormat?: StockRiskOutputFormat;
    deliveryChannel?: StockRiskDeliveryChannel;
  } = {},
) {
  const params = new URLSearchParams({
    ...automation.stockManagementFilter,
    source: 'stock-risk-report',
  });

  if (options.depotOrLab) params.set('location', options.depotOrLab);
  if (options.productGroup) params.set('productGroup', options.productGroup);
  if (options.brand) params.set('brand', options.brand);
  if (options.thresholdDays) params.set('thresholdDays', String(options.thresholdDays));
  if (options.outputFormat) params.set('outputFormat', options.outputFormat);
  if (options.deliveryChannel) params.set('deliveryChannel', options.deliveryChannel);

  return `/stok-yonetimi?${params.toString()}`;
}
