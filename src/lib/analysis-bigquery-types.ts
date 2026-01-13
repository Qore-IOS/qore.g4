/**
 * IS-ANALIZI BIGQUERY INTEGRATION TYPES
 *
 * Bu modül, BigQuery entegrasyonu için gerekli tip tanımlarını içerir.
 *
 * MİMARİ:
 * - Ham test verileri BigQuery'de "fact table" olarak tutulacak
 * - Detaylı sorgular (doktor bazlı TAT, spesifik test analizleri) BigQuery'den yapılacak
 * - Summary veriler Firestore'dan, detay veriler BigQuery'den gelecek
 *
 * SCHEMA:
 * Dataset: qore_analytics
 * Table: lab_test_results (partitioned by labAcceptDatePartition)
 */

// ============================================================================
// BIGQUERY RAW RECORD - Ham veri tablosu şeması
// ============================================================================

/**
 * BigQuery'ye yazılacak ham satır verisi
 * Her Excel satırı bu formatta BigQuery'ye yazılır
 */
export interface BigQueryRawRecord {
  // === KİMLİK ALANLARI ===
  rowId: string;                    // Benzersiz satır ID (nanoid)
  uploadBatchId: string;            // Yükleme batch ID
  uploadTimestamp: string;          // Yükleme zamanı (ISO)

  // === HASTA/NUMUNE BİLGİLERİ ===
  hastaId: string;                  // Hasta ID (Excel B sütunu)
  ornekNo: string;                  // Numune numarası (Excel C sütunu)

  // === KURUM BİLGİLERİ ===
  hospitalId: string;               // Hastane kodu (Excel D sütunu)
  hospitalName: string;             // Hastane adı (çözümlenmiş)
  isAsm: boolean;                   // ASM mi? (hospitalId === '999')

  // === TEST BİLGİLERİ ===
  testId: string | null;            // Test ID (Excel F sütunu - varsa)
  testName: string;                 // Test adı (Excel H sütunu)
  service: string;                  // Servis adı (Excel L sütunu)
  branch: string;                   // Branş (Excel M sütunu)

  // === DOKTOR BİLGİLERİ ===
  doctorName: string | null;        // Doktor adı (Excel N sütunu - varsa)

  // === DURUM BAYRAKLARI ===
  isEmergency: boolean;             // Acil mi? (Excel E === 'E')
  isRepeat: boolean;                // Tekrar mı? (Excel O > 0)
  repeatCount: number;              // Tekrar sayısı (Excel O sütunu)
  rejectionReason: string | null;   // Red nedeni (Excel Q sütunu)
  isRejected: boolean;              // Red mi? (rejectionReason !== null)

  // === CİHAZ BİLGİLERİ ===
  deviceNo: string | null;          // Cihaz numarası (Excel P sütunu - varsa)

  // === TARİHLER (ISO FORMAT) ===
  orderDate: string | null;         // İstem tarihi (Excel S sütunu)
  registrationDate: string | null;  // Kayıt tarihi (Excel T sütunu)
  bloodDrawDate: string | null;     // Kan alma tarihi (Excel X sütunu)
  labAcceptDate: string | null;     // Lab kabul tarihi (Excel Y sütunu)
  workDate: string | null;          // Çalışma tarihi (Excel AA sütunu)
  subApprovalDate: string | null;   // Alt onay tarihi (Excel AB sütunu)
  approvalDate: string | null;      // Onay tarihi (Excel AC sütunu)

  // === HESAPLANAN ALANLAR ===
  tatMinutes: number | null;        // TAT (labAccept -> work arası dakika)
  approvalTatMinutes: number | null;// Onay TAT (labAccept -> approval arası dakika)

  // === PARTITION ALANLARI ===
  labAcceptDatePartition: string;   // "YYYY-MM-DD" - BigQuery partition key

