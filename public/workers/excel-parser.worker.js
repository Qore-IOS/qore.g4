/**
 * Excel Parser Web Worker
 *
 * Handles large Excel file parsing in a separate thread to prevent UI blocking.
 * Supports streaming progress updates for files with 150K+ rows.
 */

// Import XLSX library via CDN (self-contained worker)
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

/**
 * Column index mapping for LBYS Excel format
 */
const COLUMN_MAP = {
  HASTA_ID: 1,       // B - Patient ID
  ORNEKNO: 2,        // C - Sample number
  HASTANE_ID: 3,     // D - Hospital ID (999 = ASM)
  ACIL: 4,           // E - Emergency flag
  TEST_ADI: 7,       // H - Test name
  SERVIS_POL_ADI: 11, // L - Service/Polyclinic name
  DOKTOR_BRANS: 12,  // M - Doctor branch
  TEKRAR_SAYISI: 14, // O - Repeat count
  RET_NEDENI: 16,    // Q - Rejection reason
  LABKABUL_TARIHI: 24, // Y - Lab accept date
  CALISMA_TARIHI: 26,  // AA - Work date
  ONAYTARIH: 28        // AC - Approval date
};

/**
 * Parse Excel date (handles both serial numbers and date strings)
 */
function parseExcelDate(input) {
  if (!input) return null;
  if (typeof input === 'number') {
    return new Date(Math.round((input - 25569) * 86400 * 1000));
  }
  const str = String(input).trim().replace(' ', 'T');
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize string (Turkish uppercase)
 */
function normalize(str) {
  if (!str) return "BELİRTİLMEMİŞ";
  return String(str).toLocaleUpperCase('tr-TR').trim();
}

/**
 * Process Excel file and return parsed data
 */
function processExcelFile(buffer, existingDates = []) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const worksheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[worksheetName];

  // Get range
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const totalRows = range.e.r;

  // Existing dates set for incremental check
  const existingDatesSet = new Set(existingDates);

  // Progress tracking
  let processedRows = 0;
  const PROGRESS_INTERVAL = 5000;

  // Aggregation groups
  const groups = new Map();

  // Statistics
  let skippedCount = 0;
  let skippedDuplicateDates = 0;
  let labAcceptedCount = 0;
  let workedCount = 0;
  let approvedCount = 0;
  let newDates = new Set();

  // Process rows (skip header)
  for (let R = 1; R <= totalRows; ++R) {
    // Read row data
    const row = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
      const cell = worksheet[cellAddress];
      row.push(cell ? cell.v : null);
    }

    // Skip invalid rows
    if (!row || row.length < 12) {
      skippedCount++;
      continue;
    }

    // Hospital ID check
    const rawHospitalId = row[COLUMN_MAP.HASTANE_ID];
    if (!rawHospitalId) {
      skippedCount++;
      continue;
    }

    // Date parsing
    const rawLabAcceptDate = row[COLUMN_MAP.LABKABUL_TARIHI];
    if (!rawLabAcceptDate) {
      skippedCount++;
      continue;
    }

    const labAcceptDate = parseExcelDate(rawLabAcceptDate);
    if (!labAcceptDate) {
      skippedCount++;
      continue;
    }

    const dateStr = formatDate(labAcceptDate);

    // Incremental check: Skip if date already exists
    if (existingDatesSet.has(dateStr)) {
      skippedDuplicateDates++;
      continue;
    }

    newDates.add(dateStr);

    const workDate = parseExcelDate(row[COLUMN_MAP.CALISMA_TARIHI]);
    const approveDate = parseExcelDate(row[COLUMN_MAP.ONAYTARIH]);

    // Extract data
    const hospitalId = String(rawHospitalId).trim();
    const isAsm = hospitalId === '999';
    const testName = normalize(row[COLUMN_MAP.TEST_ADI]);
    const serviceName = normalize(row[COLUMN_MAP.SERVIS_POL_ADI]);
    const branchName = normalize(row[COLUMN_MAP.DOKTOR_BRANS]);
    const patientId = String(row[COLUMN_MAP.HASTA_ID] || `temp-${R}`);
    const isEmergency = String(row[COLUMN_MAP.ACIL] || '').toUpperCase() === 'E';
    const isRepeat = Number(row[COLUMN_MAP.TEKRAR_SAYISI] || 0) > 0;
    const rejectionReason = String(row[COLUMN_MAP.RET_NEDENI] || '').trim();

    // TAT calculation (lab accept to work time in minutes)
    const tatMin = workDate ? (workDate.getTime() - labAcceptDate.getTime()) / (1000 * 60) : 0;

    // Group key
    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;

    if (!groups.has(key)) {
      groups.set(key, {
        date: dateStr,
        hospitalId,
        isAsm,
        service: serviceName,
        testName,
        branch: branchName,
        labAccepted: createEmptyStageStats(),
        worked: createEmptyStageStats(),
        approved: createEmptyStageStats()
      });
    }

    const record = groups.get(key);

    // Lab Accepted stage (always)
    record.labAccepted.totalTests++;
    labAcceptedCount++;
    if (isEmergency) record.labAccepted.emergencyCount++;
    record.labAccepted.patientIds.add(patientId);
    if (isRepeat) record.labAccepted.repeatCount++;
    if (rejectionReason) {
      record.labAccepted.rejectedCount++;
      record.labAccepted.rejectionReasons[rejectionReason] =
        (record.labAccepted.rejectionReasons[rejectionReason] || 0) + 1;
    }

    // Worked stage
    if (workDate) {
      record.worked.totalTests++;
      workedCount++;
      if (isEmergency) record.worked.emergencyCount++;
      record.worked.patientIds.add(patientId);
      if (isRepeat) record.worked.repeatCount++;
      if (rejectionReason) {
        record.worked.rejectedCount++;
        record.worked.rejectionReasons[rejectionReason] =
          (record.worked.rejectionReasons[rejectionReason] || 0) + 1;
      }
      if (tatMin > 0) {
        record.worked.totalTatMinutes += tatMin;
        record.worked.tatCount++;
      }
    }

    // Approved stage
    if (workDate && approveDate) {
      record.approved.totalTests++;
      approvedCount++;
      if (isEmergency) record.approved.emergencyCount++;
      record.approved.patientIds.add(patientId);
      if (isRepeat) record.approved.repeatCount++;
      if (rejectionReason) {
        record.approved.rejectedCount++;
        record.approved.rejectionReasons[rejectionReason] =
          (record.approved.rejectionReasons[rejectionReason] || 0) + 1;
      }
      if (tatMin > 0) {
        record.approved.totalTatMinutes += tatMin;
        record.approved.tatCount++;
      }
    }

    processedRows++;

    // Send progress update
    if (processedRows % PROGRESS_INTERVAL === 0) {
      self.postMessage({
        type: 'progress',
        current: R,
        total: totalRows,
        status: 'Excel dosyası işleniyor...'
      });
    }
  }

  // Convert Sets to Arrays and generate document IDs
  const records = Array.from(groups.values()).map(g => {
    const docId = `${g.date}|${g.hospitalId}|${g.service}|${g.testName}|${g.branch}`
      .replace(/\|/g, '_')
      .replace(/[^a-zA-Z0-9_\u00C0-\u024F]/g, '')
      .substring(0, 150);

    return {
      id: docId,
      date: g.date,
      hospitalId: g.hospitalId,
      isAsm: g.isAsm,
      service: g.service,
      testName: g.testName,
      branch: g.branch,
      labAccepted: {
        ...g.labAccepted,
        patientIds: Array.from(g.labAccepted.patientIds)
      },
      worked: {
        ...g.worked,
        patientIds: Array.from(g.worked.patientIds)
      },
      approved: {
        ...g.approved,
        patientIds: Array.from(g.approved.patientIds)
      }
    };
  });

  return {
    records,
    stats: {
      totalRows,
      processedRows,
      skippedCount,
      skippedDuplicateDates,
      labAcceptedCount,
      workedCount,
      approvedCount,
      uniqueGroups: groups.size,
      newDates: Array.from(newDates)
    }
  };
}

/**
 * Create empty stage statistics object
 */
function createEmptyStageStats() {
  return {
    totalTests: 0,
    emergencyCount: 0,
    patientIds: new Set(),
    rejectedCount: 0,
    repeatCount: 0,
    totalTatMinutes: 0,
    tatCount: 0,
    rejectionReasons: {}
  };
}

/**
 * Message handler
 */
self.onmessage = function(e) {
  const { type, buffer, existingDates } = e.data;

  if (type === 'parse') {
    try {
      self.postMessage({
        type: 'progress',
        current: 0,
        total: 100,
        status: 'Excel dosyası okunuyor...'
      });

      const result = processExcelFile(buffer, existingDates || []);

      self.postMessage({
        type: 'complete',
        data: result.records,
        stats: result.stats
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message || 'Excel işleme hatası'
      });
    }
  }
};
