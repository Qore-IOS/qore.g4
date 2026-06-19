import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import * as exceljs from 'exceljs';
import {
  buildItemInfoMap,
  groupMapFromInfo,
  loadLabGroupNamesByDocId,
  loadLojistikUsers,
  filterItemsForUserGroups,
  resolveUserGroupNames,
  ProductInfo,
} from './lib/peripheralRecipients';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type OrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  adet?: number;
};

type OrderDoc = {
  id?: string;
  labId?: string;
  depotId?: string;
  depotName?: string;
  kurumAdi?: string;
  items?: OrderItem[];
  createdAt?: admin.firestore.Timestamp;
  createdBy?: string;
  createdById?: string;
  requestSource?: string;
  isPeripheral?: boolean;
  isDepotRequest?: boolean;
  requestedManagerEmails?: string[];
  urgency?: 'normal' | 'acil' | 'cok_acil';
  note?: string;
};

const URGENCY_META: Record<
  NonNullable<OrderDoc['urgency']>,
  { label: string; emailBg: string; emailText: string; xlBg: string; xlText: string; emailBadgeBorder: string }
> = {
  normal:   { label: 'Normal',    emailBg: '#dcfce7', emailText: '#14532d', xlBg: 'FFDCFCE7', xlText: 'FF14532D', emailBadgeBorder: '#16a34a' },
  acil:     { label: 'Acil',      emailBg: '#fef3c7', emailText: '#78350f', xlBg: 'FFFEF3C7', xlText: 'FF78350F', emailBadgeBorder: '#f59e0b' },
  cok_acil: { label: 'Çok Acil',  emailBg: '#fee2e2', emailText: '#7f1d1d', xlBg: 'FFFEE2E2', xlText: 'FF7F1D1D', emailBadgeBorder: '#ef4444' },
};

const THIN_BORDER: Partial<exceljs.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

const MEDIUM_BORDER: Partial<exceljs.Borders> = {
  top: { style: 'medium', color: { argb: 'FF1E293B' } },
  left: { style: 'medium', color: { argb: 'FF1E293B' } },
  bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
  right: { style: 'medium', color: { argb: 'FF1E293B' } },
};

// Each column gets its own dedicated colour palette (header + body tint)
const COLUMN_PALETTE: Array<{ header: string; body: string; text: string }> = [
  { header: 'FF334155', body: 'FFF1F5F9', text: 'FF0F172A' }, // # — slate
  { header: 'FF0EA5E9', body: 'FFE0F2FE', text: 'FF0C4A6E' }, // Stok Kodu — sky
  { header: 'FF6366F1', body: 'FFE0E7FF', text: 'FF312E81' }, // Stok Adı — indigo
  { header: 'FF14B8A6', body: 'FFCCFBF1', text: 'FF134E4A' }, // Lab Stok — teal
  { header: 'FFF59E0B', body: 'FFFEF3C7', text: 'FF78350F' }, // 30 Günlük Max — amber
  { header: 'FFEF4444', body: 'FFFEE2E2', text: 'FF7F1D1D' }, // Yakın Miad — red
  { header: 'FF16A34A', body: 'FFDCFCE7', text: 'FF14532D' }, // Talep Adedi — green
];

function getTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('[peripheralOrderEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

async function buildExcelBuffer(orderId: string, order: OrderDoc, itemInfoMap?: Map<string, ProductInfo>): Promise<Buffer> {
  const isDepotRequest = order.requestSource === 'depot_to_office' || order.isDepotRequest === true;
  const labId = order.labId;
  const depotId = order.depotId;
  const stockOwnerId = isDepotRequest ? depotId : labId;
  const stockOwnerCollection = isDepotRequest ? 'depots' : 'hospitals';
  const stockOwnerLabel = isDepotRequest ? 'depo' : 'lab';

  // 1. Fetch minMaxRules (max amount per stokKodu). Depot-origin requests must
  // use depots/{depotId}/minMaxRules so the "30 Günlük Max" column mirrors the
  // selected depot's stock-management configuration.
  const rulesMap: Record<string, number> = {};
  if (stockOwnerId) {
    try {
      const rulesSnap = await db.collection(stockOwnerCollection).doc(stockOwnerId).collection('minMaxRules').get();
      rulesSnap.forEach(doc => {
        const data = doc.data();
        const stokKodu = data.stokKodu || doc.id;
        if (stokKodu && data.max !== undefined) {
          rulesMap[stokKodu] = Number(data.max);
        }
      });
    } catch (err) {
      logger.error(`Error fetching minMaxRules for ${stockOwnerLabel} ${stockOwnerId}:`, err);
    }
  }

  // 2. Fetch depoStok for current stock and closest miad lot count. Lab requests
  // continue to read shipped stock by hedefKurumId; depot requests read the
  // unshipped stock physically in the selected depot.
  const stockMap: Record<string, number> = {};
  const closestMiadLotMap: Record<string, number> = {};

  if (stockOwnerId) {
    try {
      let depoStokQuery: FirebaseFirestore.Query = db.collection('depoStok');
      if (isDepotRequest) {
        depoStokQuery = depoStokQuery
          .where('depotId', '==', stockOwnerId)
          .where('isShipped', '==', false);
      } else {
        depoStokQuery = depoStokQuery
          .where('isShipped', '==', true)
          .where('hedefKurumId', '==', stockOwnerId);
      }

      const depoStokSnap = await depoStokQuery.get();
      const items = depoStokSnap.docs.map(d => d.data());
      const groupedByStok: Record<string, any[]> = {};

      items.forEach(item => {
        if (!item.stokKodu) return;
        if (!groupedByStok[item.stokKodu]) groupedByStok[item.stokKodu] = [];
        groupedByStok[item.stokKodu].push(item);
      });

      for (const [stokKodu, groupItems] of Object.entries(groupedByStok)) {
        stockMap[stokKodu] = groupItems.length;

        const itemsWithMiad = groupItems.filter(i => i.miad);
        if (itemsWithMiad.length > 0) {
          itemsWithMiad.sort((a, b) => {
            const miadA = a.miad?.toDate ? a.miad.toDate().getTime() : new Date(a.miad).getTime();
            const miadB = b.miad?.toDate ? b.miad.toDate().getTime() : new Date(b.miad).getTime();
            return miadA - miadB;
          });

          const earliestTime = itemsWithMiad[0].miad?.toDate
            ? itemsWithMiad[0].miad.toDate().getTime()
            : new Date(itemsWithMiad[0].miad).getTime();

          const count = itemsWithMiad.filter(i => {
            const time = i.miad?.toDate ? i.miad.toDate().getTime() : new Date(i.miad).getTime();
            return time === earliestTime;
          }).length;

          closestMiadLotMap[stokKodu] = count;
        } else {
          closestMiadLotMap[stokKodu] = 0;
        }
      }
    } catch (err) {
      logger.error(`Error fetching depoStok for ${stockOwnerLabel} ${stockOwnerId}:`, err);
    }
  }

  // 3. Build Excel
  const workbook = new exceljs.Workbook();
  workbook.creator = 'INV-zen';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(isDepotRequest ? 'Depo Talep' : 'Perifer Talep', {
    properties: { defaultRowHeight: 18 },
  });

  const createdAtText = order.createdAt?.toDate?.()
    ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
    : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const labName = order.kurumAdi || order.depotName || '-';
  const createdBy = order.createdBy || '-';
  const totalQty = (order.items || []).reduce((s, it) => s + Number(it.adet || 0), 0);
  const urgencyKey = (order.urgency && URGENCY_META[order.urgency] ? order.urgency : 'normal') as keyof typeof URGENCY_META;
  const urgencyMeta = URGENCY_META[urgencyKey];
  const noteText = (order.note || '').trim();

  // --- Title row (merged across columns) ---
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = isDepotRequest ? 'DEPO ÜRÜN TALEBİ' : 'PERİFER LABORATUVAR ÜRÜN TALEBİ';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  titleCell.border = MEDIUM_BORDER;
  sheet.getRow(1).height = 28;

  // --- Info rows: label + value, both bordered with distinct colours ---
  type InfoRow = {
    label: string;
    value: string;
    labelFill: string;
    valueFill: string;
    valueBold?: boolean;
    valueColor?: string;
    valueSize?: number;
  };
  const infoRows: InfoRow[] = [
    { label: 'Sipariş ID',     value: orderId,                 labelFill: 'FFE0F2FE', valueFill: 'FFFFFFFF' },
    { label: isDepotRequest ? 'Depo' : 'Laboratuvar', value: labName, labelFill: 'FFE0E7FF', valueFill: 'FFFFFFFF' },
    { label: isDepotRequest ? 'Depo ID' : 'Laboratuvar ID', value: stockOwnerId || '-', labelFill: 'FFCCFBF1', valueFill: 'FFFFFFFF' },
    { label: 'Talep Eden',     value: createdBy,               labelFill: 'FFFEF3C7', valueFill: 'FFFFFFFF' },
    { label: 'Tarih',          value: createdAtText,           labelFill: 'FFFEE2E2', valueFill: 'FFFFFFFF' },
    {
      label: 'Aciliyet',
      value: urgencyMeta.label.toLocaleUpperCase('tr-TR'),
      labelFill: urgencyMeta.xlBg,
      valueFill: urgencyMeta.xlBg,
      valueBold: true,
      valueColor: urgencyMeta.xlText,
      valueSize: 13,
    },
    { label: 'Toplam Kalem / Toplam Adet', value: `${(order.items || []).length} kalem  ·  ${totalQty} adet`, labelFill: 'FFDCFCE7', valueFill: 'FFFFFFFF' },
  ];
  if (noteText) {
    infoRows.push({
      label: 'Açıklama',
      value: noteText,
      labelFill: 'FFF1F5F9',
      valueFill: 'FFFFFFFF',
    });
  }

  infoRows.forEach((info, idx) => {
    const rowIdx = idx + 2; // start at row 2
    const row = sheet.getRow(rowIdx);
    row.height = info.label === 'Açıklama' ? 36 : 20;

    const labelCell = row.getCell(1);
    labelCell.value = info.label;
    labelCell.font = { bold: true, color: { argb: 'FF0F172A' } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.labelFill } };
    labelCell.border = THIN_BORDER;

    sheet.mergeCells(rowIdx, 2, rowIdx, 7);
    const valueCell = row.getCell(2);
    valueCell.value = info.value;
    valueCell.font = {
      size: info.valueSize ?? 11,
      bold: info.valueBold ?? false,
      color: { argb: info.valueColor ?? 'FF0F172A' },
    };
    valueCell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      indent: 1,
      wrapText: info.label === 'Açıklama',
    };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.valueFill } };
    valueCell.border = THIN_BORDER;
  });

  // --- Header row sits right after info rows ---
  const HEADER_ROW = 2 + infoRows.length;
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  const headers = ['#', 'Stok Kodu', 'Stok Adı', isDepotRequest ? 'Depo Stok' : 'Lab Stok', '30 Günlük Max', 'Yakın Miad Lot Adedi', 'Talep Adedi'];
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 32;

  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLUMN_PALETTE[i].header },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = MEDIUM_BORDER;
  });

  // --- Data rows ---
  const items = order.items || [];
  items.forEach((item, idx) => {
    const sKodu = item.stokKodu || '-';
    const mevcutStok = stockMap[sKodu] ?? 0;
    const maxAdet = rulesMap[sKodu] ?? 0;
    const yakinMiad = closestMiadLotMap[sKodu] ?? 0;
    const talep = Number(item.adet || 0);

    const info = itemInfoMap?.get(sKodu);
    const anaBirim = (info?.anaBirim || '').trim();
    const ambalaj = info?.ambalajDegeri;
    const talepCellValue: string | number =
      typeof ambalaj === 'number' && ambalaj > 0
        ? `${talep}${anaBirim ? ` ${anaBirim}` : ''} (${talep * ambalaj} adet)`
        : (anaBirim ? `${talep} ${anaBirim}` : talep);

    const row = sheet.getRow(HEADER_ROW + 1 + idx);
    row.height = 30;

    const values: Array<string | number> = [
      idx + 1,
      sKodu,
      item.stokAdi || '-',
      mevcutStok,
      maxAdet,
      yakinMiad,
      talepCellValue,
    ];

    values.forEach((value, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = value;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLUMN_PALETTE[colIdx].body },
      };
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: colIdx === 2 ? 'left' : 'center',
        indent: colIdx === 2 ? 1 : 0,
      };

      // Talep Adedi (last column) — large, bold, vivid
      if (colIdx === 6) {
        cell.font = { bold: true, size: 18, color: { argb: COLUMN_PALETTE[6].text } };
        cell.border = MEDIUM_BORDER;
      } else if (colIdx === 0) {
        cell.font = { bold: true, size: 11, color: { argb: COLUMN_PALETTE[colIdx].text } };
      } else {
        cell.font = { size: 11, color: { argb: COLUMN_PALETTE[colIdx].text } };
      }
    });
  });

  // --- Totals row (sum of Talep Adedi) ---
  const totalRowIdx = HEADER_ROW + 1 + items.length;
  const totalRow = sheet.getRow(totalRowIdx);
  totalRow.height = 28;

  sheet.mergeCells(totalRowIdx, 1, totalRowIdx, 6);
  const totalLabelCell = totalRow.getCell(1);
  totalLabelCell.value = 'TOPLAM TALEP ADEDİ';
  totalLabelCell.font = { bold: true, size: 12, color: { argb: 'FF14532D' } };
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  totalLabelCell.border = MEDIUM_BORDER;

  const totalValueCell = totalRow.getCell(7);
  totalValueCell.value = totalQty;
  totalValueCell.font = { bold: true, size: 18, color: { argb: 'FF14532D' } };
  totalValueCell.alignment = { vertical: 'middle', horizontal: 'center' };
  totalValueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBF7D0' } };
  totalValueCell.border = MEDIUM_BORDER;

  // --- Column widths (manually tuned for readability) ---
  const widths = [6, 18, 42, 12, 16, 22, 16];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}

