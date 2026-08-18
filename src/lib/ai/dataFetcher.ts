import { adminDb } from '@/lib/firebase-admin';
import { QueryType } from './queryPlanner';
import type { Query, DocumentData } from 'firebase-admin/firestore';
import { aiLogger } from '@/lib/logger';
// Miad çözümünde TEK KAYNAK — biçim çeşitliliğini burada karşılamak zorundayız.
import { parseMiad } from '@/lib/lojistik/miad';

// Simplified types for AI context
interface StockItem {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  miktar: number;
  lokasyon: string;
  lokasyonId?: string;
  seriNumarasi?: string;
}

interface HospitalStock {
  hospitalId: string;
  hospitalName: string;
  items: StockItem[];
  totalItems: number;
}

interface ConsumptionData {
  stokKodu: string;
  stokAdi: string;
  miktar: number;
  tarih: string;
  hospital: string;
}

interface DeviceFault {
  id: string;
  hospital: string;
  model: string;
  marka: string;
  seriNumarasi: string;
  description: string;
  status: string;
  faultType: string;
  openedAt: string;
  closedAt?: string;
}

interface EfficiencyInfo {
  hospitalName: string;
  year: number;
  month: number;
  verimlilikSonuclari: Record<string, unknown>;
  hesaplananTestBazliTuketim: Record<string, number>;
}

interface ProductInfo {
  stokKodu: string;
  stokAdi: string;
  urunGrubu?: string;
  marka?: string;
  ambalajDegeri?: number;
}

export interface FetchedData {
  stocks?: StockItem[];
  hospitalStocks?: HospitalStock[];
  consumptions?: ConsumptionData[];
  deviceFaults?: DeviceFault[];
  efficiencyData?: EfficiencyInfo[];
  products?: ProductInfo[];
  summary?: string;
  errors?: string[];
}

/**
 * Firestore alanını AI bağlamı için `yyyy-MM-dd` metnine çevirir.
 *
 * Eski hâli imzasına (`Timestamp | Date`) güveniyor ve başka her şeyde
 * `ts.toDate()` çağırıyordu. Ama `depoStok.miad` bu sistemde Timestamp DEĞİL,
 * `dd.MM.yyyy` METNİ olarak saklanıyor (`mal-kabul/write.ts` → `normalizeMiad`).
 * Sonuç: stok sorgularında ilk belgede `TypeError: ts.toDate is not a function`
 * fırlıyor, `fetchDataForQueries` içindeki catch bunu yutuyor ve AI paneli
 * stoğu hiç göremiyordu — sessiz, kalıcı bir arıza.
 *
 * İkinci hata: `toISOString()` UTC'ye çevirir. Yerel gece yarısı olarak kurulmuş
 * bir tarih UTC+3'te bir gün GERİYE düşüyordu (31.12 → 30.12). Biçimleme artık
 * yerel takvim alanlarından yapılır.
 *
 * Çözüm `parseMiad`'a devredilir: Timestamp, Date, ISO, `dd.MM.yyyy` ve yalnız
 * ay/yıl taşıyan değerlerin tamamını tek elden çözen kaynak odur.
 */
function timestampToString(ts: unknown): string {
  const tarih = parseMiad(ts);
  if (!tarih) return '';
  const ay = String(tarih.getMonth() + 1).padStart(2, '0');
  const gun = String(tarih.getDate()).padStart(2, '0');
  return `${tarih.getFullYear()}-${ay}-${gun}`;
}

/** Miadı bilinmeyen kayıt sıralamanın SONUNA gider — öne almak yanlış taraftır. */
function miadSiraDegeri(miad: string | undefined): number {
  const tarih = parseMiad(miad);
  return tarih ? tarih.getTime() : Number.POSITIVE_INFINITY;
}