  // === EK BİLGİLER ===
  autoApproved: boolean | null;     // Otomatik onaylı mı? (Excel AD sütunu)
  material: string | null;          // Materyal (Excel AE sütunu - varsa)
  tubeType: string | null;          // Tüp türü (varsa)
}

// ============================================================================
// BIGQUERY QUERY TYPES - Sorgu parametreleri
// ============================================================================

/**
 * Temel sorgu parametreleri
 */
export interface BigQueryBaseQueryParams {
  startDate: string;                // "YYYY-MM-DD"
  endDate: string;                  // "YYYY-MM-DD"
}

/**
 * Filtreli sorgu parametreleri
 */
export interface BigQueryFilteredQueryParams extends BigQueryBaseQueryParams {
  hospitals?: string[];
  asms?: string[];
  services?: string[];
  tests?: string[];
  branches?: string[];
  doctors?: string[];
  devices?: string[];
}

/**
 * TAT analiz sorgusu parametreleri
 */
export interface BigQueryTATQueryParams extends BigQueryFilteredQueryParams {
  minTatMinutes?: number;
  maxTatMinutes?: number;
  tatType?: 'work' | 'approval';    // Hangi TAT? (work veya approval)
}

/**
 * Red analiz sorgusu parametreleri
 */
export interface BigQueryRejectionQueryParams extends BigQueryFilteredQueryParams {
  rejectionReasons?: string[];
  onlyRejected?: boolean;
}

/**
 * Tekrar analiz sorgusu parametreleri
 */
export interface BigQueryRepeatQueryParams extends BigQueryFilteredQueryParams {
  minRepeatCount?: number;
  onlyRepeats?: boolean;
}

// ============================================================================
// BIGQUERY RESULT TYPES - Sorgu sonuçları
// ============================================================================

/**
 * Doktor bazlı TAT analiz sonucu
 */
export interface DoctorTATResult {
  doctorName: string;
  testName: string;
  totalTests: number;
  avgTatMinutes: number;
  minTatMinutes: number;
  maxTatMinutes: number;
  medianTatMinutes: number;
  p90TatMinutes: number;            // 90. percentile
  p95TatMinutes: number;            // 95. percentile
}

/**
 * Cihaz bazlı analiz sonucu
 */
export interface DeviceAnalysisResult {
  deviceNo: string;
  testName: string;
  totalTests: number;
  avgTatMinutes: number;
  rejectionRate: number;
  repeatRate: number;
}

/**
 * Zaman bazlı trend analizi sonucu
 */
export interface TimeSeriesResult {
  date: string;                     // "YYYY-MM-DD"
  hour?: number;                    // 0-23 (saatlik analiz için)
  totalTests: number;
  emergencyCount: number;
  rejectedCount: number;
  avgTatMinutes: number;
}

/**
 * Red nedeni detay analizi sonucu
 */
export interface RejectionDetailResult {
  rejectionReason: string;
  testName: string;
  service: string;
  hospitalName: string;
  totalCount: number;
  percentOfTotal: number;
}

/**
 * Genel agregasyon sonucu
 */
export interface AggregationResult {
  groupBy: string;                  // Gruplanan alan adı
  groupValue: string;               // Grup değeri
  totalTests: number;
  emergencyCount: number;
  rejectedCount: number;
  repeatCount: number;
  avgTatMinutes: number;
  uniquePatients: number;
}

// ============================================================================
// BIGQUERY QUERY BUILDERS - SQL sorgu şablonları
// ============================================================================

/**
 * Doktor bazlı TAT sorgusu oluşturur
 */
