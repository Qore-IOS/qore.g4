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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPeripheralOrderCreatedSendWhatsApp = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
const whatsapp_1 = require("./lib/whatsapp");
const peripheralRecipients_1 = require("./lib/peripheralRecipients");
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const URGENCY_LABELS = {
    normal: 'Normal',
    acil: 'Acil',
    cok_acil: 'Çok Acil',
};
function normalizePhoneForWa(raw) {
    if (typeof raw !== 'string')
        return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits)
        return null;
    if (digits.length === 10 && digits.startsWith('5'))
        return `90${digits}`;
    return digits;
}
function formatItemLine(it, info) {
    var _a;
    const name = it.stokAdi || it.stokKodu || '-';
    const adet = Number((_a = it.adet) !== null && _a !== void 0 ? _a : 1) || 1;
    const anaBirim = ((info === null || info === void 0 ? void 0 : info.anaBirim) || it.anaBirim || '').trim();
    const birimSuffix = anaBirim ? ` ${anaBirim}` : '';
    const ambalaj = info === null || info === void 0 ? void 0 : info.ambalajDegeri;
    const multiplier = typeof ambalaj === 'number' && ambalaj > 0 ? ` (${adet * ambalaj} adet)` : '';
    return `- ${name} x ${adet}${birimSuffix}${multiplier}`;
}
function buildMessage(order, labName, filteredItems, itemInfoMap) {
    var _a;
    const urgency = URGENCY_LABELS[order.urgency || 'normal'] || 'Normal';
    const totalAdet = filteredItems.reduce((s, it) => s + (Number(it.adet) || 0), 0);
    const lines = [];
    lines.push('*Yeni Perifer Ürün Talebi*');
    lines.push('');
    lines.push(`• *Kurum:* ${labName}`);
    lines.push(`• *Kalem Sayısı:* ${filteredItems.length}`);
    lines.push(`• *Toplam Adet:* ${totalAdet}`);
    lines.push(`• *Aciliyet:* ${urgency}`);
    if (order.createdBy)
        lines.push(`• *Talep Eden:* ${order.createdBy}`);
    lines.push('');
    // Group items by laboratuvarGrubu for a more readable layout
    const itemsByGroup = new Map();
    for (const it of filteredItems) {
        const g = ((_a = itemInfoMap.get((it.stokKodu || '').trim())) === null || _a === void 0 ? void 0 : _a.group) || 'Diğer';
        if (!itemsByGroup.has(g))
            itemsByGroup.set(g, []);
        itemsByGroup.get(g).push(it);
    }
    for (const [groupName, groupItems] of itemsByGroup) {
        lines.push(`*${groupName}:*`);
        for (const it of groupItems.slice(0, 30)) {
            lines.push(formatItemLine(it, itemInfoMap.get((it.stokKodu || '').trim())));
        }
        if (groupItems.length > 30)
            lines.push(`...ve ${groupItems.length - 30} kalem daha`);
        lines.push('');
    }
    if (order.note && order.note.trim()) {
        lines.push(`*Not:* ${order.note.trim()}`);
        lines.push('');
    }
    lines.push('QORE Sistemi üzerinden detaylara ulaşabilirsiniz.');
    return lines.join('\n');
}
exports.onPeripheralOrderCreatedSendWhatsApp = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('orders/{orderId}')
    .onCreate(async (snap, context) => {
    var _a, _b;
    const orderId = context.params.orderId;
    const order = snap.data();
    const logEntry = {
        orderId,
        labId: (order === null || order === void 0 ? void 0 : order.labId) || null,
        labName: (order === null || order === void 0 ? void 0 : order.kurumAdi) || null,
        itemsCount: Array.isArray(order === null || order === void 0 ? void 0 : order.items) ? order.items.length : 0,
        isPeripheral: (_a = order === null || order === void 0 ? void 0 : order.isPeripheral) !== null && _a !== void 0 ? _a : null,
        requestSource: (_b = order === null || order === void 0 ? void 0 : order.requestSource) !== null && _b !== void 0 ? _b : null,
        results: [],
        status: 'processing',
        steps: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        const isPeripheralRequest = (order === null || order === void 0 ? void 0 : order.isPeripheral) === true || (order === null || order === void 0 ? void 0 : order.requestSource) === 'lab_to_office';
        if (!isPeripheralRequest) {
            logEntry.status = 'skipped';
            logEntry.steps.push('Perifer kontrolü: ATLANDI (perifer talep değil)');
            await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
            return;
        }
        const waConfig = functions.config().whatsapp;
        if (!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.instance_id) || !(waConfig === null || waConfig === void 0 ? void 0 : waConfig.token)) {
            logEntry.status = 'skipped';
            logEntry.steps.push('WhatsApp config kontrolü: BAŞARISIZ (instance_id/token eksik)');
            await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
            firebase_functions_1.logger.warn('[peripheralOrderWA] WhatsApp config missing');
            return;
        }
        const items = Array.isArray(order.items) ? order.items : [];
        if (items.length === 0) {
            logEntry.status = 'skipped';
            logEntry.steps.push('Kalem kontrolü: ATLANDI (sipariş boş)');
            await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
            return;
        }
        const [itemInfoMap, labGroupNamesById, users] = await Promise.all([
            (0, peripheralRecipients_1.buildItemInfoMap)(items),
            (0, peripheralRecipients_1.loadLabGroupNamesByDocId)(),
            (0, peripheralRecipients_1.loadLojistikUsers)(),
        ]);
        const itemGroupMap = (0, peripheralRecipients_1.groupMapFromInfo)(itemInfoMap);
        logEntry.steps.push(`Veri yükleme OK (kalem grup eşlemesi: ${itemGroupMap.size}, def_labGroups: ${labGroupNamesById.size}, lojistik kullanıcı: ${users.length})`);
        const orderGroups = new Set(Array.from(itemGroupMap.values()));
        logEntry.orderGroups = Array.from(orderGroups);
        const labName = order.kurumAdi || 'Bilinmeyen Laboratuvar';
        for (const user of users) {
            const userGroupNames = (0, peripheralRecipients_1.resolveUserGroupNames)(user, labGroupNamesById);
            const filtered = (0, peripheralRecipients_1.filterItemsForUserGroups)(items, itemGroupMap, userGroupNames);
            const phone = normalizePhoneForWa(user.phoneNumber);
            const baseResult = {
                uid: user.uid,
                name: user.name,
                email: user.email,
                assignedGroups: Array.from(userGroupNames),
                matchedItemCount: filtered.length,
            };
            if (filtered.length === 0) {
                baseResult.status = 'no_matching_items';
                logEntry.results.push(baseResult);
                logEntry.steps.push(`${user.name || user.uid}: ATLANDI (eşleşen kalem yok)`);
                continue;
            }
            if (!phone) {
                baseResult.status = 'no_phone';
                logEntry.results.push(baseResult);
                logEntry.steps.push(`${user.name || user.uid}: ATLANDI (telefon yok)`);
                continue;
            }
            const to = `${phone}@c.us`;
            const messageBody = buildMessage(order, labName, filtered, itemInfoMap);
            baseResult.to = to;
            baseResult.messagePreview = messageBody.substring(0, 200);
            try {
                const r = await (0, whatsapp_1.sendWhatsAppText)(to, messageBody, waConfig.instance_id, waConfig.token);
                baseResult.success = r.success;
                baseResult.messageId = r.messageId || null;
                baseResult.error = r.error || null;
                logEntry.results.push(baseResult);
                if (r.success) {
                    logEntry.steps.push(`${user.name || user.uid} (${to}): OK (msgId=${r.messageId})`);
                }
                else {
                    logEntry.steps.push(`${user.name || user.uid} (${to}): BAŞARISIZ - ${r.error}`);
                }
            }
            catch (e) {
                baseResult.success = false;
                baseResult.error = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                logEntry.results.push(baseResult);
                logEntry.steps.push(`${user.name || user.uid} (${to}): HATA - ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
                firebase_functions_1.logger.error(`[peripheralOrderWA] send error for ${user.uid}`, e);
            }
        }
        const anySent = logEntry.results.some((r) => r.success === true);
        logEntry.status = anySent ? 'sent' : 'skipped';
    }
    catch (e) {
        firebase_functions_1.logger.error(`[peripheralOrderWA] Unexpected error for order ${orderId}`, e);
        logEntry.status = 'error';
        logEntry.error = (e === null || e === void 0 ? void 0 : e.message) || String(e);
        logEntry.steps.push(`HATA: ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
    }
    try {
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
    }
    catch (logErr) {
        firebase_functions_1.logger.error('[peripheralOrderWA] Failed to write log', logErr);
    }
});
//# sourceMappingURL=peripheralOrderWhatsApp.js.map