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

// --- PDF Generation (matching client-side template) ---
function generateActionFormPDF(data: any, formType: 'teknik_servis' | 'aplikasyon', formId: string): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const padX = 40;
  const FONT = 'helvetica';

  const ORANGE = { r: 199, g: 137, b: 65 };

  doc.setFont(FONT);

  // --- Orange page border ---
  doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
  doc.setLineWidth(2);
  doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

  // --- HEADER ---
  const headerY = 30;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont(FONT, 'bold');
  const title = formType === 'teknik_servis' ? 'Teknik Servis Formu' : 'Aplikasyon Formu';
  doc.text(title, padX, headerY + 20);

  // --- FORM INFO SECTION ---
  doc.setFontSize(10);
  doc.setFont(FONT, 'normal');
  let currentY = 100;

  // Build personnel string with accompanying personnel
  let personnelStr = data.createdByName || '-';
  if (data.eslikEdenPersonel && data.eslikEdenPersonel.length > 0) {
    const eslikNames = data.eslikEdenPersonel.map((p: any) => p.name).join(', ');
    personnelStr += ` (Eslik Eden: ${eslikNames})`;
  }

  // Use baslangicTarihi if available, otherwise createdAt
  let dateStr: string;
  if (data.baslangicTarihi && data.baslangicSaati) {
    const parts = data.baslangicTarihi.split('-');
    dateStr = `${parts[2]}.${parts[1]}.${parts[0]} ${data.baslangicSaati}`;
  } else {
    dateStr = data.createdAt?.toDate
      ? formatDate(data.createdAt.toDate())
      : (data.createdAt?._seconds ? formatDate(new Date(data.createdAt._seconds * 1000)) : '-');
  }

  const info: string[][] = [
    ['Form No:', formId],
    ['Laboratuvar:', data.labName || '-'],
    ['Cihaz:', `${data.cihazAdi || '-'} (SN: ${data.seriNumarasi || '-'})`],
    ['Islemi Yapan:', personnelStr],
    ['Tarih / Saat:', dateStr],
  ];

  autoTable(doc, {
    body: info,
    startY: currentY,
    theme: 'plain',
    styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
  });
  currentY = (doc as any).lastAutoTable.finalY + 15;

  // --- ACIKLAMA SECTION ---
  if (data.aciklama?.trim()) {
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
    doc.text('Aciklama', padX, currentY + 12);
    currentY += 18;

    autoTable(doc, {
      body: [[data.aciklama]],
      startY: currentY,
      theme: 'grid',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- ISLEM TURUNE OZEL DETAYLAR ---
  const hasPeriyodikDetay = data.islemTuru === 'periyodik_bakim' && (data.selectedMaintenanceTasks?.length ?? 0) > 0;
  const hasArizaDetay = data.islemTuru === 'ariza' && (Boolean(data.selectedFaultName) || (data.selectedTests?.length ?? 0) > 0);

  if (hasPeriyodikDetay || hasArizaDetay) {
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
    doc.text('Islem Turune Ozel Detaylar', padX, currentY + 12);
    currentY += 18;

    const detailRows: string[][] = [];

    if (hasPeriyodikDetay) {
      detailRows.push([
        'Periyodik Bakim Isleri',
        data.selectedMaintenanceTasks.map((task: any) => task.taskName).join(', '),
      ]);
    }

    if (hasArizaDetay) {
      detailRows.push([
        'Tespit Edilen Ariza',
        data.selectedFaultName || '-',
      ]);

      if ((data.selectedTests?.length ?? 0) > 0) {
        detailRows.push([
          'Ariza ile Iliskili Testler',
          data.selectedTests.join(', '),
        ]);
      }
    }

    autoTable(doc, {
      body: detailRows,
      startY: currentY,
      theme: 'grid',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 5, bottom: 5 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- ISLEM TIPI & TURU SECTION ---
  doc.setFont(FONT, 'bold');
  doc.setFontSize(10);
  doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
  doc.line(padX, currentY, pageW - padX, currentY);
  doc.text('Islem Tipi ve Turu', padX, currentY + 12);
  currentY += 18;
  doc.setFont(FONT, 'normal');

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
    styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    margin: { left: padX, right: padX },
  });
  currentY = (doc as any).lastAutoTable.finalY + 15;

  // --- YAPILAN ISLEMLER SECTION ---
  const operationLabels = formType === 'teknik_servis' ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
  const operations = (data.actions || []).filter((a: any) => a.type === 'operation');
  if (operations.length > 0) {
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
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
      styles: { font: FONT, fontSize: 10 },
      headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- DEGISEN PARCALAR SECTION ---
  const parts = (data.actions || []).filter((a: any) => a.type === 'part_change');
  if (parts.length > 0) {
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
    doc.text('Degisen Parcalar', padX, currentY + 12);
    currentY += 18;

    autoTable(doc, {
      head: [['Parca', 'Kod', 'Adet', 'Birim']],
      body: parts.map((act: any) => {
        let partName = act.stokAdi || act.action;
        if (act.isManualEntry && act.stokKodu && act.stokAdi) {
          partName = `${act.stokKodu} - ${act.stokAdi}`;
        }
        return [
          partName,
          act.stokKodu || '-',
          String(act.quantity),
          act.anaBirim ? act.anaBirim.toLowerCase() : 'adet',
        ];
      }),
      startY: currentY,
      theme: 'grid',
      styles: { font: FONT, fontSize: 10 },
      headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
      margin: { left: padX, right: padX },
    });
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  // --- CIHAZ DURUMU SECTION ---
  doc.setFont(FONT, 'bold');
  doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
  doc.line(padX, currentY, pageW - padX, currentY);
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
    styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    margin: { left: padX, right: padX },
  });

  const finalY = (doc as any).lastAutoTable.finalY;

  // --- IMZALAR (SIGNATURES) SECTION ---
  const signatureY = finalY + 40;
  if (signatureY < pageH - 140) {
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, signatureY - 15, pageW - padX, signatureY - 15);
    doc.text('Imzalar', padX, signatureY - 3);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(10);

    // Personnel signature with name
    doc.text('Islemi Yapan Personel', padX, signatureY + 15);
    doc.setFont(FONT, 'bold');
    doc.text(data.createdByName || '-', padX, signatureY + 28);
    doc.setFont(FONT, 'normal');
    doc.line(padX, signatureY + 32, padX + 150, signatureY + 32);
    if (data.personnelSignature) {
      try {
        doc.addImage(data.personnelSignature, 'PNG', padX, signatureY + 37, 150, 40, undefined, 'FAST');
      } catch (e) { /* signature image may fail in server context */ }
    }

    // Technician signature with name
    doc.text('Teknisyen', pageW / 2 + 20, signatureY + 15);
    doc.setFont(FONT, 'bold');
    doc.text(data.technicianName || '-', pageW / 2 + 20, signatureY + 28);
    doc.setFont(FONT, 'normal');
    doc.line(pageW / 2 + 20, signatureY + 32, pageW / 2 + 170, signatureY + 32);
    if (data.technicianSignature) {
      try {
        doc.addImage(data.technicianSignature, 'PNG', pageW / 2 + 20, signatureY + 37, 150, 40, undefined, 'FAST');
      } catch (e) { /* signature image may fail in server context */ }
    }
  }

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
    const pdfBuffer = generateActionFormPDF(data, formType, formId);
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
