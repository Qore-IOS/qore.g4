/**
 * @fileoverview TypeScript type definitions for Verimlilik (Efficiency) modules
 * @description Comprehensive type definitions for efficiency calculation, statistics,
 * history management, and related operations in the medical inventory system.
 * @module lib/verimlilik/types
 * @version 1.0.0
 */

// =============================================================================
// BASIC TYPES
// =============================================================================

/**
 * Supported currencies for cost calculations
 */
export type CostCurrency = 'TRY' | 'USD' | 'EUR';

/**
 * Sort direction for table columns
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Column 22 display mode (box loss calculation basis)
 */
export type Column22Mode = 'kumulatif' | 'hakedis';

/**
 * Sort configuration for efficiency tables
 */
export interface SortConfig {
  /** Column being sorted */
  column: 'stokDogrulukFark' | 'kitVerimlilikFark' | null;
  /** Sort direction */
  direction: SortDirection;
}

// =============================================================================
// EFFICIENCY CALCULATION TYPES
// =============================================================================

/**
 * Efficiency calculation row data
 * Contains all fields needed for efficiency analysis
 */
export interface EfficiencyRow {
  /** Unique row identifier */
  productId: string;
  /** Product display name */
  productName: string;
  /** Tests per package */
  packageTests: number;
  /** Package size (typically 1) */
  packageSize?: number;
  /** Period consumption in tests */
  consumption: number;
  /** Carry-over from previous period (device on-hand) */
  carryOverPrev: number;
  /** Cumulative total from reports */
  total: number;
  /** Rerun tests count */
  rerun: number;
  /** Routine tests count */
  routine: number;
  /** Control tests count */
  control: number;
  /** Calibration tests count */
  calib: number;
  /** End-of-month device on-hand */
  eomDeviceOn: number;
  /** Known loss (control + calibration + rerun) */
  knownLoss: number;
  /** Unknown loss (calculated) */
  unknownLoss: number;
  /** Unknown loss in boxes */
  unknownLossBoxes: number;
  /** Device efficiency percentage */
  deviceEffPct: number;
  /** Kit efficiency percentage */
  kitEffPct: number;
}

/**
 * Extended efficiency row with additional fields for statistics
 */
export interface ExtendedEfficiencyRow extends EfficiencyRow {
  /** Main consumption in tests (calculated) */
  anaTuketimTestAdeti?: number;
  /** Total waste (calculated) */
  toplamFire?: number;
}

/**
 * Efficiency history record stored in Firestore
 */
export interface EfficiencyHistoryRecord {
  /** Firestore document ID */
  id: string;
  /** Hospital/Laboratory ID */
  hospitalId: string;
  /** Hospital/Laboratory display name */
  hospitalName: string;
  /** Month (0-11) */
  month: number;
  /** Year (e.g., 2024) */
  year: number;
  /** Last update timestamp */
  lastUpdated?: Date;
  /** Efficiency rows data */
  rows: EfficiencyRow[];
}

// =============================================================================
// STATISTICS TYPES
// =============================================================================

/**
 * Period-based efficiency data for statistics
 */
export interface PeriodEfficiencyData {
  /** Laboratory ID */
  labId: string;
  /** Laboratory display name */
  labName: string;
  /** Weighted efficiency percentage */
  efficiency: number;
  /** Total waste in tests */
  totalWaste: number;
  /** Total calibration and control tests */
  totalCalibControl: number;
  /** Total test volume */
  totalTestHacmi: number;
  /** Product-level efficiency data */
  products: EfficiencyRow[];
}

/**
 * Product waste information
 */
export interface ProductWasteInfo {
  /** Product name */
  name: string;
  /** Waste amount */
  waste: number;
  /** Laboratory name where waste occurred */
  labName: string;
}

/**
 * Control/Calibration ratio data
 */
export interface ControlCalibRatioData {
  /** Product name */
  name: string;
  /** Ratio of control+calibration to total */
  ratio: number;
}

/**
 * Laboratory trend data point
 */
export interface LabTrendDataPoint {
  /** Month-Year label (e.g., "Oca 24") */
  name: string;
  /** Efficiency value or null if no data */
  Verimlilik: number | null;
}

