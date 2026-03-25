import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const db = admin.firestore();

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
  periyodik_bakim: 'Periyodik Bakim',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Ariza',
  sw_update: 'SW Update',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arizasi',
};

const APLIKASYON_ISLEM_TURU_LABELS: Record<string, string> = {
  '': '-',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakim',
  ariza: 'Ariza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arizasi',
};

const TEKNIK_OPERATION_LABELS: Record<string, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yaglama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarlari & Kontrol',
};

const APLIKASYON_OPERATION_LABELS: Record<string, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Ornek Sonucu Karsilastirma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibrator Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Calismasi',
  diger: 'Diger',
};

const CIHAZ_DURUMU_LABELS: Record<string, string> = {
  '': '-',
  calisiyor: 'Calisiyor',
  arizali: 'Arizali',
  denemede: 'Denemede',
  diger: 'Diger',
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

// --- PDF Generation ---
function generateActionFormPDF(data: any, formType: 'teknik_servis' | 'aplikasyon'): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const padX = 40;

  doc.setFont('helvetica');

  // --- Header ---
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const title = formType === 'teknik_servis' ? 'Teknik Servis Formu' : 'Aplikasyon Formu';
  doc.text(title, padX, 40);

  // --- Form Info ---
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  let currentY = 60;

  // Build personnel string
  let personnelStr = data.createdByName || '-';
  if (data.eslikEdenPersonel && data.eslikEdenPersonel.length > 0) {
    const eslikNames = data.eslikEdenPersonel.map((p: any) => p.name).join(', ');
    personnelStr += ` (Eslik Eden: ${eslikNames})`;
  }

  const createdAtStr = data.createdAt?.toDate
    ? formatDate(data.createdAt.toDate())
    : (data.createdAt?._seconds ? formatDate(new Date(data.createdAt._seconds * 1000)) : '-');

  const info = [
    ['Laboratuvar:', data.labName || '-'],
    ['Cihaz:', `${data.cihazAdi || '-'} (SN: ${data.seriNumarasi || '-'})`],
    ['Islemi Yapan:', personnelStr],
    ['Tarih / Saat:', createdAtStr],
  ];

  if (data.baslangicTarihi && data.baslangicSaati) {
    info.push(['Baslangic:', `${data.baslangicTarihi} ${data.baslangicSaati}`]);
  }
  if (data.bitisTarihi && data.bitisSaati) {
    info.push(['Bitis:', `${data.bitisTarihi} ${data.bitisSaati}`]);
  }

  autoTable(doc, {
    body: info,
    startY: currentY,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
  });
  currentY = (doc as any).lastAutoTable.finalY + 15;

  // --- Aciklama ---
  if (data.aciklama?.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.text('Aciklama', padX, currentY + 12);
    currentY += 18;

    autoTable(doc, {
      body: [[data.aciklama]],
      startY: currentY,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- Islem Tipi ve Turu ---
  doc.setFont('helvetica', 'bold');
  doc.text('Islem Tipi ve Turu', padX, currentY + 12);
  currentY += 18;
  doc.setFont('helvetica', 'normal');

  const islemRows: string[][] = [];
  if (formType === 'teknik_servis' && data.islemTipi) {
    islemRows.push(['Islem Tipi:', TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi] || data.islemTipi]);
  }
  const turuLabels = formType === 'teknik_servis' ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
  islemRows.push(['Islem Turu:', turuLabels[data.islemTuru || ''] || data.islemTuru || '-']);

  autoTable(doc, {
    body: islemRows,
    startY: currentY,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    margin: { left: padX, right: padX },
  });
  currentY = (doc as any).lastAutoTable.finalY + 15;

  // --- Yapilan Islemler ---
  const operationLabels = formType === 'teknik_servis' ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
  const operations = (data.actions || []).filter((a: any) => a.type === 'operation');
  if (operations.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.text('Yapilan Islemler', padX, currentY + 12);
    currentY += 18;

    autoTable(doc, {
      head: [['Islem', 'Adet']],
      body: operations.map((act: any) => [
        operationLabels[act.action] || act.action,
        String(act.quantity),
      ]),
      startY: currentY,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- Degisen Parcalar ---
  const parts = (data.actions || []).filter((a: any) => a.type === 'part_change');
  if (parts.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.text('Degisen Parcalar', padX, currentY + 12);
    currentY += 18;

    autoTable(doc, {
      head: [['Parca', 'Kod', 'Adet']],
      body: parts.map((act: any) => [
        act.stokAdi || act.action,
        act.stokKodu || '-',
        String(act.quantity),
      ]),
      startY: currentY,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- Cihaz Durumu ---
  doc.setFont('helvetica', 'bold');
  doc.text('Cihaz Durumu', padX, currentY + 12);
  currentY += 18;

  let cihazDurumuStr = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
  if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) {
    cihazDurumuStr += ` (${data.cihazDurumuAciklama})`;
  }

  autoTable(doc, {
    body: [['Durum:', cihazDurumuStr]],
    startY: currentY,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    margin: { left: padX, right: padX },
  });

  // Return as Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
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
  snap: functions.firestore.QueryDocumentSnapshot,
  context: functions.EventContext,
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
    smtpConfigured: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // 1. Get hospital's sorumluEmail
    const hospitalId = data.hospitalId;
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
    const sorumluEmail = hospitalData.sorumluEmail;
    logEntry.labName = hospitalData.name || data.labName || null;

    if (!sorumluEmail || !sorumluEmail.trim()) {
      logEntry.status = 'skipped';
      logEntry.error = `Hospital ${hospitalId} için sorumluEmail tanımlı değil`;
      logEntry.steps.push('sorumluEmail kontrolü: BAŞARISIZ - email tanımlı değil');
      logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email.`);
      await db.collection('emailNotificationLogs').add(logEntry);
      return;
    }
    logEntry.steps.push(`sorumluEmail kontrolü: OK (${sorumluEmail.trim()})`);
    logEntry.emailSentTo = sorumluEmail.trim();

    // 2. Get transporter
    const transporter = getTransporter();
    if (!transporter) {
      logEntry.status = 'failed';
      logEntry.smtpConfigured = false;
      logEntry.error = 'SMTP yapılandırması eksik. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ortam değişkenlerini kontrol edin.';
      logEntry.steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ - ortam değişkenleri eksik');
      logger.error(`[actionFormEmail] SMTP not configured, cannot send email for form ${formId}.`);
      await db.collection('emailNotificationLogs').add(logEntry);
      return;
    }
    logEntry.smtpConfigured = true;
    logEntry.steps.push('SMTP yapılandırma kontrolü: OK');

    // 3. Generate PDF
    logEntry.steps.push('PDF oluşturma: başladı');
    const pdfBuffer = generateActionFormPDF(data, formType);
    logEntry.steps.push(`PDF oluşturma: OK (${pdfBuffer.length} byte)`);

    // 4. Compose email
    const labName = hospitalData.name || data.labName || 'Bilinmeyen Laboratuvar';
    const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
    const personnelName = data.createdByName || 'Bilinmeyen Kullanici';
    const formTypeLabel = formType === 'teknik_servis' ? 'teknik servis' : 'aplikasyon';

    const subject = `Islem Formu - ${labName} - ${cihazAdi}`;
    const body = `Sorumlusu oldugunuz ${labName} laboratuvarindaki ${cihazAdi} cihazina ${formTypeLabel} personeli ${personnelName} tarafindan islem formu kaydedilmistir. Ilgili belge ektedir.`;

    const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const pdfFileName = `IslemFormu_${formType === 'teknik_servis' ? 'TeknikServis' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;

    logEntry.steps.push(`Email hazırlandı: from=${senderEmail}, to=${sorumluEmail.trim()}, subject=${subject}`);

    try {
      await transporter.sendMail({
        from: senderEmail,
        to: sorumluEmail.trim(),
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
