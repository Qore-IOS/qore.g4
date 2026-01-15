'use server';
import * as admin from 'firebase-admin';
import { onDocumentCreated, FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import type { SendResponse } from 'firebase-admin/messaging';
import * as functions from 'firebase-functions';
import type { NotificationDoc, Audience } from './lib/notifications';
import fetch from 'node-fetch';
import { sendFaultReportToQorEngine } from '../../services/qorEngineService';
import * as nodemailer from 'nodemailer';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true, 
    auth: {
        user: functions.config().smtp?.email || "batuhan@qorengine.com", 
        pass: functions.config().smtp?.password,
    },
});

export { revokeUserSessions } from './revokeUserSessions';
export { createCustomTokenForNfcUser } from './createCustomTokenForNfcUser';
export { mirrorPresenceToFirestore } from './presence';
export { nfcLoginWithSerial } from './nfc-login';


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
    const notificationId = snap.id;

    if (!data?.targets || data.targets.length === 0) return;

    const userQueries = data.targets.map(key => {
        const [field, value] = key.split(':');
        if (field === 'role') return db.collection('users').where('role', '==', value).get();
        if (field === 'lab') return db.collection('users').where('assignedLaboratories', 'array-contains', value).get();
        if (field === 'depot') return db.collection('users').where('assignedDepots', 'array-contains', value).get();
        if (field === 'user') return db.collection('users').where('uid', '==', value).get();
        return Promise.resolve(null);
    });

    const userSnaps = await Promise.all(userQueries);
    const targetUids = new Set<string>();

    userSnaps.forEach(snap => {
        snap?.docs.forEach(doc => {
            if (doc.id !== data.actor?.uid) {
                targetUids.add(doc.id);
            }
        });
    });

    if (targetUids.size === 0) {
        logger.info(`No target UIDs found for notification ${notificationId}`);
        return;
    }
    
    const allTokens = new Set<string>();
    const uidChunks = chunk(Array.from(targetUids), 30); 
    
    for (const uids of uidChunks) {
        const tokenQuery = db.collection('pushTokens').where('uid', 'in', uids).where('enabled', '==', true);
        const tokenSnap = await tokenQuery.get();
        tokenSnap.forEach(doc => {
            const token = doc.get('token') as string;
            if (token) allTokens.add(token);
        });
    }

    if (allTokens.size === 0) {
        logger.info(`No push tokens found for the matched UIDs for notification ${notificationId}`);
        return;
    }

    const tokens = Array.from(allTokens);
    const payload: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: data.title || 'Bildirim',
        body: data.message || '',
      },
      data: {
        href: data.href || '/',
        title: data.title || 'Bildirim',
        body: data.message || '',
        tag: notificationId,
        id: notificationId,
      },
      webpush: {
        fcmOptions: {
          link: data.href || '/',
        },
        headers: {
          Urgency: 'high',
        },
        notification: {
          badge: '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG'
        }
      },
    };

    for (const part of chunk(tokens, 500)) {
      const res = await admin.messaging().sendEachForMulticast({
        tokens: part,
        notification: payload.notification!,
        data: payload.data,
        webpush: payload.webpush,
      });

      res.responses.forEach((r: SendResponse, idx: number) => {
        if (!r.success) {
          const err = r.error;
          const tk = part[idx];
          logger.warn('FCM send error', { token: tk, code: err?.code, message: err?.message });
          if (err && (
            err.code === 'messaging/invalid-registration-token' ||
            err.code === 'messaging/registration-token-not-registered'
          )) {
            db.collection('pushTokens').doc(tk).delete().catch(() => {});
          }
        }
      });
    }
    logger.info(`Sent ${tokens.length} notifications for ${notificationId}`);
  }
);