// Fetch stock by product code
async function fetchStockByProduct(params: Record<string, unknown>): Promise<StockItem[]> {
  const { stokKodu, stokAdi } = params;

  let query = adminDb.collection('depoStok').where('isShipped', '==', false);

  if (stokKodu) {
    query = query.where('stokKodu', '==', stokKodu);
  }

  const snapshot = await query.limit(500).get();
  const items: StockItem[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // If searching by name, filter in memory
    if (stokAdi && !data.stokAdi?.toLowerCase().includes((stokAdi as string).toLowerCase())) {
      continue;
    }
    items.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      lotNumarasi: data.lotNumarasi,
      miad: timestampToString(data.miad),
      miktar: 1, // Her kayıt 1 birim
      lokasyon: data.depotName || 'Bilinmiyor',
      lokasyonId: data.depotId,
      seriNumarasi: data.seriNumarasi,
    });
  }

  // Group by lokasyon and stokKodu for summary
  const grouped: Record<string, StockItem> = {};
  for (const item of items) {
    const key = `${item.lokasyon}-${item.stokKodu}-${item.lotNumarasi}`;
    if (grouped[key]) {
      grouped[key].miktar += 1;
    } else {
      grouped[key] = { ...item };
    }
  }

  return Object.values(grouped);
}

// Fetch stock by hospital
async function fetchStockByHospital(params: Record<string, unknown>): Promise<StockItem[]> {
  const { hospitalName, hospitalId } = params;

  let query = adminDb.collection('depoStok')
    .where('isShipped', '==', true);

  if (hospitalId) {
    query = query.where('hedefKurumId', '==', hospitalId);
  }

  const snapshot = await query.limit(1000).get();
  const items: StockItem[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (hospitalName && !data.hedefKurum?.toLowerCase().includes((hospitalName as string).toLowerCase())) {
      continue;
    }
    items.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      lotNumarasi: data.lotNumarasi,
      miad: timestampToString(data.miad),
      miktar: 1,
      lokasyon: data.hedefKurum || 'Bilinmiyor',
      lokasyonId: data.hedefKurumId,
    });
  }

  // Group by product and lot
  const grouped: Record<string, StockItem> = {};
  for (const item of items) {
    const key = `${item.lokasyon}-${item.stokKodu}-${item.lotNumarasi}`;
    if (grouped[key]) {
      grouped[key].miktar += 1;
    } else {
      grouped[key] = { ...item };
    }
  }

  return Object.values(grouped);
}

// Fetch all hospitals' stock for a specific product (for transfer suggestions)
async function fetchAllHospitalsStock(params: Record<string, unknown>): Promise<HospitalStock[]> {
  const { stokKodu } = params;

  // Get all hospitals first
  const hospitalsSnap = await adminDb.collection('hospitals').get();
  const hospitals = hospitalsSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.data().ad }));

  // Get stock items for this product
  let query = adminDb.collection('depoStok')
    .where('isShipped', '==', true);

  if (stokKodu) {
    query = query.where('stokKodu', '==', stokKodu);
  }

  const stockSnap = await query.limit(2000).get();

  // Group by hospital
  const hospitalStockMap: Record<string, { items: StockItem[]; name: string }> = {};

  for (const hospital of hospitals) {
    hospitalStockMap[hospital.id] = { items: [], name: hospital.name };
  }

  for (const doc of stockSnap.docs) {
    const data = doc.data();
    const hospId = data.hedefKurumId;
    if (hospId && hospitalStockMap[hospId]) {
      hospitalStockMap[hospId].items.push({
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        lotNumarasi: data.lotNumarasi,
        miad: timestampToString(data.miad),
        miktar: 1,
        lokasyon: hospitalStockMap[hospId].name,
        lokasyonId: hospId,
      });
    }
  }

  // Convert to array and aggregate counts
  const result: HospitalStock[] = [];
  for (const [hospId, data] of Object.entries(hospitalStockMap)) {
    if (data.items.length === 0) continue;

    // Group items by lot
    const grouped: Record<string, StockItem> = {};
    for (const item of data.items) {
      const key = `${item.stokKodu}-${item.lotNumarasi}`;
      if (grouped[key]) {
        grouped[key].miktar += 1;
      } else {
        grouped[key] = { ...item };
      }
    }

    result.push({
      hospitalId: hospId,
      hospitalName: data.name,
      items: Object.values(grouped),
      totalItems: data.items.length,
    });
  }

  return result.sort((a, b) => b.totalItems - a.totalItems);
}