/**
 * Laboratory deviation statistics
 */
export interface LabDeviationData {
  /** Laboratory name */
  name: string;
  /** Standard deviation of efficiency */
  stdDev: number;
}

// =============================================================================
// TOTAL EFFICIENCY TYPES
// =============================================================================

/**
 * Efficiency metrics summary
 */
export interface EfficiencyMetrics {
  /** Total cumulative tests */
  toplamKumulatif: number;
  /** Total expected consumption */
  toplamBeklenenTuketim: number;
  /** Total earned amount (hak ediş) */
  toplamHakEdis: number;
  /** Stock deviation percentage */
  stokSapmaYuzde: number;
  /** Kit deviation percentage */
  kitSapmaYuzde: number;
  /** Stock accuracy score (0-100) */
  stokDogrulukSkoru: number;
  /** Kit efficiency score (0-100) */
  kitVerimlilikSkoru: number;
  /** Overall efficiency score (0-100) */
  genelVerimlilik: number;
  /** Total impact value used by the value-impact efficiency index */
  toplamEtkiDegeri: number;
  /** Whether all calculable rows were weighted by product cost × cumulative volume */
  maliyetAgirlikli: boolean;
  /** Number of rows included in the weighted efficiency calculation */
  hesaplananSatirSayisi: number;
  /** Efficiency algorithm identifier */
  algoritma: 'value-impact-efficiency-index';
}

/**
 * Total efficiency table row data
 */
export interface TotalEfficiencyTableRow {
  /** Unique row identifier (labId-stokKodu) */
  id: string;
  /** Laboratory ID */
  labId: string;
  /** Laboratory display name */
  labName: string;
  /** Laboratory code */
  labKod: string;
  /** Stock code */
  stokKodu: string;
  /** Stock/Product name */
  stokAdi: string;
  /** Test name */
  testAdi: string;
  /** Package size (tests per package) */
  ambalajDegeri: number;
  /** Device group */
  cihazGrubu: string;

  // Column 7-8: Manual input fields
  /** Beginning stock in boxes (Column 7) */
  baslangicStokuKutu: number;
  /** Beginning of month device on-hand in tests (Column 8) */
  ayBasiCihazUstuTest: number;

  // Column 9: Calculated field
  /** Total beginning stock in tests (Column 9) */
  totalAyBasiStok: number;

  // Columns 10-14: Shipment fields
  /** Beginning shipment in boxes (Column 10) */
  ayBasiSevkiyatKutu: number;
  /** Göztepe shipment in boxes (Column 11) */
  goztepeSevkiyat: number;
  /** Inter-institutional transfer in boxes (Column 12) */
  kurumlarArasiSevk: number;
  /** Source lab ID for inter-institutional transfer */
  kurumlarArasiSevkKaynakLabId?: string;
  /** Logistics intermediate transfer in boxes (Column 13) */
  lojistikAraTransfer: number;
  /** Total tests after shipments (Column 14 - calculated) */
  sevkiyatlarSonrasiTotalTest: number;

  // Columns 15-19: Period end fields
  /** Cumulative total tests (Column 15) */
  kumulatifTotal: number;
  /** Period end stock in boxes (Column 16) */
  donemSonuStokKutu: number;
  /** Period end device on-hand in tests (Column 17) */
  donemSonuCihazUstuTest: number;
  /** Period end total tests (Column 18 - calculated) */
  donemSonuToplamTest: number;
  /** Earned amount in tests (Column 19 - Hak Ediş) */
  hakEdis: number;

  // Columns 20-21: Accuracy and efficiency
  /** Stock accuracy difference in tests (Column 20) */
  stokDogrulukFark: number;
  /** Stock accuracy deviation percentage (Column 20) */
  stokDogrulukYuzde: number;
  /** Kit efficiency difference in tests (Column 21) */
  kitVerimlilikFark: number;
  /** Kit efficiency deviation percentage (Column 21) */
  kitVerimlilikYuzde: number;
}

/**
 * Total efficiency record stored in Firestore
 */
