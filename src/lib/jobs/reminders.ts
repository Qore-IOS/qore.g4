import {adminDb as db,FieldValue,Timestamp} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import {onSchedule,logger} from './runtime';
// --- ARIZA HATIRLATICI (4 saat+ müdahale bekleyen arızalar) ---
// Her saat çalışır, mudahale_bekliyor veya mudahale_ediliyor durumunda 4+ saat kalan
// arızalar için üzerine alan personele bildirim gönderir.
export const faultInterventionReminder = onSchedule(
    {
        schedule: 'every 1 hours',
        timeZone: 'Europe/Istanbul',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB',
    },
    async () => {
        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
        const now = Date.now();
        const fourHoursAgo = Timestamp.fromMillis(now - FOUR_HOURS_MS);

        try {
            // Query faults that are in mudahale_bekliyor or mudahale_ediliyor status
            // and have been assigned more than 4 hours ago
            const [bekleyenSnap, ediliyorSnap] = await Promise.all([
                db.collection('deviceFaultReports')
                    .where('status', '==', 'mudahale_bekliyor')
                    .where('assignedAt', '<=', fourHoursAgo)
                    .get(),
                db.collection('deviceFaultReports')
                    .where('status', '==', 'mudahale_ediliyor')
                    .where('assignedAt', '<=', fourHoursAgo)
                    .get(),
            ]);

            const allDocs = [...bekleyenSnap.docs, ...ediliyorSnap.docs];

            if (allDocs.length === 0) {
                logger.info('[faultReminder] No faults awaiting intervention for 4+ hours.');
                return;
            }

            logger.info(`[faultReminder] Found ${allDocs.length} faults awaiting intervention for 4+ hours.`);

            // Check which faults have already been reminded recently (within last 4 hours)
            // to avoid spamming the same person every hour
            const REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000;
            const cooldownThreshold = Timestamp.fromMillis(now - REMINDER_COOLDOWN_MS);

            for (const faultDoc of allDocs) {
                const data = faultDoc.data();
                const assignedToUid = data.assignedToUid;
                const assignedToName = data.assignedToName || 'Personel';

                if (!assignedToUid) {
                    logger.warn(`[faultReminder] Fault ${faultDoc.id} has no assignedToUid, skipping.`);
                    continue;
                }

                // Check cooldown - skip if reminder was sent recently
                const lastReminderAt = data.lastFaultReminderAt;
                if (lastReminderAt && lastReminderAt.toMillis() > cooldownThreshold.toMillis()) {
                    logger.info(`[faultReminder] Fault ${faultDoc.id} already reminded recently, skipping.`);
                    continue;
                }

                // Calculate how long the fault has been waiting
                const assignedAtMs = data.assignedAt?.toMillis?.() || now;
                const waitingHours = Math.floor((now - assignedAtMs) / (60 * 60 * 1000));

                const statusLabel = data.status === 'mudahale_bekliyor'
                    ? 'müdahale bekliyor'
                    : 'müdahale ediliyor';

                const deviceName = data.model || data.deviceName || 'Bilinmeyen Cihaz';
                const labName = data.labName || '';
                const faultId = faultDoc.id;

                // Create notification for the assigned personnel.
                // Propagate companyId from the source fault so the notification
                // stays scoped to the same tenant (Faz 6 Security Rules need this).
                const sourceCompanyId =
                    typeof data.companyId === 'string' && data.companyId.trim()
                        ? data.companyId.trim()
                        : null;
                const notificationData: Record<string, any> = {
                    type: 'fault_reminder' as const,
                    title: `Arıza Hatırlatma: ${deviceName}`,
                    message: `${labName ? labName + ' - ' : ''}${deviceName} cihazı için açılan arıza ${waitingHours} saattir "${statusLabel}" durumunda bekliyor. Lütfen arızayı kontrol ediniz.`,
                    href: `/ariza-yonetimi/${faultId}`,
                    resource: { type: 'device' as const, id: data.deviceId || '' },
                    actor: { uid: 'system', name: 'Sistem' },
                    targets: [`user:${assignedToUid}`],
                    meta: {
                        faultReportId: faultId,
                        assignedToUid,
                        assignedToName,
                        deviceName,
                        labName,
                        waitingHours,
                        status: data.status,
                    },
                    channel: 'push' as const,
                    createdAt: FieldValue.serverTimestamp(),
                    readBy: [] as string[],
                };
                if (sourceCompanyId) notificationData.companyId = sourceCompanyId;

                await db.collection('notifications').add(notificationData);

                // Update the fault document to track last reminder time
                await faultDoc.ref.update({
                    lastFaultReminderAt: FieldValue.serverTimestamp(),
                });

                logger.info(`[faultReminder] Sent reminder for fault ${faultId} to ${assignedToName} (${assignedToUid}), waiting ${waitingHours}h in "${statusLabel}".`);
            }

            logger.info(`[faultReminder] Completed. Processed ${allDocs.length} faults.`);
        } catch (error) {
            logger.error('[faultReminder] Error processing fault reminders:', error);
        }
    }
);

