'use server';
import * as admin from 'firebase-admin';
import { onDocumentCreated, FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import * as functions from 'firebase-functions';
import type { NotificationDoc } from './lib/notifications';
import fetch from 'node-fetch';
import * as nodemailer from 'nodemailer';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export { revokeUserSessions } from './revokeUserSessions';
export { createCustomTokenForNfcUser } from './createCustomTokenForNfcUser';
export { mirrorPresenceToFirestore } from './presence';
export { nfcLoginWithSerial } from './nfc-login';

const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: functions.config().smtp?.email || "batuhan@qorengine.com", 
        pass: functions.config().smtp?.password,
    },
});

function chunk<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const fanOutNotifications = onDocumentCreated(
  {
    document: 'notifications/{id}',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, { id: string }>) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as NotificationDoc;
    if (!data?.targets || data.targets.length === 0) return;
    logger.info('Notification processing started for ' + snap.id);
  }
);

// --- GUNCEL ARIZA MAİL FONKSİYONU ---
export const sendFaultReportEmail = functions
    .region('europe-west1')
    .firestore.document('deviceFaultReports/{reportId}')
    .onCreate(async (snap, context) => {
        const faultData = snap.data();
        const docId = context.params.reportId;
        
        if (!faultData) return;

        const { labName, model, title, description, faultType, openedByName } = faultData;

        // 1. Webhook
        const webhookUrl = 'https://btbsr.app.n8n.cloud/webhook/6d024c9f-12f1-4801-8456-4a99a18d69b3';
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(faultData),
            });
        } catch (e) { logger.warn('Webhook error', e); }

        // 2. ALICI LİSTELERİ (YENİ)
        let recipients: string[] = [];

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
        } else if (type.includes('aplikasyon')) {
            recipients = aplikasyonListesi;
        } else {
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
            logger.info(`Mail successfully sent to [${recipients.length}] people. ID: ${docId}`);
        } catch (error) {
            logger.error('Mail sending failed', error);
        }
    });
