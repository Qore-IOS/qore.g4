export type ShortcutMetricValue = string | number | boolean | null;

export interface ShortcutContext {
  shortcutId: string;
  runId: string;
  companyId?: string | null;
  createdByUid?: string | null;
  createdByName?: string | null;
  now: Date;
}

export interface ShortcutParams {
  [key: string]: unknown;
}

export interface ShortcutResult {
  status?: 'success' | 'skipped' | 'failed';
  summaryText: string;
  rows?: Record<string, unknown>[];
  metrics?: Record<string, ShortcutMetricValue>;
  attachments?: Array<{
    name: string;
    contentType?: string;
    url?: string;
    path?: string;
    sizeBytes?: number;
  }>;
  warnings?: string[];
  deepLink?: string;
}

export interface ShortcutHandler<TParams extends ShortcutParams = ShortcutParams> {
  key: string;
  label: string;
  handle(params: TParams, context: ShortcutContext): Promise<ShortcutResult>;
}

const emptyReport = (key: string, label: string, deepLink: string): ShortcutHandler => ({
  key,
  label,
  async handle(params, context) {
    return {
      status: 'success',
      summaryText: `${label} handler completed. Data collection is not configured yet.`,
      rows: [],
      metrics: {
        rowCount: 0,
        generatedAt: context.now.toISOString(),
        hasParams: Object.keys(params).length > 0,
      },
      attachments: [],
      warnings: ['Bu rapor için veri toplama mantığı henüz bağlanmadı.'],
      deepLink,
    };
  },
});

export const shortcutHandlers = {
  noop: {
    key: 'noop',
    label: 'Noop shortcut handler',
    async handle(params, context) {
      return {
        status: 'success',
        summaryText: 'Shortcut noop handler completed.',
        rows: [],
        metrics: {
          rowCount: 0,
          generatedAt: context.now.toISOString(),
          hasParams: Object.keys(params).length > 0,
        },
        attachments: [],
        warnings: [],
        deepLink: undefined,
      };
    },
  },
  'stock-risk-report': emptyReport('stock-risk-report', 'Stok risk raporu', '/raporlama/stok-risk-raporu'),
  'stock-expiry-report': emptyReport('stock-expiry-report', 'Stok miad raporu', '/raporlama/stok-miad-raporu'),
  'lab-consumption-report': emptyReport('lab-consumption-report', 'Laboratuvar tüketim raporu', '/tuketim-istatistikleri'),
  'pending-orders-report': emptyReport('pending-orders-report', 'Bekleyen siparişler raporu', '/siparisler'),
  'mal-kabul-summary-report': emptyReport('mal-kabul-summary-report', 'Mal kabul özet raporu', '/mal-kabul/gecmis'),
  'direct-transfer-open-items-report': emptyReport('direct-transfer-open-items-report', 'Açık direkt transfer kalemleri raporu', '/direkt-transfer'),
  'fault-open-aging-report': emptyReport('fault-open-aging-report', 'Açık arıza yaşlandırma raporu', '/ariza-bildirimleri'),
  'total-efficiency-weekly-report': emptyReport('total-efficiency-weekly-report', 'Haftalık total verimlilik raporu', '/total-verimlilik'),
  'cost-dashboard-weekly-report': emptyReport('cost-dashboard-weekly-report', 'Haftalık maliyet paneli raporu', '/cost-dashboard'),
} as const satisfies Record<string, ShortcutHandler>;

export type ShortcutHandlerKey = keyof typeof shortcutHandlers;