async function resolveLogisticsRecipients(): Promise<{ emails: string[]; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};
  const emailSet = new Set<string>();

  // Primary: users with role === 'lojistik_sorumlusu'
  try {
    const usersSnap = await db
      .collection('users')
      .where('role', '==', 'lojistik_sorumlusu')
      .get();

    debug.lojistikSorumlusuFound = usersSnap.size;

    usersSnap.docs.forEach((d) => {
      const email = (d.data()?.email || '').trim();
      if (email) emailSet.add(email.toLowerCase());
    });
  } catch (err: any) {
    debug.primaryQueryError = err?.message || String(err);
  }

  debug.emailsFromPrimary = emailSet.size;
  return { emails: Array.from(emailSet), debug };
}

export const onPeripheralOrderCreatedSendMail = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId as string;
    const order = snap.data() as OrderDoc;

    const isPeripheralRequest =
      order?.isPeripheral === true || order?.requestSource === 'lab_to_office' || order?.requestSource === 'depot_to_office';
    const isDepotRequest = order?.requestSource === 'depot_to_office' || order?.isDepotRequest === true;

    const logEntry: Record<string, unknown> = {
      type: 'peripheral_order_email',
      orderId,
      labId: order?.labId || null,
      labName: order?.kurumAdi || null,
      isPeripheral: order?.isPeripheral ?? null,
      isDepotRequest,
      requestSource: order?.requestSource ?? null,
      itemsCount: (order?.items || []).length,
      urgency: order?.urgency ?? null,
      hasNote: !!(order?.note && order.note.trim().length > 0),
      status: 'processing',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      recipients: [] as string[],
      steps: [] as string[],
    };
    const steps = logEntry.steps as string[];

    if (!isPeripheralRequest) {
      logEntry.status = 'skipped';
      logEntry.error = `Order is not peripheral (isPeripheral=${order?.isPeripheral}, requestSource=${order?.requestSource})`;
      steps.push('isPeripheral kontrolü: ATLAND - perifer talep değil');
      try {
        await db.collection('emailNotificationLogs').add(logEntry);
      } catch (e) {
        logger.error('[peripheralOrderEmail] Could not write skip-log:', e);
      }
      return;
    }
    steps.push('isPeripheral kontrolü: OK');

    try {
      const transporter = getTransporter();
      if (!transporter) {
        logEntry.status = 'failed';
        logEntry.error =
          'SMTP yapılandırması eksik. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ortam değişkenlerini kontrol edin.';
        steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ');
        await db.collection('emailNotificationLogs').add(logEntry);
        logger.error(`[peripheralOrderEmail] SMTP not configured for order ${orderId}.`);
        return;
      }
      steps.push('SMTP yapılandırma kontrolü: OK');

      const orderItems = Array.isArray(order.items) ? order.items : [];
      if (orderItems.length === 0) {
        logEntry.status = 'skipped';
        logEntry.error = 'Siparişte kalem yok.';
        steps.push('Kalem kontrolü: ATLANDI - sipariş boş');
        await db.collection('emailNotificationLogs').add(logEntry);
        return;
      }

      const [itemInfoMap, labGroupNamesById, users] = await Promise.all([
        buildItemInfoMap(orderItems),
        loadLabGroupNamesByDocId(),
        loadLojistikUsers(),
      ]);
      const itemGroupMap = groupMapFromInfo(itemInfoMap);
      steps.push(`Grup/kullanıcı yüklemesi: OK (kalem grup eşlemesi=${itemGroupMap.size}, def_labGroups=${labGroupNamesById.size}, lojistik kullanıcı=${users.length})`);

      logEntry.orderGroups = Array.from(new Set(Array.from(itemGroupMap.values())));

      // Build per-user filtered recipient list. Depot-origin requests are sent
      // only to the explicitly selected managers and include all request items.
      const selectedEmails = Array.isArray((order as any).requestedManagerEmails)
        ? ((order as any).requestedManagerEmails as unknown[]).map(e => String(e || '').trim().toLowerCase()).filter(Boolean)
        : [];
      const recipients = isDepotRequest && selectedEmails.length > 0
        ? selectedEmails.map((email, index) => ({
            user: { uid: `selected-${index}`, email, name: email, role: 'selected_manager', assignedLabGroups: [] } as any,
            groupNames: new Set<string>(),
            filtered: orderItems,
          }))
        : users.map((user) => {
            const groupNames = resolveUserGroupNames(user, labGroupNamesById);
            const filtered = filterItemsForUserGroups(orderItems, itemGroupMap, groupNames);
            return { user, groupNames, filtered };
          });

      const sendable = recipients.filter((r) => r.user.email && r.filtered.length > 0);
      logEntry.recipients = sendable.map((r) => r.user.email);

      if (sendable.length === 0) {
        logEntry.status = 'skipped';
        logEntry.error = 'Eşleşen grup/kalem yok ya da hiçbir alıcının e-postası tanımlı değil.';
        steps.push('Alıcı sorgusu: BAŞARISIZ - eşleşen lojistik sorumlusu yok');
        await db.collection('emailNotificationLogs').add(logEntry);
        logger.warn(`[peripheralOrderEmail] No matching lojistik_sorumlusu recipients for order ${orderId}.`);
        return;
      }

      steps.push(`Alıcı sorgusu: OK (${sendable.length} alıcı eşleşti)`);

      const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
      const labName = order.kurumAdi || (isDepotRequest ? 'Bilinmeyen Depo' : 'Bilinmeyen Laboratuvar');
      const urgencyKey = (order.urgency && URGENCY_META[order.urgency] ? order.urgency : 'normal') as keyof typeof URGENCY_META;
      const urgencyMeta = URGENCY_META[urgencyKey];
      const noteText = (order.note || '').trim();
      const subjectPrefix =
        urgencyKey === 'cok_acil' ? '[ÇOK ACİL] ' :
        urgencyKey === 'acil'     ? '[ACİL] '     : '';

      const noteHtml = noteText
        ? `<tr><td style="padding:6px 12px; background:#f1f5f9; border:1px solid #94a3b8; vertical-align:top;"><b>Açıklama</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; white-space:pre-wrap;">${noteText.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))}</td></tr>`
        : '';

      const perUserResults: any[] = [];
      logEntry.perUserResults = perUserResults;
      let sentCount = 0;

      for (const r of sendable) {
        const filtered = r.filtered;
        const filteredOrder: OrderDoc = { ...order, items: filtered };
        const filteredItemCount = filtered.length;
        const filteredTotalQty = filtered.reduce((sum, item) => sum + Number(item.adet || 0), 0);
        const groupsForUser = Array.from(r.groupNames);
        const groupsLine = groupsForUser.length ? groupsForUser.join(', ') : '-';

        let excelBuffer: Buffer;
        try {
          excelBuffer = await buildExcelBuffer(orderId, filteredOrder, itemInfoMap);
        } catch (excelErr: any) {
          perUserResults.push({
            uid: r.user.uid,
            email: r.user.email,
            matchedItemCount: filteredItemCount,
            success: false,
            error: `Excel hata: ${excelErr?.message || excelErr}`,
          });
          steps.push(`${r.user.email}: Excel HATA - ${excelErr?.message || excelErr}`);
          continue;
        }

        try {
          await transporter.sendMail({
            from: senderEmail,
            to: r.user.email!,
            subject: `${subjectPrefix}[${isDepotRequest ? 'Depo Talep' : 'Perifer Talep'}] ${labName} — ${filteredTotalQty} adet (${urgencyMeta.label})`,
            text:
              `${isDepotRequest ? 'Depodan' : 'Perifer laboratuvardan'} yeni sipariş talebi açıldı.\n` +
              `Aciliyet: ${urgencyMeta.label}\n` +
              `Sipariş ID: ${orderId}\n` +
              `${isDepotRequest ? 'Depo' : 'Laboratuvar'}: ${labName}\n` +
              `Talep Eden: ${order.createdBy || '-'}\n` +
              `Atanan Grup(lar): ${groupsLine}\n` +
              `Kalem Sayısı: ${filteredItemCount}\n` +
              `Toplam Adet: ${filteredTotalQty}\n` +
              (noteText ? `Açıklama: ${noteText}\n` : '') +
              `\nDetaylar ekteki Excel dosyasındadır.`,
            html: `
              <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a;">
                <h2 style="margin:0 0 8px 0; color:#1e293b;">${isDepotRequest ? 'Depo Ürün Talebi' : 'Perifer Laboratuvar Ürün Talebi'}</h2>
                <div style="display:inline-block; margin:0 0 14px 0; padding:6px 14px; border-radius:999px; background:${urgencyMeta.emailBg}; color:${urgencyMeta.emailText}; border:2px solid ${urgencyMeta.emailBadgeBorder}; font-weight:bold; font-size:13px; letter-spacing:0.5px;">
                  ACİLİYET: ${urgencyMeta.label.toLocaleUpperCase('tr-TR')}
                </div>
                <p style="margin:0 0 12px 0;">${isDepotRequest ? 'Aşağıdaki depodan size iletilen yeni bir ürün talebi açıldı:' : 'Aşağıdaki perifer laboratuvardan size atanan grup(lar)a ait yeni bir ürün talebi açıldı:'}</p>
                <table style="border-collapse:collapse; font-size:14px;">
                  <tr><td style="padding:6px 12px; background:#e0f2fe; border:1px solid #94a3b8;"><b>Sipariş ID</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${orderId}</td></tr>
                  <tr><td style="padding:6px 12px; background:#e0e7ff; border:1px solid #94a3b8;"><b>${isDepotRequest ? 'Depo' : 'Laboratuvar'}</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${labName}</td></tr>
                  <tr><td style="padding:6px 12px; background:#fef3c7; border:1px solid #94a3b8;"><b>Talep Eden</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${order.createdBy || '-'}</td></tr>
                  <tr><td style="padding:6px 12px; background:#ccfbf1; border:1px solid #94a3b8;"><b>Atanan Grup(lar)</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${groupsLine}</td></tr>
                  <tr><td style="padding:6px 12px; background:${urgencyMeta.emailBg}; border:1px solid #94a3b8;"><b>Aciliyet</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; color:${urgencyMeta.emailText}; font-weight:bold;">${urgencyMeta.label}</td></tr>
                  <tr><td style="padding:6px 12px; background:#fee2e2; border:1px solid #94a3b8;"><b>Kalem Sayısı</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${filteredItemCount}</td></tr>
                  <tr><td style="padding:6px 12px; background:#dcfce7; border:1px solid #94a3b8;"><b>Toplam Adet</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; font-weight:bold; font-size:16px;">${filteredTotalQty}</td></tr>
                  ${noteHtml}
                </table>
                <p style="margin:16px 0 0 0;">Sipariş detayları (${isDepotRequest ? 'depo stok' : 'lab stok'}, max adet, talep adedi) ekteki Excel dosyasındadır.</p>
              </div>`,
            attachments: [
              {
                filename: `${isDepotRequest ? 'depo' : 'perifer'}_siparis_${orderId}.xlsx`,
                content: excelBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              },
            ],
          });

          sentCount += 1;
          perUserResults.push({
            uid: r.user.uid,
            email: r.user.email,
            groups: groupsForUser,
            matchedItemCount: filteredItemCount,
            success: true,
          });
          steps.push(`${r.user.email}: OK (${filteredItemCount} kalem, ${groupsLine})`);
        } catch (sendErr: any) {
          perUserResults.push({
            uid: r.user.uid,
            email: r.user.email,
            groups: groupsForUser,
            matchedItemCount: filteredItemCount,
            success: false,
            error: sendErr?.message || String(sendErr),
          });
          steps.push(`${r.user.email}: BAŞARISIZ - ${sendErr?.message || sendErr}`);
        }
      }

      logEntry.status = sentCount > 0 ? 'sent' : 'failed';
      logEntry.sentCount = sentCount;
      await db.collection('emailNotificationLogs').add(logEntry);
      logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${sentCount}/${sendable.length} recipients.`);
    } catch (error: any) {
      logEntry.status = 'failed';
      logEntry.error = error?.message || String(error);
      steps.push(`Beklenmeyen hata: ${error?.message || error}`);
      try {
        await db.collection('emailNotificationLogs').add(logEntry);
      } catch (logErr) {
        logger.error('[peripheralOrderEmail] Could not write failure-log:', logErr);
      }
      logger.error(`[peripheralOrderEmail] Failed for order ${orderId}:`, error);
    }
  });
