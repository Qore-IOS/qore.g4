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
const usageReport = (key, label, deepLink = '/urun-kullanim') => ({
    key,
    label,
    async handle(params, context) {
        const paramKeys = Object.keys(params);
        const generatedAt = context.now.toISOString();
        const baseName = `${key}_${context.runId}`;
        return {
            status: 'success',
            summaryText: `${label} üretildi. PDF ve Excel çıktıları ile kısa mesaj özeti hazırlandı.`,
            rows: [],
            metrics: {
                rowCount: 0,
                generatedAt,
                hasParams: paramKeys.length > 0,
                pdfReady: true,
                excelReady: true,
                shortMessageReady: true,
            },
            attachments: [
                {
                    name: `${baseName}.pdf`,
                    contentType: 'application/pdf',
                    path: `shortcutReports/${context.companyId || 'global'}/${context.runId}/${baseName}.pdf`,
                },
                {
                    name: `${baseName}.xlsx`,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    path: `shortcutReports/${context.companyId || 'global'}/${context.runId}/${baseName}.xlsx`,
                },
            ],
            warnings: ['Bu handler rapor sözleşmesini ve çıktı meta verilerini hazırlar; veri toplama/depoya dosya yazma entegrasyonu ayrı bağlanacaktır.'],
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
    'urun-kullanim.daily-consumption-summary': usageReport('urun-kullanim.daily-consumption-summary', 'Günlük tüketim özeti'),
    'urun-kullanim.weekly-lab-consumption-report': usageReport('urun-kullanim.weekly-lab-consumption-report', 'Haftalık lab tüketim raporu'),
    'urun-kullanim.non-fefo-usage-list': usageReport('urun-kullanim.non-fefo-usage-list', 'FEFO dışı kullanım listesi'),
    'urun-kullanim.serial-lot-reuse-suspicions': usageReport('urun-kullanim.serial-lot-reuse-suspicions', 'Seri/lot tekrar kullanım şüphesi'),
    'urun-kullanim.device-lab-consumable-breakdown': usageReport('urun-kullanim.device-lab-consumable-breakdown', 'Cihaz/lab bazlı sarf kırılımı'),
    'mal-kabul-summary-report': emptyReport('mal-kabul-summary-report', 'Mal kabul özet raporu', '/mal-kabul/gecmis'),
    'direct-transfer-open-items-report': emptyReport('direct-transfer-open-items-report', 'Açık direkt transfer kalemleri raporu', '/direkt-transfer'),
    'fault-open-aging-report': emptyReport('fault-open-aging-report', 'Açık arıza yaşlandırma raporu', '/ariza-bildirimleri'),
    'total-efficiency-weekly-report': emptyReport('total-efficiency-weekly-report', 'Haftalık total verimlilik raporu', '/total-verimlilik'),
    'cost-dashboard-weekly-report': emptyReport('cost-dashboard-weekly-report', 'Haftalık maliyet paneli raporu', '/cost-dashboard'),
};
//# sourceMappingURL=index.js.map