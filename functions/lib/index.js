'use server';
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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFaultReportEmail = exports.fanOutNotifications = exports.nfcLoginWithSerial = exports.mirrorPresenceToFirestore = exports.createCustomTokenForNfcUser = exports.revokeUserSessions = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const functions = __importStar(require("firebase-functions"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const nodemailer = __importStar(require("nodemailer"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
var revokeUserSessions_1 = require("./revokeUserSessions");
Object.defineProperty(exports, "revokeUserSessions", { enumerable: true, get: function () { return revokeUserSessions_1.revokeUserSessions; } });
var createCustomTokenForNfcUser_1 = require("./createCustomTokenForNfcUser");
Object.defineProperty(exports, "createCustomTokenForNfcUser", { enumerable: true, get: function () { return createCustomTokenForNfcUser_1.createCustomTokenForNfcUser; } });
var presence_1 = require("./presence");
Object.defineProperty(exports, "mirrorPresenceToFirestore", { enumerable: true, get: function () { return presence_1.mirrorPresenceToFirestore; } });
var nfc_login_1 = require("./nfc-login");
Object.defineProperty(exports, "nfcLoginWithSerial", { enumerable: true, get: function () { return nfc_login_1.nfcLoginWithSerial; } });
const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: ((_a = functions.config().smtp) === null || _a === void 0 ? void 0 : _a.email) || "batuhan@qorengine.com",
        pass: (_b = functions.config().smtp) === null || _b === void 0 ? void 0 : _b.password,
    },
});
function chunk(arr, size = 500) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
exports.fanOutNotifications = (0, firestore_1.onDocumentCreated)({
    document: 'notifications/{id}',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
}, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    if (!(data === null || data === void 0 ? void 0 : data.targets) || data.targets.length === 0)
        return;
    firebase_functions_1.logger.info('Notification processing started for ' + snap.id);
});
// --- GUNCEL ARIZA MAİL FONKSİYONU ---
exports.sendFaultReportEmail = functions
    .region('europe-west1')
    .firestore.document('deviceFaultReports/{reportId}')
    .onCreate(async (snap, context) => {
    const faultData = snap.data();
    const docId = context.params.reportId;
    if (!faultData)
        return;
    const { labName, model, title, description, faultType, openedByName } = faultData;
    // 1. Webhook
    const webhookUrl = 'https://btbsr.app.n8n.cloud/webhook/6d024c9f-12f1-4801-8456-4a99a18d69b3';
    try {
        await (0, node_fetch_1.default)(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(faultData),
        });
    }
    catch (e) {
        firebase_functions_1.logger.warn('Webhook error', e);
    }
    // 2. ALICI LİSTELERİ (YENİ)
    let recipients = [];
    const teknikServisListesi = [
        'ysahan@nukleus.com.tr',
        'dkilic@nukleus.com.tr',
        'bbasar@nukleus.com.tr',
        'aturhan@nukleus.com.tr'
    ];
    const aplikasyonListesi = [
        'bkahraman@nukleus.com.tr',
        'iertugrul@nukleus.com.tr',
        'ehoscanli@nukleus.com.tr',
        'helkoca@nukleus.com.tr',
        'bbasar@nukleus.com.tr',
        'aturhan@nukleus.com.tr'
    ];
    // Kucuk harf kontrolu ile eslestirme yapalim
    const type = (faultType || '').toLowerCase();
    if (type.includes('teknik') || type === 'teknik_servis') {
        recipients = teknikServisListesi;
    }
    else if (type.includes('aplikasyon')) {
        recipients = aplikasyonListesi;
    }
    else {
        // Eger tip tanimsizsa veya baska bir seyse Adminlere gonder
        recipients = ['bbasar@nukleus.com.tr',
            'aturhan@nukleus.com.tr', 'btubasar@gmail.com'];
    }
    // 3. İÇERİK VE LİNK (YENİ)
    const reportLink = `https://qorengine.com/ariza-yonetimi/${docId}`;
    const htmlContent = `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; color: #333; max-width: 600px;">
            <h2 style="color: #d32f2f; margin-top: 0;">🔧 Yeni Arıza Kaydı (#${docId.substring(0, 5)})</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr style="background-color: #f9f9f9;">
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee; width: 30%;">Cihaz:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${model || title || 'Belirtilmemiş'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Laboratuvar:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${labName || 'Belirtilmemiş'}</td>
                </tr>
                <tr style="background-color: #f9f9f9;">
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Arıza Tipi:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${faultType || 'Belirtilmemiş'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Açan Kişi:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${openedByName || 'Belirtilmemiş'}</td>
                </tr>
            </table>

            <div style="margin-top: 20px; background-color: #fff3e0; padding: 15px; border-radius: 5px; border-left: 4px solid #ff9800;">
                <p style="font-weight: bold; margin: 0 0 5px 0; color: #e65100;">Açıklama:</p>
                <p style="margin: 0;">${description || 'Açıklama girilmedi.'}</p>
            </div>

            <div style="margin-top: 30px; text-align: center;">
                <a href="${reportLink}" style="background-color: #d32f2f; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
                    Arızayı Görüntüle
                </a>
                <p style="margin-top: 15px; font-size: 12px; color: #888;">
                    Linke tıklayamıyorsanız: <br>
                    <a href="${reportLink}" style="color: #d32f2f;">${reportLink}</a>
                </p>
            </div>
          </div>
        `;
    const mailOptions = {
        from: '"Qore Arıza Sistemi" <batuhan@qorengine.com>',
        to: recipients.join(', '),
        subject: `Yeni Arıza: ${title || model} (${labName})`,
        html: htmlContent,
    };
    try {
        await transporter.sendMail(mailOptions);
        firebase_functions_1.logger.info(`Mail successfully sent to [${recipients.length}] people. ID: ${docId}`);
    }
    catch (error) {
        firebase_functions_1.logger.error('Mail sending failed', error);
    }
});
//# sourceMappingURL=index.js.map