'use server';
import * as admin from 'firebase-admin';
import { onDocumentCreated, FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import type { SendResponse } from 'firebase-admin/messaging';
import * as functions from 'firebase-functions';
import type { NotificationDoc } from './lib/notifications';
import fetch from 'node-fetch';
import { sendFaultReportToQorEngine } from '../../services/qorEngineService';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();


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
          badge: '/icon-192.png'
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

        // İşlem formundan açılan arızalarda mail gönderme
        if (faultData.createdFromActionForm === true) {
            logger.info(`Skipping email for fault report ${docId} - created from action form.`);
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

        logger.info(`Skipping automatic email for fault report ${docId}; push and in-app notifications are used.`);
    });
