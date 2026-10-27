import type * as DocumentStore from '../data/admin';
import {adminDb,FieldValue,Timestamp} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import * as functions from '@/lib/jobs/runtime';
import { logger } from '@/lib/jobs/runtime';
import * as nodemailer from 'nodemailer';

import { sendWhatsAppDocument } from './lib/whatsapp';
import { buildActionFormPdf, pngSize, type ClayAssets, type ActionFormInput, type DurumTone } from './lib/clay-pdf';

const db = adminDb;

// --- Assets cache ---
let turkishFontBase64: string | null = null;
let headerLogoBase64: string | null = null;
let systemLogoBase64: string | null = null;

async function loadAssetBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (e) {
    logger.warn(`[actionFormEmail] Could not load asset from ${url}:`, e);
    return null;
  }
}

async function loadTurkishFont(): Promise<string | null> {
  if (turkishFontBase64) return turkishFontBase64;
  turkishFontBase64 = await loadAssetBase64('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf');
  return turkishFontBase64;
}

async function loadHeaderLogo(): Promise<string | null> {
  if (headerLogoBase64) return headerLogoBase64;
  // Fallback chain for logos
  headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invlogo.png');
  if (!headerLogoBase64) {
    headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invitrolab_LOGO__-_Kopya__1_-removebg.png');
  }
  return headerLogoBase64;
}

async function loadSystemLogo(): Promise<string | null> {
  if (systemLogoBase64) return systemLogoBase64;
  systemLogoBase64 = await loadAssetBase64('https://qorengine.com/blk.png');
  if (!systemLogoBase64) {
    systemLogoBase64 = await loadAssetBase64('https://qorengine.com/newlogoblk.png');
  }
  return systemLogoBase64;
}

// Nunito ağırlıkları (clay tasarım fontu) — jsDelivr üzerinden statik TTF olarak yüklenir.
let nunitoSemiBold: string | null = null;
let nunitoExtraBold: string | null = null;
let nunitoBlack: string | null = null;
async function loadNunito(): Promise<{ semibold: string | null; extrabold: string | null; black: string | null }> {
  if (!nunitoSemiBold) nunitoSemiBold = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_600SemiBold.ttf');
  if (!nunitoExtraBold) nunitoExtraBold = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_800ExtraBold.ttf');
  if (!nunitoBlack) nunitoBlack = await loadAssetBase64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_900Black.ttf');
  return { semibold: nunitoSemiBold, extrabold: nunitoExtraBold, black: nunitoBlack };
}

/** Clay PDF için tüm varlıkları (font + logo) yükler. */
async function loadClayAssets(): Promise<ClayAssets> {
  const [nun, noto, headerLogo, sysLogo] = await Promise.all([loadNunito(), loadTurkishFont(), loadHeaderLogo(), loadSystemLogo()]);
  return {
    fonts: { semibold: nun.semibold, extrabold: nun.extrabold, black: nun.black, noto },
    invLogo: headerLogo ? { b64: headerLogo, ...pngSize(headerLogo) } : null,
    qoreLogo: sysLogo ? { b64: sysLogo, ...pngSize(sysLogo) } : null,
  };
}