export function buildDoctorTATQuery(params: BigQueryTATQueryParams): string {
  const tatField = params.tatType === 'approval' ? 'approvalTatMinutes' : 'tatMinutes';

  return `
    SELECT
      doctorName,
      testName,
      COUNT(*) as totalTests,
      AVG(${tatField}) as avgTatMinutes,
      MIN(${tatField}) as minTatMinutes,
      MAX(${tatField}) as maxTatMinutes,
      APPROX_QUANTILES(${tatField}, 100)[OFFSET(50)] as medianTatMinutes,
      APPROX_QUANTILES(${tatField}, 100)[OFFSET(90)] as p90TatMinutes,
      APPROX_QUANTILES(${tatField}, 100)[OFFSET(95)] as p95TatMinutes
    FROM \`qore_analytics.lab_test_results\`
    WHERE
      labAcceptDatePartition BETWEEN '${params.startDate}' AND '${params.endDate}'
      AND doctorName IS NOT NULL
      AND ${tatField} IS NOT NULL
      ${params.tests?.length ? `AND testName IN (${params.tests.map(t => `'${t}'`).join(',')})` : ''}
      ${params.hospitals?.length ? `AND hospitalName IN (${params.hospitals.map(h => `'${h}'`).join(',')})` : ''}
      ${params.minTatMinutes ? `AND ${tatField} >= ${params.minTatMinutes}` : ''}
      ${params.maxTatMinutes ? `AND ${tatField} <= ${params.maxTatMinutes}` : ''}
    GROUP BY doctorName, testName
    ORDER BY avgTatMinutes DESC
    LIMIT 100
  `;
}

/**
 * Zaman serisi sorgusu oluşturur
 */
export function buildTimeSeriesQuery(params: BigQueryFilteredQueryParams, granularity: 'daily' | 'hourly' = 'daily'): string {
  const dateExpr = granularity === 'hourly'
    ? `DATE(labAcceptDate) as date, EXTRACT(HOUR FROM labAcceptDate) as hour`
    : `labAcceptDatePartition as date`;

  const groupBy = granularity === 'hourly' ? 'date, hour' : 'date';

  return `
    SELECT
      ${dateExpr},
      COUNT(*) as totalTests,
      COUNTIF(isEmergency) as emergencyCount,
      COUNTIF(isRejected) as rejectedCount,
      AVG(tatMinutes) as avgTatMinutes
    FROM \`qore_analytics.lab_test_results\`
    WHERE
      labAcceptDatePartition BETWEEN '${params.startDate}' AND '${params.endDate}'
      ${params.tests?.length ? `AND testName IN (${params.tests.map(t => `'${t}'`).join(',')})` : ''}
      ${params.hospitals?.length ? `AND hospitalName IN (${params.hospitals.map(h => `'${h}'`).join(',')})` : ''}
      ${params.services?.length ? `AND service IN (${params.services.map(s => `'${s}'`).join(',')})` : ''}
    GROUP BY ${groupBy}
    ORDER BY ${groupBy}
  `;
}

/**
 * Red analizi sorgusu oluşturur
 */
export function buildRejectionAnalysisQuery(params: BigQueryRejectionQueryParams): string {
  return `
    SELECT
      rejectionReason,
      testName,
      service,
      hospitalName,
      COUNT(*) as totalCount,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentOfTotal
    FROM \`qore_analytics.lab_test_results\`
    WHERE
      labAcceptDatePartition BETWEEN '${params.startDate}' AND '${params.endDate}'
      AND isRejected = TRUE
      ${params.rejectionReasons?.length ? `AND rejectionReason IN (${params.rejectionReasons.map(r => `'${r}'`).join(',')})` : ''}
      ${params.tests?.length ? `AND testName IN (${params.tests.map(t => `'${t}'`).join(',')})` : ''}
      ${params.hospitals?.length ? `AND hospitalName IN (${params.hospitals.map(h => `'${h}'`).join(',')})` : ''}
    GROUP BY rejectionReason, testName, service, hospitalName
    ORDER BY totalCount DESC
    LIMIT 200
  `;
}

/**
 * Genel agregasyon sorgusu oluşturur
 */
