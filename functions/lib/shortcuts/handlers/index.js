"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortcutHandlers = void 0;
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const OPEN_FAULT_STATUSES = new Set(['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open', 'in_progress', 'baslamadi', 'devam_ediyor']);
const CLOSED_FAULT_STATUSES = new Set(['cozuldu', 'closed']);
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
function toDate(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return value;
    const maybeTimestamp = value;
    if (typeof maybeTimestamp.toDate === 'function')
        return maybeTimestamp.toDate();
    if (typeof maybeTimestamp.toMillis === 'function')
        return new Date(maybeTimestamp.toMillis());
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
function hoursBetween(start, end) {
    if (!start)
        return null;
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / MS_PER_HOUR));
}
function pickNumber(params, key, fallback) {
    const value = Number(params[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
function baseFaultRow(doc, now) {
    const data = doc.data();
    const openedAt = toDate(data.openedAt || data.createdAt);
    const assignedAt = toDate(data.assignedAt);
    const closedAt = toDate(data.closedAt || data.resolvedAt);
    return {
        faultReportId: doc.id,
        status: data.status || null,
        faultType: data.faultType || null,
        labName: data.labName || data.hospitalName || null,
        deviceName: data.model || data.deviceName || data.name || null,
        serial: data.serial || data.serialNumber || null,
        assignedToName: data.assignedToName || null,
        openedAt: (openedAt === null || openedAt === void 0 ? void 0 : openedAt.toISOString()) || null,
        assignedAt: (assignedAt === null || assignedAt === void 0 ? void 0 : assignedAt.toISOString()) || null,
        closedAt: (closedAt === null || closedAt === void 0 ? void 0 : closedAt.toISOString()) || null,
        ageHours: hoursBetween(openedAt, now),
        waitingHours: hoursBetween(assignedAt || openedAt, now),
        href: `/ariza-yonetimi/${doc.id}`,
    };
}
async function getFaultDocs(context, limit = 500) {
    let query = db.collection('deviceFaultReports');
    if (context.companyId)
        query = query.where('companyId', '==', context.companyId);
    const snap = await query.limit(limit).get();
    return snap.docs;
}
async function getMaintenancePlanDocs(context, limit = 1000) {
    let query = db.collection('maintenancePlans');
    if (context.companyId)
        query = query.where('companyId', '==', context.companyId);
    const snap = await query.limit(limit).get();
    return snap.docs;
}
function reportResult(key, label, deepLink, rows, context, extraMetrics = {}, warnings = []) {
    return {
        status: 'success',
        summaryText: `${label} üretildi: ${rows.length} kayıt bulundu.`,
        rows,
        metrics: Object.assign({ rowCount: rows.length, generatedAt: context.now.toISOString() }, extraMetrics),
        attachments: [
            {
                name: `${key}_${context.runId}.json`,
                contentType: 'application/json',
                path: `shortcutReports/${context.companyId || 'global'}/${context.runId}/${key}_${context.runId}.json`,
            },
        ],
        warnings,
        deepLink,
    };
}
const emptyReport = (key, label, deepLink) => ({
    key,
    label,
    async handle(params, context) {
        return reportResult(key, label, deepLink, [], context, { hasParams: Object.keys(params).length > 0 }, ['Bu rapor için veri toplama mantığı henüz bağlanmadı.']);
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
            metrics: { rowCount: 0, generatedAt, hasParams: paramKeys.length > 0, pdfReady: true, excelReady: true, shortMessageReady: true },
            attachments: [
                { name: `${baseName}.pdf`, contentType: 'application/pdf', path: `shortcutReports/${context.companyId || 'global'}/${context.runId}/${baseName}.pdf` },
                { name: `${baseName}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', path: `shortcutReports/${context.companyId || 'global'}/${context.runId}/${baseName}.xlsx` },
            ],
            warnings: ['Bu handler rapor sözleşmesini ve çıktı meta verilerini hazırlar; veri toplama/depoya dosya yazma entegrasyonu ayrı bağlanacaktır.'],
            deepLink,
        };
    },
});
const openFaultAgingReport = {
    key: 'fault-open-aging-report',
    label: 'Açık arıza yaşlandırma raporu',
    async handle(params, context) {
        const minAgeHours = pickNumber(params, 'esikDegeri', 0);
        const rows = (await getFaultDocs(context))
            .filter((doc) => OPEN_FAULT_STATUSES.has(String(doc.data().status || '')))
            .map((doc) => baseFaultRow(doc, context.now))
            .filter((row) => Number(row.ageHours || 0) >= minAgeHours)
            .sort((a, b) => Number(b.ageHours || 0) - Number(a.ageHours || 0));
        return reportResult(this.key, this.label, '/ariza-yonetimi', rows, context, { minAgeHours });
    },
};
const faultSlaBreachAlert = {
    key: 'fault-sla-breach-alert',
    label: 'SLA aşımı uyarısı',
    async handle(params, context) {
        const slaHours = pickNumber(params, 'esikDegeri', 4);
        const rows = (await getFaultDocs(context))
            .filter((doc) => OPEN_FAULT_STATUSES.has(String(doc.data().status || '')))
            .map((doc) => baseFaultRow(doc, context.now))
            .filter((row) => Number(row.waitingHours || 0) >= slaHours)
            .sort((a, b) => Number(b.waitingHours || 0) - Number(a.waitingHours || 0));
        return reportResult(this.key, this.label, '/ariza-yonetimi?status=mudahale_bekliyor', rows, context, { slaHours });
    },
};
const pendingPartsOperationsReport = {
    key: 'fault-pending-parts-operations',
    label: 'Parça bekleyen işlemler',
    async handle(params, context) {
        const rows = (await getFaultDocs(context))
            .filter((doc) => OPEN_FAULT_STATUSES.has(String(doc.data().status || '')))
            .filter((doc) => {
            const data = doc.data();
            const text = `${data.status || ''} ${data.description || ''} ${data.closeDescription || ''} ${data.partStatus || ''}`.toLocaleLowerCase('tr-TR');
            return data.waitingForParts === true || data.parcaBekliyor === true || text.includes('parça bek') || text.includes('parca bek');
        })
            .map((doc) => baseFaultRow(doc, context.now));
        return reportResult(this.key, this.label, '/ariza-yonetimi', rows, context);
    },
};
const technicianWeeklySummary = {
    key: 'technician-weekly-work-summary',
    label: 'Teknisyen bazlı haftalık iş özeti',
    async handle(_params, context) {
        const weekStart = new Date(context.now.getTime() - 7 * MS_PER_DAY);
        const summary = new Map();
        for (const doc of await getFaultDocs(context, 1000)) {
            const data = doc.data();
            const assignedAt = toDate(data.assignedAt || data.openedAt || data.createdAt);
            const closedAt = toDate(data.closedAt || data.resolvedAt);
            if ((assignedAt && assignedAt >= weekStart) || (closedAt && closedAt >= weekStart)) {
                const key = data.assignedToUid || data.closedByUid || data.closedBy || 'unassigned';
                const item = summary.get(key) || { technician: data.assignedToName || data.closedByName || 'Atanmamış', assignedCount: 0, closedCount: 0, openCount: 0, totalResolutionHours: 0 };
                if (assignedAt && assignedAt >= weekStart)
                    item.assignedCount++;
                if (CLOSED_FAULT_STATUSES.has(String(data.status || '')) && closedAt && closedAt >= weekStart) {
                    item.closedCount++;
                    item.totalResolutionHours += Number(data.toplamCozumSuresi || data.cozumSuresi || 0) / MS_PER_HOUR;
                }
                if (OPEN_FAULT_STATUSES.has(String(data.status || '')))
                    item.openCount++;
                summary.set(key, item);
            }
        }
        const rows = Array.from(summary.entries()).map(([technicianUid, item]) => (Object.assign(Object.assign({ technicianUid }, item), { averageResolutionHours: item.closedCount ? Math.round(item.totalResolutionHours / item.closedCount) : null })));
        return reportResult(this.key, this.label, '/cihaz-yonetimi-ana', rows, context, { weekStart: weekStart.toISOString() });
    },
};
const closedFaultQualityReport = {
    key: 'closed-fault-quality-control-report',
    label: 'Kapanmış arıza kalite kontrol raporu',
    async handle(_params, context) {
        const since = new Date(context.now.getTime() - 30 * MS_PER_DAY);
        const rows = (await getFaultDocs(context, 1000))
            .filter((doc) => CLOSED_FAULT_STATUSES.has(String(doc.data().status || '')))
            .map((doc) => (Object.assign(Object.assign({}, baseFaultRow(doc, context.now)), { closeDescription: doc.data().closeDescription || null, resolutionHours: Number(doc.data().toplamCozumSuresi || doc.data().cozumSuresi || 0) / MS_PER_HOUR })))
            .filter((row) => !row.closedAt || new Date(String(row.closedAt)) >= since)
            .map((row) => (Object.assign(Object.assign({}, row), { qualityFlag: !row.closeDescription ? 'Kapanış açıklaması eksik' : Number(row.resolutionHours || 0) <= 0 ? 'Çözüm süresi eksik' : 'Kontrol edildi' })));
        return reportResult(this.key, this.label, '/ariza-yonetimi?status=cozuldu', rows, context, { since: since.toISOString() });
    },
};
const maintenanceUpcomingDateNotification = {
    key: 'device-maintenance-upcoming-date-notification',
    label: 'Cihaz bakım yaklaşan tarih bildirimi',
    async handle(params, context) {
        const thresholdDays = pickNumber(params, 'esikGunSayisi', 7);
        const rows = (await getMaintenancePlanDocs(context))
            .map((doc) => {
            const data = doc.data();
            const nextDue = toDate(data.nextDueDate || data.dueDate || data.plannedAt);
            const daysUntilDue = nextDue ? Math.ceil((nextDue.getTime() - context.now.getTime()) / MS_PER_DAY) : null;
            return { planId: doc.id, deviceId: data.deviceId || null, taskName: data.taskName || 'Periyodik bakım', role: data.type || null, nextDueAt: (nextDue === null || nextDue === void 0 ? void 0 : nextDue.toISOString()) || null, daysUntilDue, href: `/cihaz-tanimlamalari/periyodik-bakim-yonetimi?deviceId=${data.deviceId || ''}&planId=${doc.id}` };
        })
            .filter((row) => row.daysUntilDue !== null && Number(row.daysUntilDue) > 0 && Number(row.daysUntilDue) <= thresholdDays)
            .sort((a, b) => Number(a.daysUntilDue) - Number(b.daysUntilDue));
        return reportResult(this.key, this.label, '/cihaz-tanimlamalari/periyodik-bakim-yonetimi', rows, context, { thresholdDays });
    },
};
exports.shortcutHandlers = {
    noop: {
        key: 'noop',
        label: 'Noop shortcut handler',
        async handle(params, context) {
            return reportResult('noop', 'Shortcut noop handler', '', [], context, { hasParams: Object.keys(params).length > 0 });
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
    'fault-open-aging-report': openFaultAgingReport,
    'fault-sla-breach-alert': faultSlaBreachAlert,
    'fault-pending-parts-operations': pendingPartsOperationsReport,
    'technician-weekly-work-summary': technicianWeeklySummary,
    'closed-fault-quality-control-report': closedFaultQualityReport,
    'device-maintenance-upcoming-date-notification': maintenanceUpcomingDateNotification,
    'total-efficiency-weekly-report': emptyReport('total-efficiency-weekly-report', 'Haftalık total verimlilik raporu', '/total-verimlilik'),
    'cost-dashboard-weekly-report': emptyReport('cost-dashboard-weekly-report', 'Haftalık maliyet paneli raporu', '/cost-dashboard'),
};
//# sourceMappingURL=index.js.map