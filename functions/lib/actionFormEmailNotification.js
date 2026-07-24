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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAplikasyonFormCreated = exports.onTeknikServisFormCreated = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
const nodemailer = __importStar(require("nodemailer"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const whatsapp_1 = require("./lib/whatsapp");
const clay_pdf_1 = require("./lib/clay-pdf");
const db = admin.firestore();
// --- Assets cache ---
let turkishFontBase64 = null;
let headerLogoBase64 = null;
let systemLogoBase64 = null;
async function loadAssetBase64(url) {
    try {
        const response = await (0, node_fetch_1.default)(url);
        if (!response.ok)
            return null;
        const buffer = await response.buffer();
        return buffer.toString('base64');
    }
    catch (e) {
        firebase_functions_1.logger.warn(`[actionFormEmail] Could not load asset from ${url}:`, e);
        return null;
    }
}
async function loadTurkishFont() {
    if (turkishFontBase64)
        return turkishFontBase64;
    turkishFontBase64 = await loadAssetBase64('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf');
    return turkishFontBase64;
}
async function loadHeaderLogo() {
    if (headerLogoBase64)
        return headerLogoBase64;
    // Fallback chain for logos
    headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invlogo.png');
    if (!headerLogoBase64) {
        headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invitrolab_LOGO__-_Kopya__1_-removebg.png');
    }
    return headerLogoBase64;
}
async function loadSystemLogo() {
    if (systemLogoBase64)
        return systemLogoBase64;
    systemLogoBase64 = await loadAssetBase64('https://qorengine.com/newlogoblk.png');
    return systemLogoBase64;
}
// Nunito ağırlıkları (clay tasarım fontu) — jsDelivr üzerinden statik TTF olarak yüklenir.
let nunitoSemiBold = null;
let nunitoExtraBold = null;
let nunitoBlack = null;
async function loadNunito() {
    if (!nunitoSemiBold)
        nunitoSemiBold = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_600SemiBold.ttf');
    if (!nunitoExtraBold)
        nunitoExtraBold = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_800ExtraBold.ttf');
    if (!nunitoBlack)
        nunitoBlack = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_900Black.ttf');
    return { semibold: nunitoSemiBold, extrabold: nunitoExtraBold, black: nunitoBlack };
}
/** Clay PDF için tüm varlıkları (font + logo) yükler. */
async function loadClayAssets() {
    const [nun, noto, headerLogo, sysLogo] = await Promise.all([loadNunito(), loadTurkishFont(), loadHeaderLogo(), loadSystemLogo()]);
    return {
        fonts: { semibold: nun.semibold, extrabold: nun.extrabold, black: nun.black, noto },
        invLogo: headerLogo ? Object.assign({ b64: headerLogo }, (0, clay_pdf_1.pngSize)(headerLogo)) : null,
        qoreLogo: sysLogo ? Object.assign({ b64: sysLogo }, (0, clay_pdf_1.pngSize)(sysLogo)) : null,
    };
}
// --- Labels ---
const TEKNIK_ISLEM_TIPI_LABELS = {
    '': '-',
    cihaz: 'Cihaz',
    ups: 'UPS',
    su_sistemi: 'Su Sistemi',
};
const TEKNIK_ISLEM_TURU_LABELS = {
    '': '-',
    kontrol: 'Kontrol',
    rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
    periyodik_bakim: 'Periyodik Bakım',
    cihaz_kurulumu: 'Cihaz Kurulumu',
    ariza: 'Arıza',
    sw_update: 'SW Update',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};
const APLIKASYON_ISLEM_TURU_LABELS = {
    '': '-',
    rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
    periyodik_bakim: 'Periyodik Bakım',
    ariza: 'Arıza',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};
const TEKNIK_OPERATION_LABELS = {
    genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
    temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
    mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
    optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
    pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
};
const APLIKASYON_OPERATION_LABELS = {
    aplikasyon_kontrol: 'Aplikasyon Kontrol',
    kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
    qc_materyal_kontrol: 'QC Materyal Kontrol',
    ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
    reaktif_yenileme: 'Reaktif Yenileme',
    kalibrator_yenileme: 'Kalibratör Yenileme',
    qc_yenileme: 'QC Yenileme',
    cv_calismasi: 'CV Çalışması',
    diger: 'Diğer',
};
const CIHAZ_DURUMU_LABELS = {
    '': '-',
    calisiyor: 'Çalışıyor',
    arizali: 'Arızalı',
    denemede: 'Denemede',
    diger: 'Diğer',
};
// --- Nodemailer transporter ---
function getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) {
        firebase_functions_1.logger.warn('[actionFormEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in functions/.env');
        return null;
    }
    return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
}
// --- PDF Generation (clay tasarım — istemci tarafıyla birebir) ---
async function generateActionFormPDF(data, formType, formId) {
    var _a, _b, _c, _d, _e, _f;
    const assets = await loadClayAssets();
    const actions = data.actions || [];
    const isTeknik = formType === 'teknik_servis';
    const turuLabels = isTeknik ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
    const opLabels = isTeknik ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
    const testsStr = ((_b = (_a = data.selectedTests) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0 ? data.selectedTests.join(', ') : '';
    const chips = [];
    if (isTeknik) {
        chips.push({ label: 'İşlem Tipi', value: TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi || ''] || data.islemTipi || '-' });
        chips.push({ label: 'İşlem Türü', value: turuLabels[data.islemTuru || ''] || data.islemTuru || '-' });
        if (data.islemTuru === 'ariza' && data.selectedFaultName)
            chips.push({ label: 'Tespit Edilen Arıza', value: data.selectedFaultName });
    }
    else {
        chips.push({ label: 'İşlem Türü', value: turuLabels[data.islemTuru || ''] || data.islemTuru || '-' });
        if (data.islemTuru === 'ariza') {
            chips.push({ label: 'Tespit Edilen Arıza', value: data.selectedFaultName || '—' });
            chips.push({ label: 'Arıza ile İlişkili Testler', value: testsStr || '—' });
        }
        else if (testsStr) {
            chips.push({ label: 'İlişkili Testler', value: testsStr });
        }
    }
    const details = [];
    if (data.islemTuru === 'periyodik_bakim' && ((_d = (_c = data.selectedMaintenanceTasks) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0) {
        details.push({ label: 'Periyodik Bakım İşleri', value: data.selectedMaintenanceTasks.map((t) => t.taskName).join(', ') });
    }
    if (isTeknik && testsStr)
        details.push({ label: 'Arıza ile İlişkili Testler', value: testsStr });
    let durumStr = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
    if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama)
        durumStr += ` (${data.cihazDurumuAciklama})`;
    const durumTone = data.cihazDurumu === 'calisiyor' ? 'green' : data.cihazDurumu === 'arizali' ? 'red' : 'neutral';
    const eslik = (data.eslikEdenPersonel || []).map((p) => p.name).filter(Boolean).join(', ');
    const createdDate = ((_e = data.createdAt) === null || _e === void 0 ? void 0 : _e.toDate) ? data.createdAt.toDate() : (((_f = data.createdAt) === null || _f === void 0 ? void 0 : _f._seconds) ? new Date(data.createdAt._seconds * 1000) : null);
    const fallbackStr = createdDate ? formatDate(createdDate).replace(' ', ' · ') : '-';
    const fmtDT = (t, s, fb) => (t && s ? `${t.split('-').reverse().join('.')} · ${s}` : (fb || '-'));
    const signDate = data.bitisTarihi
        ? String(data.bitisTarihi).split('-').reverse().join('.')
        : (createdDate ? formatDate(createdDate).split(' ')[0] : '-');
    const input = {
        title: isTeknik ? 'Teknik Servis Formu' : 'Aplikasyon Formu',
        formNo: data.formNo || formId,
        qrPayload: `https://qorengine.com/forms/${isTeknik ? 'technical' : 'application'}/${formId}`,
        labName: data.labName || '-',
        cihaz: `${data.cihazAdi || '-'} · SN ${data.seriNumarasi || '-'}`,
        islemiYapan: data.createdByName || '-',
        eslikEden: eslik || null,
        baslangic: fmtDT(data.baslangicTarihi, data.baslangicSaati, fallbackStr),
        bitis: fmtDT(data.bitisTarihi, data.bitisSaati, '-'),
        cihazDurumu: durumStr,
        durumTone,
        chips,
        details,
        aciklama: data.aciklama,
        operations: actions.filter((a) => a.type === 'operation').map((a) => ({ ad: opLabels[a.action] || a.action, adet: a.quantity })),
        parts: actions.filter((a) => a.type === 'part_change').map((a) => {
            let partName = a.stokAdi || a.action;
            if (a.isManualEntry && a.stokKodu && a.stokAdi)
                partName = `${a.stokKodu} - ${a.stokAdi}`;
            return { parca: partName, kod: a.stokKodu || '-', seri: (a.serialNumber || '').trim() || '-', adet: a.quantity, birim: a.anaBirim ? String(a.anaBirim).toLowerCase() : 'adet' };
        }),
        hucreChanges: actions.filter((a) => a.type === 'hucre_degisimi').map((a) => {
            var _a;
            return ({
                parca: a.stokAdi || '-', kod: a.stokKodu || '-',
                takilanCikan: `H:${a.hucreNumarasi || '-'} / H:${a.removedHucreNumarasi || '-'}`,
                kanal: ((_a = a.channelSelections) === null || _a === void 0 ? void 0 : _a.join(', ')) || '-',
            });
        }),
        leftSign: { label: 'İşlemi Yapan', name: data.createdByName, sig: data.personnelSignature, date: signDate },
        rightSign: { label: 'Kurum Yetkilisi', name: data.technicianName, sig: data.technicianSignature, date: signDate },
    };
    return (0, clay_pdf_1.buildActionFormPdf)(input, assets);
}
function formatDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${d}.${m}.${y} ${h}:${min}`;
}
// --- Main handler for both collections ---
async function handleActionFormCreated(snap, context, formType) {
    const data = snap.data();
    const formId = context.params.formId;
    firebase_functions_1.logger.info(`[actionFormEmail] Processing ${formType} form: ${formId}`);
    // Prepare log entry for Firestore
    const logEntry = {
        formId,
        formType,
        deviceId: data.deviceId || null,
        cihazAdi: data.cihazAdi || null,
        labName: data.labName || null,
        hospitalId: data.hospitalId || null,
        createdByName: data.createdByName || null,
        createdByUid: data.createdByUid || null,
        status: 'processing',
        steps: [],
        error: null,
        emailSentTo: null,
        whatsappSent: false,
        whatsappError: null,
        smtpConfigured: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        // 1. Get hospital's sorumluEmail
        const hospitalId = data.hospitalId;
        firebase_functions_1.logger.info(`[actionFormEmail] hospitalId: ${hospitalId}`);
        if (!hospitalId) {
            logEntry.status = 'skipped';
            logEntry.error = 'Form üzerinde hospitalId bulunamadı';
            logEntry.steps.push('hospitalId kontrolü: BAŞARISIZ - hospitalId yok');
            firebase_functions_1.logger.info(`[actionFormEmail] No hospitalId on form ${formId}, skipping email.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.steps.push(`hospitalId kontrolü: OK (${hospitalId})`);
        const hospitalDoc = await db.collection('hospitals').doc(hospitalId).get();
        if (!hospitalDoc.exists) {
            logEntry.status = 'skipped';
            logEntry.error = `Hospital dokümanı bulunamadı: ${hospitalId}`;
            logEntry.steps.push(`Hospital dokümanı sorgusu: BAŞARISIZ - ${hospitalId} bulunamadı`);
            firebase_functions_1.logger.info(`[actionFormEmail] Hospital ${hospitalId} not found, skipping email.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.steps.push('Hospital dokümanı sorgusu: OK');
        const hospitalData = hospitalDoc.data();
        const sorumluEmailRaw = hospitalData.sorumluEmail;
        const sorumluEmail = (sorumluEmailRaw && typeof sorumluEmailRaw === 'string') ? sorumluEmailRaw.trim() : '';
        logEntry.labName = hospitalData.name || data.labName || null;
        let emailEnabled = true;
        if (!sorumluEmail) {
            emailEnabled = false;
            logEntry.steps.push('sorumluEmail kontrolü: ATLANDI - email tanımlı değil (WhatsApp denenecek)');
            firebase_functions_1.logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email but continuing with WhatsApp.`);
        }
        else {
            logEntry.steps.push(`sorumluEmail kontrolü: OK (${sorumluEmail})`);
            logEntry.emailSentTo = sorumluEmail;
            firebase_functions_1.logger.info(`[actionFormEmail] sorumluEmail: ${sorumluEmail}`);
        }
        // 2. Get transporter (only required for email; WhatsApp still proceeds without SMTP)
        const transporter = emailEnabled ? getTransporter() : null;
        if (emailEnabled && !transporter) {
            emailEnabled = false;
            logEntry.smtpConfigured = false;
            logEntry.steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ - ortam değişkenleri eksik (WhatsApp denenecek)');
            firebase_functions_1.logger.error(`[actionFormEmail] SMTP not configured, skipping email for form ${formId} but continuing with WhatsApp.`);
        }
        else if (transporter) {
            logEntry.smtpConfigured = true;
            logEntry.steps.push('SMTP yapılandırma kontrolü: OK');
        }
        // 3. Generate PDF
        logEntry.steps.push('PDF oluşturma: başladı');
        firebase_functions_1.logger.info('[actionFormEmail] PDF generation starting...');
        const pdfBuffer = await generateActionFormPDF(data, formType, formId);
        logEntry.steps.push(`PDF oluşturma: OK (${pdfBuffer.length} byte)`);
        firebase_functions_1.logger.info(`[actionFormEmail] PDF generation OK: ${pdfBuffer.length} bytes`);
        // 4. WhatsApp Notification
        const waConfig = functions.config().whatsapp;
        firebase_functions_1.logger.info('[WhatsApp] Config check...', {
            hasConfig: !!waConfig,
            hasInstanceId: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.instance_id),
            hasToken: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.token),
            hasGroupId: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.group_id)
        });
        if (waConfig && waConfig.instance_id && waConfig.token && waConfig.group_id) {
            logEntry.steps.push('WhatsApp gönderimi: başladı');
            firebase_functions_1.logger.info(`[WhatsApp] Attempting to send to: ${waConfig.group_id}`);
            const labName = data.labName || 'Bilinmeyen Laboratuvar';
            const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
            const personnelName = data.createdByName || 'Bilinmeyen Kullanıcı';
            const formTypeLabel = formType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
            let cihazDurumuCaption = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
            if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) {
                cihazDurumuCaption += ` (${data.cihazDurumuAciklama})`;
            }
            const caption = `*${formTypeLabel} İşlemi Tamamlandı*\n\n` +
                `- *Kurum:* ${labName}\n` +
                `- *Cihaz:* ${cihazAdi}\n` +
                `- *Form No:* ${data.formNo || formId}\n` +
                `- *Personel:* ${personnelName}\n` +
                `- *Cihaz Durumu:* ${cihazDurumuCaption}\n\n` +
                `QORE Sistemi üzerinden detaylara ulaşabilirsiniz.`;
            const waFileName = `IslemFormu_${formType === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
            try {
                // --- 4.1 Upload to Storage to get a URL ---
                firebase_functions_1.logger.info('[WhatsApp] Uploading PDF to storage for URL-based sending...');
                const bucket = admin.storage().bucket();
                const storagePath = `actionFormPDFs/${formId}_${Date.now()}.pdf`;
                const file = bucket.file(storagePath);
                await file.save(pdfBuffer, {
                    contentType: 'application/pdf',
                    metadata: {
                        cacheControl: 'public, max-age=3600',
                    },
                });
                // Make the file public so UltraMsg can access it
                await file.makePublic();
                // Construct the public URL
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
                firebase_functions_1.logger.info(`[WhatsApp] PDF uploaded and made public. URL: ${publicUrl}`);
                // --- 4.2 Send via WhatsApp ---
                const waResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, waConfig.group_id, waConfig.instance_id, waConfig.token);
                firebase_functions_1.logger.info(`[WhatsApp] Result: ${JSON.stringify(waResult)}`);
                if (waResult.success) {
                    logEntry.whatsappSent = true;
                    logEntry.steps.push(`WhatsApp gönderimi: OK (MsgID: ${waResult.messageId})`);
                }
                else {
                    logEntry.whatsappError = waResult.error || 'Unknown error';
                    logEntry.steps.push(`WhatsApp gönderimi: BAŞARISIZ - ${waResult.error}`);
                }
                // --- 4.3 Send to parts group too if form contains part changes ---
                const hasPartChanges = Array.isArray(data.actions) && data.actions.some((a) => (a === null || a === void 0 ? void 0 : a.type) === 'part_change');
                const partsGroupId = waConfig.parts_group_id || '905362835871-1624522639@g.us';
                if (hasPartChanges && partsGroupId) {
                    firebase_functions_1.logger.info(`[WhatsApp] Form has part changes; also sending to parts group: ${partsGroupId}`);
                    try {
                        const partsResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, partsGroupId, waConfig.instance_id, waConfig.token);
                        firebase_functions_1.logger.info(`[WhatsApp] Parts group result: ${JSON.stringify(partsResult)}`);
                        if (partsResult.success) {
                            logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: OK (MsgID: ${partsResult.messageId})`);
                        }
                        else {
                            logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: BAŞARISIZ - ${partsResult.error}`);
                        }
                    }
                    catch (partsErr) {
                        firebase_functions_1.logger.error('[WhatsApp] Parts group send error', partsErr);
                        logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: HATA - ${(partsErr === null || partsErr === void 0 ? void 0 : partsErr.message) || partsErr}`);
                    }
                }
            }
            catch (waErr) {
                firebase_functions_1.logger.error('[WhatsApp] Fatal error in notification flow:', waErr);
                logEntry.whatsappError = waErr.message || String(waErr);
                logEntry.steps.push(`WhatsApp gönderimi: HATA - ${waErr.message}`);
            }
        }
        else {
            firebase_functions_1.logger.warn('[WhatsApp] Skipping: Configuration is incomplete.');
            logEntry.steps.push('WhatsApp gönderimi: ATLADI (Yapılandırma eksik)');
        }
        // 5. Compose email (only if email is enabled)
        if (emailEnabled && transporter) {
            const labName = hospitalData.name || data.labName || 'Bilinmeyen Laboratuvar';
            const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
            const personnelName = data.createdByName || 'Bilinmeyen Kullanici';
            const formTypeLabel = formType === 'teknik_servis' ? 'teknik servis' : 'aplikasyon';
            const subject = `Islem Formu - ${labName} - ${cihazAdi}`;
            const body = `Sorumlusu oldugunuz ${labName} laboratuvarindaki ${cihazAdi} cihazina ${formTypeLabel} personeli ${personnelName} tarafindan islem formu kaydedilmistir. Ilgili belge ektedir.`;
            const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
            const pdfFileName = `IslemFormu_${formType === 'teknik_servis' ? 'TeknikServis' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
            logEntry.steps.push(`Email hazırlandı: from=${senderEmail}, to=${sorumluEmail}, subject=${subject}`);
            try {
                await transporter.sendMail({
                    from: senderEmail,
                    to: sorumluEmail,
                    subject,
                    text: body,
                    attachments: [
                        {
                            filename: pdfFileName,
                            content: pdfBuffer,
                            contentType: 'application/pdf',
                        },
                    ],
                });
                logEntry.status = 'sent';
                logEntry.steps.push('Email gönderimi: BAŞARILI');
                firebase_functions_1.logger.info(`[actionFormEmail] Email sent to ${sorumluEmail} for form ${formId}`);
            }
            catch (error) {
                logEntry.status = 'failed';
                logEntry.error = (error === null || error === void 0 ? void 0 : error.message) || String(error);
                logEntry.steps.push(`Email gönderimi: BAŞARISIZ - ${(error === null || error === void 0 ? void 0 : error.message) || error}`);
                firebase_functions_1.logger.error(`[actionFormEmail] Failed to send email for form ${formId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
            }
        }
        else {
            // Email skipped; reflect final status based on WhatsApp result
            if (logEntry.whatsappSent) {
                logEntry.status = 'sent';
                logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok), WhatsApp ile bildirildi');
            }
            else {
                logEntry.status = 'skipped';
                logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok)');
            }
            firebase_functions_1.logger.info(`[actionFormEmail] Email step skipped for form ${formId} (emailEnabled=false).`);
        }
    }
    catch (outerError) {
        logEntry.status = 'error';
        logEntry.error = (outerError === null || outerError === void 0 ? void 0 : outerError.message) || String(outerError);
        logEntry.steps.push(`Beklenmeyen hata: ${(outerError === null || outerError === void 0 ? void 0 : outerError.message) || outerError}`);
        firebase_functions_1.logger.error(`[actionFormEmail] Unexpected error for form ${formId}:`, (outerError === null || outerError === void 0 ? void 0 : outerError.message) || outerError);
    }
    // Always write log entry
    try {
        await db.collection('emailNotificationLogs').add(logEntry);
    }
    catch (logError) {
        firebase_functions_1.logger.error(`[actionFormEmail] Failed to write log for form ${formId}:`, logError);
    }
}
// --- Firestore Triggers ---
exports.onTeknikServisFormCreated = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('teknikServisActionForms/{formId}')
    .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'teknik_servis');
});
exports.onAplikasyonFormCreated = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('aplikasyonActionForms/{formId}')
    .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'aplikasyon');
});
//# sourceMappingURL=actionFormEmailNotification.js.map