export function buildAggregationQuery(
  params: BigQueryFilteredQueryParams,
  groupByField: 'testName' | 'service' | 'hospitalName' | 'branch' | 'doctorName'
): string {
  return `
    SELECT
      '${groupByField}' as groupBy,
      ${groupByField} as groupValue,
      COUNT(*) as totalTests,
      COUNTIF(isEmergency) as emergencyCount,
      COUNTIF(isRejected) as rejectedCount,
      SUM(CASE WHEN repeatCount > 0 THEN 1 ELSE 0 END) as repeatCount,
      AVG(tatMinutes) as avgTatMinutes,
      COUNT(DISTINCT hastaId) as uniquePatients
    FROM \`qore_analytics.lab_test_results\`
    WHERE
      labAcceptDatePartition BETWEEN '${params.startDate}' AND '${params.endDate}'
      AND ${groupByField} IS NOT NULL
      ${params.tests?.length ? `AND testName IN (${params.tests.map(t => `'${t}'`).join(',')})` : ''}
      ${params.hospitals?.length ? `AND hospitalName IN (${params.hospitals.map(h => `'${h}'`).join(',')})` : ''}
      ${params.services?.length ? `AND service IN (${params.services.map(s => `'${s}'`).join(',')})` : ''}
      ${params.branches?.length ? `AND branch IN (${params.branches.map(b => `'${b}'`).join(',')})` : ''}
    GROUP BY ${groupByField}
    ORDER BY totalTests DESC
    LIMIT 100
  `;
}

// ============================================================================
// BIGQUERY TABLE SCHEMA - Tablo şema tanımı
// ============================================================================

/**
 * BigQuery tablo şeması (CREATE TABLE için)
 */
export const BIGQUERY_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS \`qore_analytics.lab_test_results\`
(
  rowId STRING NOT NULL,
  uploadBatchId STRING NOT NULL,
  uploadTimestamp TIMESTAMP NOT NULL,

  hastaId STRING NOT NULL,
  ornekNo STRING,

  hospitalId STRING NOT NULL,
  hospitalName STRING NOT NULL,
  isAsm BOOL NOT NULL,

  testId STRING,
  testName STRING NOT NULL,
  service STRING NOT NULL,
  branch STRING,

  doctorName STRING,

  isEmergency BOOL NOT NULL,
  isRepeat BOOL NOT NULL,
  repeatCount INT64 NOT NULL,
  rejectionReason STRING,
  isRejected BOOL NOT NULL,

  deviceNo STRING,

  orderDate TIMESTAMP,
  registrationDate TIMESTAMP,
  bloodDrawDate TIMESTAMP,
  labAcceptDate TIMESTAMP NOT NULL,
  workDate TIMESTAMP,
  subApprovalDate TIMESTAMP,
  approvalDate TIMESTAMP,

  tatMinutes FLOAT64,
  approvalTatMinutes FLOAT64,

  labAcceptDatePartition DATE NOT NULL,

  autoApproved BOOL,
  material STRING,
  tubeType STRING
)
PARTITION BY labAcceptDatePartition
CLUSTER BY hospitalName, testName, service
OPTIONS(
  description = 'Laboratuvar test sonuçları ham veri tablosu',
  require_partition_filter = TRUE
);
`;

// ============================================================================
// DATA CONVERSION UTILITIES
// ============================================================================

/**
 * Excel satırını BigQuery record'a dönüştürür
 */