// Fetch consumption history
async function fetchConsumptionHistory(params: Record<string, unknown>): Promise<ConsumptionData[]> {
  const { stokKodu, hospitalId, days = 30 } = params;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days as number));

  let query = adminDb.collection('tuketimKayitlari')
    .where('consumptionTimestamp', '>=', startDate)
    .orderBy('consumptionTimestamp', 'desc')
    .limit(500);

  const snapshot = await query.get();
  const consumptions: ConsumptionData[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Filter by stokKodu or hospitalId if provided
    if (stokKodu && data.stokKodu !== stokKodu) continue;
    if (hospitalId && data.laboratoryId !== hospitalId) continue;

    consumptions.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      miktar: data.ambalajDegeri || 1,
      tarih: timestampToString(data.consumptionTimestamp),
      hospital: data.laboratoryName,
    });
  }

  // Aggregate by product and hospital
  const aggregated: Record<string, ConsumptionData & { toplamMiktar: number }> = {};
  for (const c of consumptions) {
    const key = `${c.hospital}-${c.stokKodu}`;
    if (aggregated[key]) {
      aggregated[key].toplamMiktar += c.miktar;
    } else {
      aggregated[key] = { ...c, toplamMiktar: c.miktar };
    }
  }

  return Object.values(aggregated).map(a => ({
    stokKodu: a.stokKodu,
    stokAdi: a.stokAdi,
    miktar: a.toplamMiktar,
    tarih: `Son ${days} gün`,
    hospital: a.hospital,
  }));
}

// Fetch device faults
async function fetchDeviceFaults(params: Record<string, unknown>): Promise<DeviceFault[]> {
  const { hospitalId, brand, status = 'open' } = params;

  let query: Query<DocumentData> = adminDb.collection('deviceFaultReports');

  if (status) {
    query = query.where('status', '==', status);
  }

  const snapshot = await query.limit(200).get();
  const faults: DeviceFault[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Filter by hospitalId or brand if provided
    if (hospitalId && data.hospitalId !== hospitalId) continue;
    if (brand && !data.model?.toLowerCase().includes((brand as string).toLowerCase())) continue;

    faults.push({
      id: doc.id,
      hospital: data.labName,
      model: data.model,
      marka: data.model?.split(' ')[0] || '',
      seriNumarasi: data.serial,
      description: data.description,
      status: data.status,
      faultType: data.faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon',
      openedAt: timestampToString(data.openedAt),
      closedAt: data.closedAt ? timestampToString(data.closedAt) : undefined,
    });
  }

  return faults;
}

// Fetch efficiency data
async function fetchEfficiencyData(params: Record<string, unknown>): Promise<EfficiencyInfo[]> {
  const { hospitalId, year, month } = params;

  let query: Query<DocumentData> = adminDb.collection('efficiencyHistory');

  if (hospitalId) {
    query = query.where('hospitalId', '==', hospitalId);
  }
  if (year) {
    query = query.where('year', '==', year);
  }
  if (month) {
    query = query.where('month', '==', month);
  }

  const snapshot = await query.limit(50).get();
  const efficiency: EfficiencyInfo[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    efficiency.push({
      hospitalName: data.hospitalName,
      year: data.year,
      month: data.month,
      verimlilikSonuclari: data.verimlilikSonuclari || {},
      hesaplananTestBazliTuketim: data.hesaplananTestBazliTuketim || {},
    });
  }

  return efficiency;
}

// Fetch expiring stock
async function fetchExpiringStock(params: Record<string, unknown>): Promise<StockItem[]> {
  const { days = 90, hospitalId } = params;

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + (days as number));

  // Get items expiring soon
  const query = adminDb.collection('depoStok')
    .where('miad', '<=', expiryDate)
    .where('isShipped', '==', hospitalId ? true : false)
    .limit(500);

  const snapshot = await query.get();
  const items: StockItem[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (hospitalId && data.hedefKurumId !== hospitalId) continue;

    items.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      lotNumarasi: data.lotNumarasi,
      miad: timestampToString(data.miad),
      miktar: 1,
      lokasyon: data.hedefKurum || data.depotName || 'Bilinmiyor',
    });
  }

  // Group
  const grouped: Record<string, StockItem> = {};
  for (const item of items) {
    const key = `${item.lokasyon}-${item.stokKodu}-${item.lotNumarasi}`;
    if (grouped[key]) {
      grouped[key].miktar += 1;
    } else {
      grouped[key] = { ...item };
    }
  }

  // `Infinity - Infinity` NaN verir; farkla değil, açık karşılaştırmayla sırala.
  return Object.values(grouped).sort((a, b) => {
    const ma = miadSiraDegeri(a.miad);
    const mb = miadSiraDegeri(b.miad);
    if (ma === mb) return 0;
    return ma < mb ? -1 : 1;
  });
}