// --- Labels ---
const TEKNIK_ISLEM_TIPI_LABELS: Record<string, string> = {
  '': '-',
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

const TEKNIK_ISLEM_TURU_LABELS: Record<string, string> = {
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

const APLIKASYON_ISLEM_TURU_LABELS: Record<string, string> = {
  '': '-',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  ariza: 'Arıza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const TEKNIK_OPERATION_LABELS: Record<string, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
};

const APLIKASYON_OPERATION_LABELS: Record<string, string> = {
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

const CIHAZ_DURUMU_LABELS: Record<string, string> = {
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
    logger.warn('[actionFormEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in functions/.env');
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
async function generateActionFormPDF(data: any, formType: 'teknik_servis' | 'aplikasyon', formId: string): Promise<Buffer> {
  const assets = await loadClayAssets();
  const actions: any[] = data.actions || [];
  const isTeknik = formType === 'teknik_servis';
  const turuLabels = isTeknik ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
  const opLabels = isTeknik ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
  const testsStr = (data.selectedTests?.length ?? 0) > 0 ? data.selectedTests.join(', ') : '';

  const chips: { label: string; value: string }[] = [];
  if (isTeknik) {
    chips.push({ label: 'İşlem Tipi', value: TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi || ''] || data.islemTipi || '-' });
    chips.push({ label: 'İşlem Türü', value: turuLabels[data.islemTuru || ''] || data.islemTuru || '-' });
    if (data.islemTuru === 'ariza' && data.selectedFaultName) chips.push({ label: 'Tespit Edilen Arıza', value: data.selectedFaultName });
  } else {
    chips.push({ label: 'İşlem Türü', value: turuLabels[data.islemTuru || ''] || data.islemTuru || '-' });
    if (data.islemTuru === 'ariza') {
      chips.push({ label: 'Tespit Edilen Arıza', value: data.selectedFaultName || '—' });
      chips.push({ label: 'Arıza ile İlişkili Testler', value: testsStr || '—' });
    } else if (testsStr) {
      chips.push({ label: 'İlişkili Testler', value: testsStr });
    }
  }

  const details: { label: string; value: string }[] = [];
  if (data.islemTuru === 'periyodik_bakim' && (data.selectedMaintenanceTasks?.length ?? 0) > 0) {
    details.push({ label: 'Periyodik Bakım İşleri', value: data.selectedMaintenanceTasks.map((t: any) => t.taskName).join(', ') });
  }
  if (isTeknik && testsStr) details.push({ label: 'Arıza ile İlişkili Testler', value: testsStr });

  let durumStr = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
  if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) durumStr += ` (${data.cihazDurumuAciklama})`;
  const durumTone: DurumTone = data.cihazDurumu === 'calisiyor' ? 'green' : data.cihazDurumu === 'arizali' ? 'red' : 'neutral';

  const eslik = (data.eslikEdenPersonel || []).map((p: any) => p.name).filter(Boolean).join(', ');
  const createdDate = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt?._seconds ? new Date(data.createdAt._seconds * 1000) : null);
  const fallbackStr = createdDate ? formatDate(createdDate).replace(' ', ' · ') : '-';
  const fmtDT = (t?: string, s?: string, fb?: string) => (t && s ? `${t.split('-').reverse().join('.')} · ${s}` : (fb || '-'));
  const signDate = data.bitisTarihi
    ? String(data.bitisTarihi).split('-').reverse().join('.')
    : (createdDate ? formatDate(createdDate).split(' ')[0] : '-');

  const input: ActionFormInput = {
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
      if (a.isManualEntry && a.stokKodu && a.stokAdi) partName = `${a.stokKodu} - ${a.stokAdi}`;
      return { parca: partName, kod: a.stokKodu || '-', seri: (a.serialNumber || '').trim() || '-', adet: a.quantity, birim: a.anaBirim ? String(a.anaBirim).toLowerCase() : 'adet' };
    }),
    hucreChanges: actions.filter((a) => a.type === 'hucre_degisimi').map((a) => ({
      parca: a.stokAdi || '-', kod: a.stokKodu || '-',
      takilanCikan: `H:${a.hucreNumarasi || '-'} / H:${a.removedHucreNumarasi || '-'}`,
      kanal: a.channelSelections?.join(', ') || '-',
    })),
    leftSign: { label: 'İşlemi Yapan', name: data.createdByName, sig: data.personnelSignature, date: signDate },
    rightSign: { label: 'Kurum Yetkilisi', name: data.technicianName, sig: data.technicianSignature, date: signDate },
  };

  return buildActionFormPdf(input, assets);
}

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${d}.${m}.${y} ${h}:${min}`;
}

// --- Main handler for both collections ---
async function handleActionFormCreated(
  snap: DocumentStore.QueryDocumentSnapshot,
  context: Record<string,any>,
  formType: 'teknik_servis' | 'aplikasyon'
) {
  const data = snap.data();
  const formId = context.params.formId;

  logger.info(`[actionFormEmail] Processing ${formType} form: ${formId}`);

  // Prepare log entry for Firestore
  const logEntry: Record<string, any> = {
    formId,
    formType,
    deviceId: data.deviceId || null,
    cihazAdi: data.cihazAdi || null,
    labName: data.labName || null,
    hospitalId: data.hospitalId || null,
    createdByName: data.createdByName || null,
    createdByUid: data.createdByUid || null,
    status: 'processing',
    steps: [] as string[],
    error: null as string | null,
    emailSentTo: null as string | null,
    whatsappSent: false,
    whatsappError: null as string | null,
    smtpConfigured: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  try {
    // 1. Get hospital's sorumluEmail
    const hospitalId = data.hospitalId;
    logger.info(`[actionFormEmail] hospitalId: ${hospitalId}`);
    if (!hospitalId) {
      logEntry.status = 'skipped';
      logEntry.error = 'Form üzerinde hospitalId bulunamadı';
      logEntry.steps.push('hospitalId kontrolü: BAŞARISIZ - hospitalId yok');
      logger.info(`[actionFormEmail] No hospitalId on form ${formId}, skipping email.`);
      await db.collection('emailNotificationLogs').add(logEntry);
      return;
    }
    logEntry.steps.push(`hospitalId kontrolü: OK (${hospitalId})`);

    const hospitalDoc = await db.collection('hospitals').doc(hospitalId).get();
    if (!hospitalDoc.exists) {
      logEntry.status = 'skipped';
      logEntry.error = `Hospital dokümanı bulunamadı: ${hospitalId}`;
      logEntry.steps.push(`Hospital dokümanı sorgusu: BAŞARISIZ - ${hospitalId} bulunamadı`);
      logger.info(`[actionFormEmail] Hospital ${hospitalId} not found, skipping email.`);
      await db.collection('emailNotificationLogs').add(logEntry);
      return;
    }
    logEntry.steps.push('Hospital dokümanı sorgusu: OK');

    const hospitalData = hospitalDoc.data()!;
    const sorumluEmailRaw = hospitalData.sorumluEmail;
    const sorumluEmail = (sorumluEmailRaw && typeof sorumluEmailRaw === 'string') ? sorumluEmailRaw.trim() : '';
    logEntry.labName = hospitalData.name || data.labName || null;

    let emailEnabled = true;
    if (!sorumluEmail) {
      emailEnabled = false;
      logEntry.steps.push('sorumluEmail kontrolü: ATLANDI - email tanımlı değil (WhatsApp denenecek)');
      logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email but continuing with WhatsApp.`);
    } else {
      logEntry.steps.push(`sorumluEmail kontrolü: OK (${sorumluEmail})`);
      logEntry.emailSentTo = sorumluEmail;
      logger.info(`[actionFormEmail] sorumluEmail: ${sorumluEmail}`);
    }

    // 2. Get transporter (only required for email; WhatsApp still proceeds without SMTP)
    const transporter = emailEnabled ? getTransporter() : null;
    if (emailEnabled && !transporter) {
      emailEnabled = false;
      logEntry.smtpConfigured = false;
      logEntry.steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ - ortam değişkenleri eksik (WhatsApp denenecek)');
      logger.error(`[actionFormEmail] SMTP not configured, skipping email for form ${formId} but continuing with WhatsApp.`);
    } else if (transporter) {
      logEntry.smtpConfigured = true;
      logEntry.steps.push('SMTP yapılandırma kontrolü: OK');
    }

    // 3. Generate PDF
    logEntry.steps.push('PDF oluşturma: başladı');
    logger.info('[actionFormEmail] PDF generation starting...');
    const pdfBuffer = await generateActionFormPDF(data, formType, formId);
    logEntry.steps.push(`PDF oluşturma: OK (${pdfBuffer.length} byte)`);
    logger.info(`[actionFormEmail] PDF generation OK: ${pdfBuffer.length} bytes`);

    // 4. WhatsApp Notification
    const waConfig = {instance_id:process.env.WHATSAPP_INSTANCE_ID,token:process.env.WHATSAPP_TOKEN,group_id:process.env.WHATSAPP_GROUP_ID,parts_group_id:process.env.WHATSAPP_PARTS_GROUP_ID};
    logger.info('[WhatsApp] Config check...', {
      hasConfig: !!waConfig,
      hasInstanceId: !!waConfig?.instance_id,
      hasToken: !!waConfig?.token,
      hasGroupId: !!waConfig?.group_id
    });

    if (waConfig && waConfig.instance_id && waConfig.token && waConfig.group_id) {
      logEntry.steps.push('WhatsApp gönderimi: başladı');
      logger.info(`[WhatsApp] Attempting to send to: ${waConfig.group_id}`);

      const labName = data.labName || 'Bilinmeyen Laboratuvar';
      const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
      const personnelName = data.createdByName || 'Bilinmeyen Kullanıcı';
      const formTypeLabel = formType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';

      let cihazDurumuCaption = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
      if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) {
        cihazDurumuCaption += ` (${data.cihazDurumuAciklama})`;
      }

      const caption =
        `*${formTypeLabel} İşlemi Tamamlandı*\n\n` +
        `- *Kurum:* ${labName}\n` +
        `- *Cihaz:* ${cihazAdi}\n` +
        `- *Form No:* ${data.formNo || formId}\n` +
        `- *Personel:* ${personnelName}\n` +
        `- *Cihaz Durumu:* ${cihazDurumuCaption}\n\n` +
        `QORE Sistemi üzerinden detaylara ulaşabilirsiniz.`;

      const waFileName = `IslemFormu_${formType === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;

      try {
        // --- 4.1 Upload to Storage to get a URL ---
        logger.info('[WhatsApp] Uploading PDF to storage for URL-based sending...');
        const bucket = (await resolveStorageBucket());
        const storagePath = `actionFormPDFs/${formId}_${Date.now()}.pdf`;
        const file = bucket.file(storagePath);

        await file.save(pdfBuffer, {
          contentType: 'application/pdf',
          metadata: {
            cacheControl: 'public, max-age=3600',
          },
        });

        // Make the file public so UltraMsg can access it


        // Construct the public URL
        const publicUrl = new URL((await file.getSignedUrl())[0], process.env.APP_BASE_URL || (()=>{throw new Error('APP_BASE_URL is required for document delivery');})()).toString();

        logger.info(`[WhatsApp] PDF uploaded and made public. URL: ${publicUrl}`);

        // --- 4.2 Send via WhatsApp ---
        const waResult = await sendWhatsAppDocument(
          publicUrl,
          waFileName,
          caption,
          waConfig.group_id,
          waConfig.instance_id,
          waConfig.token
        );
        logger.info(`[WhatsApp] Result: ${JSON.stringify(waResult)}`);
        if (waResult.success) {
          logEntry.whatsappSent = true;
          logEntry.steps.push(`WhatsApp gönderimi: OK (MsgID: ${waResult.messageId})`);
        } else {
          logEntry.whatsappError = waResult.error || 'Unknown error';
          logEntry.steps.push(`WhatsApp gönderimi: BAŞARISIZ - ${waResult.error}`);
        }

        // --- 4.3 Send to parts group too if form contains part changes ---
        const hasPartChanges = Array.isArray(data.actions) && data.actions.some((a: any) => a?.type === 'part_change');
        const partsGroupId: string | undefined = waConfig.parts_group_id || '905362835871-1624522639@g.us';
        if (hasPartChanges && partsGroupId) {
          logger.info(`[WhatsApp] Form has part changes; also sending to parts group: ${partsGroupId}`);
          try {
            const partsResult = await sendWhatsAppDocument(
              publicUrl,
              waFileName,
              caption,
              partsGroupId,
              waConfig.instance_id,
              waConfig.token
            );
            logger.info(`[WhatsApp] Parts group result: ${JSON.stringify(partsResult)}`);
            if (partsResult.success) {
              logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: OK (MsgID: ${partsResult.messageId})`);
            } else {
              logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: BAŞARISIZ - ${partsResult.error}`);
            }
          } catch (partsErr: any) {
            logger.error('[WhatsApp] Parts group send error', partsErr);
            logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: HATA - ${partsErr?.message || partsErr}`);
          }
        }
      } catch (waErr: any) {
        logger.error('[WhatsApp] Fatal error in notification flow:', waErr);
        logEntry.whatsappError = waErr.message || String(waErr);
        logEntry.steps.push(`WhatsApp gönderimi: HATA - ${waErr.message}`);
      }
    } else {
      logger.warn('[WhatsApp] Skipping: Configuration is incomplete.');
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
        logger.info(`[actionFormEmail] Email sent to ${sorumluEmail} for form ${formId}`);
      } catch (error: any) {
        logEntry.status = 'failed';
        logEntry.error = error?.message || String(error);
        logEntry.steps.push(`Email gönderimi: BAŞARISIZ - ${error?.message || error}`);
        logger.error(`[actionFormEmail] Failed to send email for form ${formId}:`, error?.message || error);
      }
    } else {
      // Email skipped; reflect final status based on WhatsApp result
      if (logEntry.whatsappSent) {
        logEntry.status = 'sent';
        logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok), WhatsApp ile bildirildi');
      } else {
        logEntry.status = 'skipped';
        logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok)');
      }
      logger.info(`[actionFormEmail] Email step skipped for form ${formId} (emailEnabled=false).`);
    }
  } catch (outerError: any) {
    logEntry.status = 'error';
    logEntry.error = outerError?.message || String(outerError);
    logEntry.steps.push(`Beklenmeyen hata: ${outerError?.message || outerError}`);
    logger.error(`[actionFormEmail] Unexpected error for form ${formId}:`, outerError?.message || outerError);
  }

  // Always write log entry
  try {
    await db.collection('emailNotificationLogs').add(logEntry);
  } catch (logError) {
    logger.error(`[actionFormEmail] Failed to write log for form ${formId}:`, logError);
  }
}

// --- Firestore Triggers ---
export const onTeknikServisFormCreated = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('teknikServisActionForms/{formId}')
  .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'teknik_servis');
  });

export const onAplikasyonFormCreated = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('aplikasyonActionForms/{formId}')
  .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'aplikasyon');
  });