// --- PERİYODİK BAKIM HATIRLATICI (7 gün kala) ---
// Her gün sabah 08:00 çalışır. Bir cihaza tanımlı bakım planının bir sonraki
// planlanan tarihine 7 gün veya daha az kalmışsa, plan.type (teknik_servis /
// aplikasyon) rolündeki ve cihazın bulunduğu laboratuvara atanmış personellere
// hem sistem içi hem de push bildirim gönderir. Tek bir bakım için tekrar
// bildirim göndermemek üzere her plan dokümanına lastMaintenanceReminderAt
// yazılır ve bu alanı 6 gün içinde güncellenmiş planlar atlanır.
export const maintenanceUpcomingReminder = onSchedule(
    {
        schedule: 'every day 08:00',
        timeZone: 'Europe/Istanbul',
        region: 'europe-west1',
        timeoutSeconds: 300,
        memory: '256MiB',
    },
    async () => {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const SIX_DAYS_MS = 6 * MS_PER_DAY;
        const now = Date.now();
        const cooldownCutoff = Timestamp.fromMillis(now - SIX_DAYS_MS);

        try {
            const plansSnap = await db.collection('maintenancePlans').get();
            if (plansSnap.empty) {
                logger.info('[maintReminder] No maintenance plans found.');
                return;
            }

            // Preload all maintenance logs and bucket latest per planId
            const logsSnap = await db.collection('maintenanceLogs').get();
            const latestLogByPlanId = new Map<string, any>();
            for (const logDoc of logsSnap.docs) {
                const ld = logDoc.data();
                if (!ld.planId || !ld.nextDueDate) continue;
                const current = latestLogByPlanId.get(ld.planId);
                const thisCompleted = ld.completedAt?.toMillis?.() || 0;
                const curCompleted = current?.completedAt?.toMillis?.() || 0;
                if (!current || thisCompleted > curCompleted) {
                    latestLogByPlanId.set(ld.planId, ld);
                }
            }

            // Caches
            const usersByRole = new Map<string, Array<{ uid: string; assignedLaboratories: string[]; name: string }>>();
            const loadUsersByRole = async (role: string) => {
                if (usersByRole.has(role)) return usersByRole.get(role)!;
                const usersSnap = await db.collection('users').where('role', '==', role).get();
                const list = usersSnap.docs.map((d) => {
                    const ud = d.data() as any;
                    return {
                        uid: d.id,
                        assignedLaboratories: (ud.assignedLaboratories as string[]) || [],
                        name: ud.displayName || ud.name || ud.email || d.id,
                    };
                });
                usersByRole.set(role, list);
                return list;
            };

            const deviceCache = new Map<string, any | null>();
            const loadDevice = async (deviceId: string) => {
                if (deviceCache.has(deviceId)) return deviceCache.get(deviceId);
                const snap = await db.collection('devices').doc(deviceId).get();
                const data = snap.exists ? snap.data() : null;
                deviceCache.set(deviceId, data);
                return data;
            };

            let processed = 0;
            let notified = 0;

            for (const planDoc of plansSnap.docs) {
                processed++;
                const plan = planDoc.data() as any;
                const planId = planDoc.id;

                if (!plan.deviceId) continue;
                const role = plan.type;
                if (role !== 'teknik_servis' && role !== 'aplikasyon') continue;

                // Cooldown: skip plans already reminded within the last 6 days
                const lastReminderAt = plan.lastMaintenanceReminderAt;
                if (lastReminderAt && typeof lastReminderAt.toMillis === 'function' &&
                    lastReminderAt.toMillis() > cooldownCutoff.toMillis()) {
                    continue;
                }

                // Determine next due date
                const latestLog = latestLogByPlanId.get(planId);
                let nextDue: Date | null = null;
                if (latestLog?.nextDueDate) {
                    nextDue = latestLog.nextDueDate.toDate?.() ||
                        (typeof latestLog.nextDueDate === 'string' ? new Date(latestLog.nextDueDate) : null);
                } else if (plan.createdAt) {
                    const created = plan.createdAt.toDate?.() ||
                        (typeof plan.createdAt === 'string' ? new Date(plan.createdAt) : null);
                    if (created) {
                        nextDue = new Date(created);
                        const pv = Number(plan.periodValue) || 0;
                        if (pv > 0) {
                            if (plan.periodUnit === 'hafta') nextDue.setDate(nextDue.getDate() + pv * 7);
                            else if (plan.periodUnit === 'ay') nextDue.setMonth(nextDue.getMonth() + pv);
                            else if (plan.periodUnit === 'yil') nextDue.setFullYear(nextDue.getFullYear() + pv);
                        }
                    }
                }
                if (!nextDue || isNaN(nextDue.getTime())) continue;

                const daysUntilDue = Math.ceil((nextDue.getTime() - now) / MS_PER_DAY);
                // Only remind when maintenance is due within the next 7 days (and not overdue)
                if (daysUntilDue > 7 || daysUntilDue <= 0) continue;

                // Resolve device → hospitalId
                const device = await loadDevice(plan.deviceId);
                const hospitalId = device?.hospitalId;

                // Find personnel with matching role assigned to the device's lab
                const users = await loadUsersByRole(role);
                const targets: string[] = [];
                for (const u of users) {
                    // If we don't know the device's hospital, notify everyone with the matching role
                    if (!hospitalId || u.assignedLaboratories.includes(hospitalId)) {
                        targets.push(`user:${u.uid}`);
                    }
                }

                if (targets.length === 0) {
                    logger.info(`[maintReminder] Plan ${planId} due in ${daysUntilDue}d but no matching personnel.`);
                    continue;
                }

                const deviceName = device?.model || device?.deviceName || device?.name || 'Bilinmeyen Cihaz';
                const labName = device?.labName || '';
                const roleLabel = role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
                const dueDateStr = nextDue.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
                const taskName = plan.taskName || 'Periyodik bakım';

                const planCompanyId =
                    typeof plan.companyId === 'string' && plan.companyId.trim()
                        ? plan.companyId.trim()
                        : null;
                const maintNotification: Record<string, any> = {
                    type: 'maintenance_reminder',
                    title: `Bakım Hatırlatma: ${deviceName}`,
                    message: `${labName ? labName + ' - ' : ''}${deviceName} cihazı için "${taskName}" (${roleLabel}) görevi ${daysUntilDue} gün içinde (${dueDateStr}) planlanmış durumda. Lütfen kontrol ediniz.`,
                    href: `/cihaz-tanimlamalari/periyodik-bakim-yonetimi?deviceId=${plan.deviceId}&planId=${planId}`,
                    resource: { type: 'device' as const, id: plan.deviceId },
                    actor: { uid: 'system', name: 'Sistem' },
                    targets,
                    meta: {
                        planId,
                        deviceId: plan.deviceId,
                        deviceName,
                        hospitalId: hospitalId || null,
                        labName,
                        taskName,
                        role,
                        roleLabel,
                        dueAt: Timestamp.fromMillis(nextDue.getTime()),
                        daysUntilDue,
                    },
                    channel: 'push' as const,
                    createdAt: FieldValue.serverTimestamp(),
                    readBy: [] as string[],
                };
                if (planCompanyId) maintNotification.companyId = planCompanyId;
                await db.collection('notifications').add(maintNotification);

                await planDoc.ref.update({
                    lastMaintenanceReminderAt: FieldValue.serverTimestamp(),
                });

                notified++;
                logger.info(`[maintReminder] Plan ${planId} (${taskName}) → ${targets.length} personnel (${roleLabel}). Due in ${daysUntilDue}d (${dueDateStr}).`);
            }

            logger.info(`[maintReminder] Completed. Processed ${processed} plans, notified on ${notified}.`);
        } catch (error) {
            logger.error('[maintReminder] Error processing maintenance reminders:', error);
        }
    }
);