export interface TotalEfficiencyRecord {
  /** Firestore document ID */
  id: string;
  /** Efficiency pool ID */
  poolId: string;
  /** Efficiency pool display name */
  poolName: string;
  /** Month (0-11) */
  month: number;
  /** Year (e.g., 2024) */
  year: number;
  /** Table rows data */
  rows: TotalEfficiencyTableRow[];
  /** Creation timestamp */
  createdAt: { seconds: number; nanoseconds: number } | null;
  /** Creator's display name */
  createdByName: string;
  /** Efficiency metrics summary */
  efficiencyMetrics?: EfficiencyMetrics;
}

/**
 * Total efficiency record summary (for list view)
 */
export interface TotalEfficiencyRecordSummary {
  /** Firestore document ID */
  id: string;
  /** Efficiency pool ID */
  poolId: string;
  /** Efficiency pool display name */
  poolName: string;
  /** Month (0-11) */
  month: number;
  /** Year (e.g., 2024) */
  year: number;
  /** Creation timestamp */
  createdAt: { seconds: number; nanoseconds: number } | null;
  /** Creator's display name */
  createdByName: string;
  /** Number of rows in the record */
  rowCount: number;
  /** Efficiency metrics summary */
  efficiencyMetrics?: EfficiencyMetrics;
}

// =============================================================================
// HAK EDİŞ (EARNED AMOUNT) TYPES
// =============================================================================

/**
 * Hak Ediş (Earned Amount) definition
 */
export interface HakEdisDefinition {
  /** Definition ID */
  id: string;
  /** SUT (Health Implementation Notification) code */
  sutKodu: string;
  /** SUT test name */
  sutTestAdi: string;
  /** Linked stock code */
  linkedStokKodu: string;
  /** Earned amount in TRY */
  hakEdisMiktari: number;
}

// =============================================================================
// INTER-LAB TRANSFER TYPES
// =============================================================================

/**
 * Inter-laboratory transfer information
 */
export interface InterLabTransfer {
  /** Source laboratory ID */
  sourceLabId: string;
  /** Source laboratory display name */
  sourceLabName: string;
  /** Number of boxes transferred */
  kutuAdet: number;
}

/**
 * Map of inter-laboratory transfers
 * Key: targetRowId, Value: transfer information
 */
export type InterLabTransferMap = Record<string, InterLabTransfer>;

// =============================================================================
// COST TYPES
// =============================================================================

/**
 * Cost checkpoint data
 */