// Fetch product info
async function fetchProductInfo(params: Record<string, unknown>): Promise<ProductInfo[]> {
  const { stokKodu, stokAdi } = params;

  const snapshot = await adminDb.collection('productCodes').limit(1000).get();
  const products: ProductInfo[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (stokKodu && data.stokKodu !== stokKodu) continue;
    if (stokAdi && !data.stokAdi?.toLowerCase().includes((stokAdi as string).toLowerCase())) continue;

    products.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      urunGrubu: data.urunGrubu,
      marka: data.marka,
      ambalajDegeri: data.ambalajDegeri,
    });
  }

  return products.slice(0, 20); // Limit to 20 results
}

// Main fetch function that executes query plan
export async function fetchDataForQueries(
  queries: Array<{ type: QueryType; params: Record<string, unknown> }>
): Promise<FetchedData> {
  const result: FetchedData = {};
  const errors: string[] = [];

  for (const query of queries) {
    try {
      aiLogger.debug(`Fetching ${query.type}`, { params: query.params });

      switch (query.type) {
        case 'stock_by_product':
          result.stocks = await fetchStockByProduct(query.params);
          break;
        case 'stock_by_hospital':
          result.stocks = await fetchStockByHospital(query.params);
          break;
        case 'stock_by_depot':
          result.stocks = await fetchStockByProduct(query.params); // Same logic
          break;
        case 'all_hospitals_stock':
          result.hospitalStocks = await fetchAllHospitalsStock(query.params);
          break;
        case 'consumption_history':
          result.consumptions = await fetchConsumptionHistory(query.params);
          break;
        case 'device_faults':
          result.deviceFaults = await fetchDeviceFaults(query.params);
          break;
        case 'efficiency_data':
          result.efficiencyData = await fetchEfficiencyData(query.params);
          break;
        case 'expiring_stock':
          result.stocks = await fetchExpiringStock(query.params);
          break;
        case 'low_stock':
          // Will be implemented with min/max rules
          aiLogger.debug('low_stock query type not yet implemented');
          break;
        case 'product_info':
          result.products = await fetchProductInfo(query.params);
          break;
        default:
          aiLogger.warn(`Unknown query type: ${query.type}`);
      }

      aiLogger.debug(`${query.type} completed successfully`);
    } catch (error) {
      const errorCode = (error as { code?: number | string })?.code;
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';

      // Check for Firestore-specific errors
      if (errorCode === 5 || errorCode === 'NOT_FOUND' || errorMessage.includes('NOT_FOUND')) {
        aiLogger.warn(`Collection/index not found for ${query.type}`, { errorCode });
        errors.push(`${query.type}: Veri kaynagi bulunamadi`);
      } else {
        aiLogger.error(`Error fetching ${query.type}`, error);
        errors.push(`${query.type}: ${errorMessage}`);
      }
    }
  }

  // Generate summary
  const summaryParts: string[] = [];
  if (result.stocks?.length) summaryParts.push(`${result.stocks.length} stok kaydı`);
  if (result.hospitalStocks?.length) summaryParts.push(`${result.hospitalStocks.length} hastane`);
  if (result.consumptions?.length) summaryParts.push(`${result.consumptions.length} tüketim kaydı`);
  if (result.deviceFaults?.length) summaryParts.push(`${result.deviceFaults.length} arıza kaydı`);
  if (result.efficiencyData?.length) summaryParts.push(`${result.efficiencyData.length} verimlilik kaydı`);
  if (result.products?.length) summaryParts.push(`${result.products.length} ürün`);

  result.summary = summaryParts.join(', ') || 'Veri bulunamadı';

  // Add errors if any
  if (errors.length > 0) {
    result.errors = errors;
    aiLogger.warn('DataFetcher completed with errors', { errors });
  }

  return result;
}