// --- İRSALİYE DOSYA TEMİZLEME (1 hafta sonra otomatik silme) ---
// Her gün gece yarısı çalışır (Europe/Istanbul timezone)
export const cleanupExpiredIrsaliyeDosyalari = onSchedule(
    {
        schedule: 'every day 02:00',
        timeZone: 'Europe/Istanbul',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB',
    },
    async () => {
        const now = Timestamp.now();
        const bucket = (await resolveStorageBucket());

        try {
            const expiredDocs = await db
                .collection('irsaliyeDosyalari')
                .where('expiresAt', '<=', now)
                .get();

            if (expiredDocs.empty) {
                logger.info('No expired invoice files found.');
                return;
            }

            logger.info(`Found ${expiredDocs.size} expired invoice files to clean up.`);

            const batches = chunk<any>(expiredDocs.docs);
            for (const batch of batches) {
                const writeBatch = db.batch();
                for (const docSnap of batch) {
                    const data = docSnap.data();
                    // Delete from Storage
                    if (data.storagePath) {
                        try {
                            await bucket.file(data.storagePath).delete();
                            logger.info(`Deleted storage file: ${data.storagePath}`);
                        } catch (e) {
                            logger.warn(`Storage file not found or already deleted: ${data.storagePath}`);
                        }
                    }
                    // Delete from Firestore
                    writeBatch.delete(docSnap.ref);
                }
                await writeBatch.commit();
            }

            logger.info(`Successfully cleaned up ${expiredDocs.size} expired invoice files.`);
        } catch (error) {
            logger.error('Error cleaning up expired invoice files:', error);
        }
    }
);

function chunk<T>(values:T[],size=500){const result:T[][]=[];for(let i=0;i<values.length;i+=size)result.push(values.slice(i,i+size));return result;}
