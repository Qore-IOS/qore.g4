"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortcutHandlers = void 0;
const emptyReport = (key, label, deepLink) => ({
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
exports.shortcutHandlers = {
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
};
//# sourceMappingURL=index.js.map