export const sendFaultReportEmail = functions
    .region('europe-west1')
    .firestore.document('deviceFaultReports/{reportId}')
    .onCreate(async (snap, context) => {
        const faultData = snap.data();
        const docId = context.params.reportId;
        if (!faultData) {
            logger.error('No data associated with the event');
            return;
        }

        try {
            await sendFaultReportToQorEngine({
                reportId: docId,
                ...faultData
            });
            logger.info(`Successfully submitted fault report ${docId} to Qore Engine.`);
        } catch (error) {
            logger.error(`Error submitting fault report ${docId} to Qore Engine:`, error);
        }

        const webhookUrl = 'https://btbsr.app.n8n.cloud/webhook/6d024c9f-12f1-4801-8456-4a99a18d69b3';
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(faultData),
            });
            if (!response.ok) {
                logger.error(`Webhook failed with status: ${response.status}`, { statusText: response.statusText });
            } else {
                logger.info(`Webhook triggered successfully for report ${docId}`);
            }
        } catch (error) {
            logger.error(`Error triggering webhook for report ${docId}:`, error);
        }

        const {
            labName, model, faultType, openedByName, description, title,
        } = faultData;

        let recipients: string[];
        if (faultType === 'teknik_servis') {
            recipients = ['ysahan@nukleus.com.tr', 'dkilic@nukleus.com.tr', 'bbasar@nukleus.com.tr', 'aturhan@nukleus.com.tr', 'bkahraman@nukleus.com.tr'];
        } else if (faultType === 'aplikasyon') {
            recipients = ['iertugrul@nukleus.com.tr', 'ehoscanli@nukleus.com.tr', 'helkoca@nukleus.com.tr', 'bbasar@nukleus.com.tr'];
        } else {
            recipients = ['bbasar@nukleus.com.tr', 'btubasar@gmail.com'];
        }
        
        if (recipients.length === 0) {
            logger.log('No recipients found for fault report email.');
            return;
        }

        const dateStr = new Date().toLocaleDateString("tr-TR", {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        const viewUrl = `https://qorengine.com/ariza-yonetimi/${docId}`;

        const htmlContent = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #d9534f; padding: 20px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 24px;">🚨 Yeni Arıza Kaydı</h2>
            </div>
            <div style="padding: 25px;">
              <p style="font-size: 16px; line-height: 1.5;">Sayın Yetkili,</p>
              <p style="font-size: 15px; line-height: 1.5;">Sisteme yeni bir teknik servis talebi oluşturuldu. Detaylar aşağıdadır:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <tr style="background-color: #f8f9fa;">
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold; width: 35%;">Kayıt ID</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">#${docId}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Cihaz / Konu</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">${model || title || "Belirtilmemiş"}</td>
                </tr>
                <tr style="background-color: #f8f9fa;">
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Açıklama</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">${description || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Arıza Tipi</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">${faultType || 'Belirtilmemiş'}</td>
                </tr>
                <tr style="background-color: #f8f9fa;">
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Bildiren Kişi</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">${openedByName || "Sistem"}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Tarih</td>
                  <td style="padding: 12px; border-bottom: 1px solid #ddd;">${dateStr}</td>
                </tr>
              </table>
    
              <div style="margin-top: 30px; text-align: center;">
                <a href="${viewUrl}" style="background-color: #333; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 5px; font-weight: bold; font-size: 14px;">Arızayı Görüntüle</a>
              </div>
            </div>
            <div style="background-color: #f1f1f1; padding: 15px; text-align: center; font-size: 12px; color: #888;">
              © 2025 Qore Yazılım Sistemleri. Bu e-posta otomatiktir.
            </div>
          </div>
        `;

        const mailOptions = {
            from: `"Qore Arıza Sistemi" <batuhan@qorengine.com>`,
            to: recipients.join(', '),
            subject: `🔧 Yeni Arıza: ${model || title || "Bilinmeyen Cihaz"} (#${docId.substring(0, 6)})`,
            html: htmlContent,
        };

        try {
            await transporter.sendMail(mailOptions);
            logger.info(`✅ Mail başarıyla gönderildi! ID: ${docId}`);
        } catch (error) {
            logger.error("❌ Mail gönderilirken hata oluştu:", error);
        }
    });