export interface CostCheckpoint {
  /** Checkpoint ID */
  id: string;
  /** Year */
  year: number;
  /** Month (0-11) */
  month: number;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Product cost information
 */
export interface ProductCost {
  /** Cost value */
  cost: number;
  /** Currency */
  currency: CostCurrency;
}

/**
 * Cost checkpoint data map
 * Key: stock code, Value: cost information
 */
export type CostCheckpointDataMap = Record<string, ProductCost>;

/**
 * Exchange rates for currency conversion
 */
export interface ExchangeRates {
  /** EUR rate (base = 1) */
  EUR: number;
  /** USD rate */
  USD: number;
  /** TRY rate */
  TRY: number;
}

// =============================================================================
// FILTER AND SORT TYPES
// =============================================================================

/**
 * Column filter configuration
 */
export interface ColumnFilters {
  /** Laboratory name filter */
  labName: Set<string>;
  /** Product name filter */
  stokAdi: Set<string>;
  /** Test name filter */
  testAdi: Set<string>;
  /** Device group filter */
  cihazGrubu: Set<string>;
}

// =============================================================================
// PANEL PROPS TYPES
// =============================================================================

/**
 * Hospital/Laboratory basic info
 */
export interface Hospital {
  /** Hospital ID */
  id: string;
  /** Hospital display name */
  name: string;
}

/**
 * VerimlilikHesaplamaPanel component props
 */
export interface VerimlilikHesaplamaPanelProps {
  /** List of hospitals */
  hospitals: Hospital[];
  /** List of product codes */
  productCodes: ProductCode[];
  /** Recent consumption records */
  tuketimKayitlari: ConsumptionRecord[];
  /** Device on-hand history */
  cihazUstuGecmisi: CihazUstuRecord[];
  /** Cumulative reports */
  kumulatifRaporlar: KumulatifRapor[];
  /** Lab pools for shared stock management */
  labPools?: LabPool[];
  /** Min-max rules by hospital ID */
  allMinMaxRules?: Record<string, MinMaxRule[]>;
}

/**
 * VerimlilikIstatistikleriPanel component props
 */
export interface VerimlilikIstatistikleriPanelProps {
  /** List of hospitals */
  hospitals: Hospital[];
  /** Efficiency history records */
  efficiencyHistoryRecords: EfficiencyHistoryRecord[];
}

/**
 * TotalVerimlilikPanel component props
 */
export interface TotalVerimlilikPanelProps {
  /** List of hospitals */
  hospitals: Hospital[];
  /** List of product codes */
  productCodes: ProductCode[];
}

/**
 * TotalVerimlilikGecmisDetayPanel component props
 */
export interface TotalVerimlilikGecmisDetayPanelProps {
  /** Record ID to display */
  recordId: string;
}

// =============================================================================
// SUPPORTING TYPES (from main types)
// =============================================================================

/**
 * Product code information
 */
export interface ProductCode {
  /** Stock code */
  stokKodu: string;
  /** Stock/Product name */
  stokAdi?: string;
  /** Package size (tests per package) */
  ambalajDegeri?: number;
  /** Base unit */
  anaBirim?: string;
  /** Product group */
  urunGrubu?: string;
}

/**
 * Consumption record
 */
export interface ConsumptionRecord {
  /** Stock code */
  stokKodu: string;
  /** Laboratory ID */
  laboratoryId?: string;
  /** Laboratory name */
  laboratoryName?: string;
  /** Consumption date */
  date?: Date;
  /** Quantity consumed */
  quantity?: number;
}

/**
 * Device on-hand record
 */
export interface CihazUstuRecord {
  /** Hospital ID */
  hospitalId: string;
  /** Period (e.g., "01-2024") */
  period: string;
  /** Items data */
  items?: Array<{
    productId: string;
    value: number;
  }>;
  /** Alternative data format */
  data?: Array<{
    productId: string;
    value: number;
  }>;
}

/**
 * Cumulative report
 */
export interface KumulatifRapor {
  /** Hospital ID */
  hospitalId: string;
  /** Month (0-11) */
  month: number;
  /** Year */
  year: number;
  /** Summary data by product ID */
  summary: Record<string, {
    total?: number;
    rerun?: number;
    routine?: number;
    control?: number;
    calib?: number;
  }>;
}

/**
 * Lab pool for shared stock management
 */
export interface LabPool {
  /** Pool ID */
  id: string;
  /** Member laboratory IDs */
  memberIds: string[];
  /** Main laboratory ID */
  mainLabId?: string;
}

/**
 * Min-max rule for automatic ordering
 */
export interface MinMaxRule {
  /** Stock code */
  stokKodu: string;
  /** Minimum quantity */
  min?: number;
  /** Maximum quantity */
  max?: number;
  /** Max quantity day coverage */
  maxGun?: number;
}

/**
 * Efficiency pool for grouping laboratories
 */
export interface EfficiencyPool {
  /** Pool ID */
  id: string;
  /** Pool name */
  name: string;
  /** Member laboratory IDs */
  memberIds: string[];
  /** Creation timestamp */
  createdAt?: Date;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Month option for select components
 */
export interface MonthOption {
  /** Month value (0-11) */
  value: number;
  /** Month display label */
  label: string;
}

/**
 * Year range for efficiency calculations
 */
export type YearRange = number[];

/**
 * Date range for consumption calculations
 */
export interface DateRange {
  /** Start date */
  from?: Date;
  /** End date */
  to?: Date;
}

/**
 * Weighted efficiency calculation result
 */
export interface WeightedEfficiencyResult {
  /** Total weighted efficiency */
  totalWeightedEfficiency: number;
  /** Total consumption used for weighting */
  totalConsumption: number;
  /** Calculated efficiency percentage */
  efficiency: number;
}

/**
 * Excel export column definition
 */
export interface ExcelExportColumn {
  /** Column header */
  header: string;
  /** Column key */
  key: string;
  /** Column width */
  width?: number;
}