export function excelRowToBigQueryRecord(
  row: any[],
  uploadBatchId: string,
  hospitalDefinitions: Record<string, string>
): BigQueryRawRecord | null {
  if (!row || row.length < 12) return null;

  const rawHospitalId = row[3];
  if (!rawHospitalId) return null;

  const rawLabAcceptDate = row[24];
  if (!rawLabAcceptDate) return null;

  const parseDate = (input: any): string | null => {
    if (!input) return null;
    if (typeof input === 'number') {
      return new Date(Math.round((input - 25569) * 86400 * 1000)).toISOString();
    }
    const d = new Date(String(input).trim());
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const labAcceptDate = parseDate(rawLabAcceptDate);
  if (!labAcceptDate) return null;

  const hospitalId = String(rawHospitalId).trim();
  const isAsm = hospitalId === '999';
  const hospitalName = isAsm
    ? String(row[11] || 'Bilinmeyen ASM').toUpperCase().trim()
    : hospitalDefinitions[hospitalId] || `Hastane (${hospitalId})`;

  const workDate = parseDate(row[26]);
  const approvalDate = parseDate(row[28]);

  const labAcceptTime = new Date(labAcceptDate).getTime();
  const workTime = workDate ? new Date(workDate).getTime() : null;
  const approvalTime = approvalDate ? new Date(approvalDate).getTime() : null;

  const tatMinutes = workTime ? (workTime - labAcceptTime) / (1000 * 60) : null;
  const approvalTatMinutes = approvalTime ? (approvalTime - labAcceptTime) / (1000 * 60) : null;

  const rejectionReason = String(row[16] || '').trim() || null;

  return {
    rowId: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    uploadBatchId,
    uploadTimestamp: new Date().toISOString(),

    hastaId: String(row[1] || ''),
    ornekNo: String(row[2] || ''),

    hospitalId,
    hospitalName,
    isAsm,

    testId: row[6] ? String(row[6]) : null,
    testName: String(row[7] || 'BELİRTİLMEMİŞ').toUpperCase().trim(),
    service: String(row[11] || 'BELİRTİLMEMİŞ').toUpperCase().trim(),
    branch: String(row[12] || '').toUpperCase().trim() || null,

    doctorName: row[13] ? String(row[13]).trim() : null,

    isEmergency: String(row[4] || '').toUpperCase() === 'E',
    isRepeat: Number(row[14] || 0) > 0,
    repeatCount: Number(row[14] || 0),
    rejectionReason,
    isRejected: rejectionReason !== null,

    deviceNo: row[15] ? String(row[15]) : null,

    orderDate: parseDate(row[18]),
    registrationDate: parseDate(row[19]),
    bloodDrawDate: parseDate(row[23]),
    labAcceptDate,
    workDate,
    subApprovalDate: parseDate(row[27]),
    approvalDate,

    tatMinutes,
    approvalTatMinutes,

    labAcceptDatePartition: labAcceptDate.split('T')[0],

    autoApproved: row[29] ? String(row[29]).toUpperCase() === 'E' : null,
    material: row[30] ? String(row[30]).trim() : null,
    tubeType: row[41] ? String(row[41]).trim() : null
  };
}

// ============================================================================
// BIGQUERY SERVICE INTERFACE
// ============================================================================

/**
 * BigQuery servis arayüzü
 * Implementasyon Cloud Function veya Next.js API route'da yapılacak
 */
export interface BigQueryService {
  /**
   * Ham verileri BigQuery'ye yükler
   */
  uploadRawRecords(records: BigQueryRawRecord[]): Promise<{ success: boolean; insertedCount: number }>;

  /**
   * Doktor bazlı TAT analizi yapar
   */
  queryDoctorTAT(params: BigQueryTATQueryParams): Promise<DoctorTATResult[]>;

  /**
   * Zaman serisi analizi yapar
   */
  queryTimeSeries(params: BigQueryFilteredQueryParams, granularity?: 'daily' | 'hourly'): Promise<TimeSeriesResult[]>;

  /**
   * Red analizi yapar
   */
  queryRejections(params: BigQueryRejectionQueryParams): Promise<RejectionDetailResult[]>;

  /**
   * Genel agregasyon sorgusu yapar
   */
  queryAggregation(
    params: BigQueryFilteredQueryParams,
    groupBy: 'testName' | 'service' | 'hospitalName' | 'branch' | 'doctorName'
  ): Promise<AggregationResult[]>;
}
