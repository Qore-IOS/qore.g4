/**
 * Smart Query Engine - Coklu Veri Sorgulama ve Birlestirme
 *
 * Bu modul karmasik sorulari analiz eder ve birden fazla
 * veri kaynagindan veri cekerek anlamli sonuclar uretir.
 *
 * Ornek: "Line 7 verimlilik trendleri nasil?"
 * → Lab stok durumu + Cihaz arizalari + Tuketim verileri + Verimlilik kayitlari
 */

import { adminDb } from '@/lib/firebase-admin';
import { resolveEntities, extractQueryIntent, type ExtractedQueryIntent } from './entityResolver';
import { QueryType, type QueryPlan } from './queryPlanner';
import { aiLogger } from '@/lib/logger';
import { FIRESTORE_COLLECTIONS, QUERY_COLLECTION_MAP } from './firestoreSchema';

// ============================================
// TYPES
// ============================================

export interface SmartQueryResult {
  data: Record<string, unknown>;
  context: string;
  summary: string;
  dataQuality: {
    hasData: boolean;
    confidence: number;
    missingData: string[];
    warnings: string[];
  };
  queryPlan: {
    intent: ExtractedQueryIntent;
    executedQueries: string[];
    reasoning: string;
  };
}

// Kompleks soru tipleri ve gerektirdikleri veriler
interface ComplexQueryType {
  name: string;
  description: string;
  requiredData: QueryType[];
  optionalData: QueryType[];
  triggers: RegExp[];
}

const COMPLEX_QUERY_TYPES: ComplexQueryType[] = [
  {
    name: 'verimlilik_analizi',
    description: 'Laboratuvar verimlilik trend analizi',
    requiredData: ['efficiency_data'],
    optionalData: ['device_faults', 'consumption_history', 'stock_by_hospital'],
    triggers: [/verimlilik/i, /performans/i, /trend/i, /nasil.*gidiyor/i],
  },
  {
    name: 'stok_durum_raporu',
    description: 'Kapsamli stok durum raporu',
    requiredData: ['stock_by_hospital', 'low_stock'],
    optionalData: ['expiring_stock', 'consumption_history'],
    triggers: [/stok.*durum/i, /envanter/i, /ne.*kadar.*var/i],
  },
  {
    name: 'ariza_analizi',
    description: 'Cihaz ariza analizi ve sebebleri',
    requiredData: ['device_faults'],
    optionalData: ['efficiency_data'],
    triggers: [/ariza/i, /servis/i, /bozuk/i, /calismiyor/i],
  },
  {
    name: 'tuketim_analizi',
    description: 'Tuketim trend ve tahmin analizi',
    requiredData: ['consumption_history'],
    optionalData: ['stock_by_hospital', 'efficiency_data'],
    triggers: [/tuketim/i, /kullanim/i, /harcama/i, /ne.*kadar.*kullanildi/i],
  },
  {
    name: 'transfer_onerisi',
    description: 'Stok transfer optimizasyonu',
    requiredData: ['all_hospitals_stock', 'low_stock'],
    optionalData: ['consumption_history', 'expiring_stock'],
    triggers: [/transfer/i, /dagit/i, /paylas/i, /ihtiyac/i],
  },
  {
    name: 'miad_takibi',
    description: 'Son kullanma tarihi takibi ve uyarilari',
    requiredData: ['expiring_stock'],
    optionalData: ['consumption_history', 'all_hospitals_stock'],
    triggers: [/miad/i, /son.*kullanma/i, /expire/i, /bozulacak/i],
  },
  {
    name: 'lab_genel_durum',
    description: 'Laboratuvar genel durum ozeti',
    requiredData: ['stock_by_hospital', 'device_faults', 'efficiency_data'],
    optionalData: ['consumption_history', 'expiring_stock'],
    triggers: [/genel.*durum/i, /ozet/i, /rapor/i, /nasil/i],
  },
];

// ============================================
// QUERY PLAN GENERATION
// ============================================

async function determineQueryPlan(
  intent: ExtractedQueryIntent
): Promise<{ queries: QueryType[]; reasoning: string }> {
  const queries: Set<QueryType> = new Set();
  let reasoning = '';

  // Check which complex query type matches
  for (const complexType of COMPLEX_QUERY_TYPES) {
    if (complexType.triggers.some(t => t.test(intent.originalQuery))) {
      reasoning += `${complexType.name} tespit edildi. `;

      // Add required queries
      complexType.requiredData.forEach(q => queries.add(q));

      // Add optional queries based on context
      if (intent.entities.hospitals.length > 0) {
        complexType.optionalData.forEach(q => {
          if (!q.includes('all_hospitals')) {
            queries.add(q);
          }
        });
      }
    }
  }

  // If no complex type matched, use basic inference
  if (queries.size === 0) {
    reasoning = 'Temel sorgu analizi kullaniliyor. ';

    // First check QUERY_COLLECTION_MAP for keyword matches
    const queryLower = intent.originalQuery.toLowerCase();
    for (const [keyword, collections] of Object.entries(QUERY_COLLECTION_MAP)) {
      if (queryLower.includes(keyword.toLowerCase())) {
        reasoning += `"${keyword}" anahtar kelimesi bulundu. `;
        // Map collections to query types
        for (const col of collections) {
          if (col === 'depoStok') {
            if (queryLower.includes('depo') && !queryLower.includes('laboratuvar') && !queryLower.includes('lab')) {
              queries.add('stock_by_product'); // Depo stoku
            } else if (queryLower.includes('lab') || queryLower.includes('hastane')) {
              queries.add('stock_by_hospital'); // Lab stoku
            } else {
              queries.add('all_hospitals_stock'); // Genel stok
            }
          } else if (col === 'tuketimKayitlari') {
            queries.add('consumption_history');
          } else if (col === 'orders') {
            // Orders don't have a direct query type, will be handled separately
            reasoning += 'Siparis verileri sorgulanacak. ';
          } else if (col === 'deviceFaultReports') {
            queries.add('device_faults');
          } else if (col === 'efficiencyData' || col === 'efficiencyHistory') {
            queries.add('efficiency_data');
          } else if (col === 'productCodes') {
            queries.add('product_info');
          }
        }
      }
    }

    // If still no queries, add based on entities
    if (queries.size === 0) {
      if (intent.entities.hospitals.length > 0) {
        queries.add('stock_by_hospital');
      }
      if (intent.entities.products.length > 0) {
        queries.add('stock_by_product');
        queries.add('product_info');
      }

      // Add based on action
      switch (intent.action) {
        case 'count':
          queries.add('stock_by_hospital');
          break;
        case 'analyze':
          queries.add('efficiency_data');
          queries.add('consumption_history');
          break;
        case 'trend':
          queries.add('consumption_history');
          queries.add('efficiency_data');
          break;
        case 'list':
          queries.add('device_faults');
          queries.add('expiring_stock');
          break;
      }
    }
  }

  // Product-specific distribution questions: "hangi labda/hastanede en cok X var"
  const normalizedQuery = intent.originalQuery.toLowerCase();
  const asksForTopLocation =
    (normalizedQuery.includes('hangi') || normalizedQuery.includes('nerede')) &&
    (normalizedQuery.includes('en cok') || normalizedQuery.includes('en fazla')) &&
    (normalizedQuery.includes('lab') || normalizedQuery.includes('laboratuvar') || normalizedQuery.includes('hastane'));

  if (intent.entities.products.length > 0 && asksForTopLocation) {
    queries.add('all_hospitals_stock');
    reasoning += 'Urunun tum lab/hastane dagilimi icin all_hospitals_stock eklendi. ';
  }

  // Fault-heavy questions should always include device faults
  if (/(en\s*cok\s*ariza|ariza\s*veren\s*cihaz|en\s*sorunlu\s*cihaz)/i.test(intent.originalQuery)) {
    queries.add('device_faults');
    reasoning += 'Ariza veren cihaz analizi icin device_faults eklendi. ';
  }

  // Always add product_info if products are mentioned
  if (intent.entities.products.length > 0) {
    queries.add('product_info');
  }

  return {
    queries: Array.from(queries),
    reasoning,
  };
}

// ============================================
// ENHANCED DATA FETCHING
// ============================================

interface FetchParams {
  hospitalId?: string;
  hospitalName?: string;
  stokKodu?: string;
  stokAdi?: string;
  days?: number;
  status?: string;
}

async function fetchEnhancedData(
  queryTypes: QueryType[],
  intent: ExtractedQueryIntent
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const params: FetchParams = {};

  // Build params from resolved entities
  if (intent.entities.hospitals.length > 0) {
    const topHospital = intent.entities.hospitals[0];
    params.hospitalId = topHospital.id;
    params.hospitalName = topHospital.name;
  }

  if (intent.entities.products.length > 0) {
    const topProduct = intent.entities.products[0];
    params.stokKodu = topProduct.id;
    params.stokAdi = topProduct.name;
  }

  if (intent.timeRange?.days) {
    params.days = intent.timeRange.days;
  }

  if (intent.filters.status) {
    params.status = intent.filters.status as string;
  }

  // Execute queries in parallel
  const fetchPromises = queryTypes.map(async (queryType) => {
    try {
      const data = await executeSingleQuery(queryType, params);
      return { type: queryType, data, error: null };
    } catch (error) {
      // Check for Firestore-specific errors
      const errorCode = (error as { code?: number | string })?.code;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle gRPC NOT_FOUND (code 5) - usually missing index or collection
      if (errorCode === 5 || errorCode === 'NOT_FOUND' || errorMessage.includes('NOT_FOUND')) {
        aiLogger.warn(`Firestore collection/index not found for ${queryType}`, {
          queryType,
          errorCode,
          message: errorMessage,
          suggestion: 'Check if Firestore composite index exists or collection is empty'
        });
        return { type: queryType, data: null, error: `${queryType}: Veri kaynagi bulunamadi veya index eksik` };
      }

      // Handle permission denied
      if (errorCode === 7 || errorCode === 'PERMISSION_DENIED' || errorMessage.includes('PERMISSION_DENIED')) {
        aiLogger.error(`Firestore permission denied for ${queryType}`, error);
        return { type: queryType, data: null, error: `${queryType}: Yetki hatasi` };
      }

      aiLogger.error(`Error fetching ${queryType}`, error, { queryType, params });
      return { type: queryType, data: null, error: errorMessage };
    }
  });

  const results = await Promise.all(fetchPromises);

  for (const { type, data, error } of results) {
    if (data) {
      result[type] = data;
    } else if (error) {
      result[`${type}_error`] = error;
    }
  }

  return result;
}

async function executeSingleQuery(queryType: QueryType, params: FetchParams): Promise<unknown> {
  switch (queryType) {
    case 'stock_by_hospital':
      return fetchHospitalStockEnhanced(params);
    case 'stock_by_product':
      return fetchProductStockEnhanced(params);
    case 'device_faults':
      return fetchDeviceFaultsEnhanced(params);
    case 'efficiency_data':
      return fetchEfficiencyEnhanced(params);
    case 'consumption_history':
      return fetchConsumptionEnhanced(params);
    case 'expiring_stock':
      return fetchExpiringStockEnhanced(params);
    case 'low_stock':
      return fetchLowStockEnhanced(params);
    case 'all_hospitals_stock':
      return fetchAllHospitalsStockEnhanced(params);
    case 'product_info':
      return fetchProductInfoEnhanced(params);
    default:
      return null;
  }
}

// Enhanced fetch functions with better filtering
async function fetchHospitalStockEnhanced(params: FetchParams) {
  let query = adminDb.collection('depoStok').where('isShipped', '==', true);

  if (params.hospitalId) {
    query = query.where('hedefKurumId', '==', params.hospitalId);
  }

  const snapshot = await query.limit(1000).get();
  const groupedByProduct: Record<string, { stokKodu: string; stokAdi: string; miktar: number; lots: unknown[] }> = {};
  let totalFilteredItems = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Additional filtering by hospital name if ID not available
    if (params.hospitalName && !params.hospitalId) {
      const hospName = data.hedefKurum?.toLowerCase() || '';
      if (!hospName.includes(params.hospitalName.toLowerCase())) continue;
    }

    // Filter by product if specified
    if (params.stokKodu && data.stokKodu !== params.stokKodu) continue;
    if (params.stokAdi && !data.stokAdi?.toLowerCase().includes(params.stokAdi.toLowerCase())) continue;

    totalFilteredItems += 1;

    const key = data.stokKodu;
    if (!groupedByProduct[key]) {
      groupedByProduct[key] = {
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        miktar: 0,
        lots: [],
      };
    }
    groupedByProduct[key].miktar += 1;
    groupedByProduct[key].lots.push({
      lot: data.lotNumarasi,
      miad: data.miad?.toDate?.() || data.miad,
    });
  }

  return {
    hospitalName: params.hospitalName || 'Tum Hastaneler',
    totalItems: totalFilteredItems,
    products: Object.values(groupedByProduct).sort((a, b) => b.miktar - a.miktar),
  };
}

async function fetchProductStockEnhanced(params: FetchParams) {
  let query = adminDb.collection('depoStok').where('isShipped', '==', false);

  if (params.stokKodu) {
    query = query.where('stokKodu', '==', params.stokKodu);
  }

  const snapshot = await query.limit(500).get();
  const grouped: Record<string, { miktar: number; lots: unknown[] }> = {};

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.stokAdi && !data.stokAdi?.toLowerCase().includes(params.stokAdi.toLowerCase())) continue;

    const key = `${data.stokKodu}-${data.depotName}`;
    if (!grouped[key]) {
      grouped[key] = { miktar: 0, lots: [] };
    }
    grouped[key].miktar += 1;
    grouped[key].lots.push({
      lot: data.lotNumarasi,
      miad: data.miad?.toDate?.() || data.miad,
      depo: data.depotName,
    });
  }

  return {
    stokKodu: params.stokKodu,
    stokAdi: params.stokAdi,
    totalInDepot: snapshot.size,
    byLocation: grouped,
  };
}

async function fetchDeviceFaultsEnhanced(params: FetchParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('deviceFaultReports');

  if (params.status) {
    query = query.where('status', '==', params.status);
  }

  const snapshot = await query.limit(200).get();
  const faults: unknown[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.hospitalId && data.hospitalId !== params.hospitalId) continue;
    if (params.hospitalName && !data.labName?.toLowerCase().includes(params.hospitalName.toLowerCase())) continue;

    const openedAt = data.openedAt?.toDate?.() || data.openedAt || null;
    const openedAtMs = openedAt instanceof Date ? openedAt.getTime() : (typeof openedAt === 'number' ? openedAt : null);

    faults.push({
      id: doc.id,
      hospital: data.labName || data.hospitalName || '-',
      hospitalId: data.hospitalId || null,
      brand: data.brand || data.marka || null,
      model: data.model || data.deviceModel || '-',
      serial: data.serial || data.serialNumber || '-',
      title: data.title || null,
      description: data.description || data.openDescription || '-',
      closeDescription: data.closeDescription || null,
      status: data.status,
      faultType: data.faultType === 'teknik_servis' ? 'Teknik Servis' : data.faultType === 'aplikasyon' ? 'Aplikasyon' : (data.faultType || '-'),
      openedAt,
      duration: openedAtMs ? Math.floor((Date.now() - openedAtMs) / (1000 * 60 * 60 * 24)) : null,
    });
  }

  // Aggregate by fault type and model
  const byType: Record<string, number> = {};
  const byModel: Record<string, number> = {};

  for (const fault of faults as { faultType: string; model: string }[]) {
    byType[fault.faultType] = (byType[fault.faultType] || 0) + 1;
    byModel[fault.model] = (byModel[fault.model] || 0) + 1;
  }

  return {
    total: faults.length,
    faults,
    byFaultType: byType,
    byModel,
    avgDurationDays: faults.length > 0
      ? Math.round((faults as { duration: number }[]).reduce((sum, f) => sum + (f.duration || 0), 0) / faults.length)
      : 0,
  };
}

async function fetchEfficiencyEnhanced(params: FetchParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('efficiencyHistory');

  if (params.hospitalId) {
    query = query.where('hospitalId', '==', params.hospitalId);
  }

  let snapshot;
  try {
    // Try with ordering (requires composite index)
    snapshot = await query.orderBy('year', 'desc').orderBy('month', 'desc').limit(12).get();
  } catch (orderError) {
    // If composite index is missing, fall back to simple query
    const errorCode = (orderError as { code?: number | string })?.code;
    if (errorCode === 5 || errorCode === 'NOT_FOUND' || (orderError as Error).message?.includes('NOT_FOUND')) {
      aiLogger.warn('Composite index missing for efficiencyHistory, using simple query', {
        suggestion: 'Create composite index in Firebase Console: efficiencyHistory (hospitalId ASC, year DESC, month DESC)'
      });
      // Fall back to simple query without ordering
      snapshot = await query.limit(12).get();
    } else {
      throw orderError;
    }
  }

  const records: unknown[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.hospitalName && !data.hospitalName?.toLowerCase().includes(params.hospitalName.toLowerCase())) continue;

    records.push({
      hospitalName: data.hospitalName,
      year: data.year,
      month: data.month,
      verimlilik: data.verimlilikSonuclari,
      testTuketim: data.hesaplananTestBazliTuketim,
    });
  }

  // Sort in memory if we couldn't do it in query
  records.sort((a: { year: number; month: number }, b: { year: number; month: number }) => {
    if (b.year !== a.year) return b.year - a.year;
    return b.month - a.month;
  });

  return {
    totalRecords: records.length,
    records: records.slice(0, 12),
    trend: records.length >= 2 ? 'calculated' : 'insufficient_data',
  };
}

async function fetchConsumptionEnhanced(params: FetchParams) {
  const days = params.days || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let query = adminDb.collection('tuketimKayitlari')
    .where('consumptionTimestamp', '>=', startDate)
    .orderBy('consumptionTimestamp', 'desc')
    .limit(500);

  const snapshot = await query.get();
  const byProduct: Record<string, { stokAdi: string; toplamMiktar: number; kayitSayisi: number }> = {};
  const byHospital: Record<string, number> = {};

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.hospitalId && data.laboratoryId !== params.hospitalId) continue;
    if (params.stokKodu && data.stokKodu !== params.stokKodu) continue;

    // By product
    if (!byProduct[data.stokKodu]) {
      byProduct[data.stokKodu] = { stokAdi: data.stokAdi, toplamMiktar: 0, kayitSayisi: 0 };
    }
    byProduct[data.stokKodu].toplamMiktar += data.ambalajDegeri || 1;
    byProduct[data.stokKodu].kayitSayisi += 1;

    // By hospital
    byHospital[data.laboratoryName] = (byHospital[data.laboratoryName] || 0) + (data.ambalajDegeri || 1);
  }

  return {
    period: `Son ${days} gun`,
    totalConsumption: Object.values(byProduct).reduce((sum, p) => sum + p.toplamMiktar, 0),
    byProduct: Object.entries(byProduct)
      .map(([kod, v]) => ({ stokKodu: kod, ...v }))
      .sort((a, b) => b.toplamMiktar - a.toplamMiktar)
      .slice(0, 20),
    byHospital: Object.entries(byHospital)
      .map(([name, miktar]) => ({ hospital: name, miktar }))
      .sort((a, b) => b.miktar - a.miktar),
  };
}

async function fetchExpiringStockEnhanced(params: FetchParams) {
  const days = params.days || 90;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  const query = adminDb.collection('depoStok')
    .where('miad', '<=', expiryDate)
    .limit(500);

  const snapshot = await query.get();
  const items: unknown[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.hospitalId && data.hedefKurumId !== params.hospitalId && data.isShipped) continue;

    const miadDate = data.miad?.toDate?.() || data.miad;
    const daysUntilExpiry = miadDate ? Math.ceil((miadDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    items.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      lot: data.lotNumarasi,
      miad: miadDate,
      daysUntilExpiry,
      location: data.isShipped ? data.hedefKurum : data.depotName,
      isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
    });
  }

  // Group by urgency
  const expired = items.filter((i: { isExpired: boolean }) => i.isExpired);
  const critical = items.filter((i: { daysUntilExpiry: number; isExpired: boolean }) => !i.isExpired && i.daysUntilExpiry <= 30);
  const warning = items.filter((i: { daysUntilExpiry: number; isExpired: boolean }) => !i.isExpired && i.daysUntilExpiry > 30 && i.daysUntilExpiry <= 90);

  return {
    total: items.length,
    expired: { count: expired.length, items: expired.slice(0, 10) },
    critical: { count: critical.length, items: critical.slice(0, 10) },
    warning: { count: warning.length, items: warning.slice(0, 10) },
  };
}

async function fetchLowStockEnhanced(params: FetchParams) {
  // Get min/max rules
  const hospitalsSnap = await adminDb.collection('hospitals').get();
  const lowStockItems: unknown[] = [];

  for (const hospDoc of hospitalsSnap.docs) {
    if (params.hospitalId && hospDoc.id !== params.hospitalId) continue;

    const hospData = hospDoc.data();
    const minMaxRules = hospData.minMaxRules || {};

    // Get current stock for this hospital
    const stockSnap = await adminDb.collection('depoStok')
      .where('hedefKurumId', '==', hospDoc.id)
      .where('isShipped', '==', true)
      .get();

    // Count stock by product
    const stockCount: Record<string, number> = {};
    for (const stockDoc of stockSnap.docs) {
      const code = stockDoc.data().stokKodu;
      stockCount[code] = (stockCount[code] || 0) + 1;
    }

    // Check against min/max rules
    for (const [stokKodu, rule] of Object.entries(minMaxRules) as [string, { min: number; max: number; stokAdi?: string }][]) {
      const current = stockCount[stokKodu] || 0;
      if (current < rule.min) {
        lowStockItems.push({
          hospital: hospData.name || hospData.ad,
          hospitalId: hospDoc.id,
          stokKodu,
          stokAdi: rule.stokAdi || stokKodu,
          current,
          min: rule.min,
          max: rule.max,
          shortage: rule.min - current,
          percentFilled: Math.round((current / rule.min) * 100),
        });
      }
    }
  }

  return {
    total: lowStockItems.length,
    items: lowStockItems.sort((a: { shortage: number }, b: { shortage: number }) => b.shortage - a.shortage),
    criticalCount: lowStockItems.filter((i: { percentFilled: number }) => i.percentFilled < 25).length,
    warningCount: lowStockItems.filter((i: { percentFilled: number }) => i.percentFilled >= 25 && i.percentFilled < 50).length,
  };
}

async function fetchAllHospitalsStockEnhanced(params: FetchParams) {
  const hospitalsSnap = await adminDb.collection('hospitals').get();
  const hospitals = hospitalsSnap.docs.map(d => ({
    id: d.id,
    name: d.data().name || d.data().ad,
  }));

  let stockQuery = adminDb.collection('depoStok').where('isShipped', '==', true);
  if (params.stokKodu) {
    stockQuery = stockQuery.where('stokKodu', '==', params.stokKodu);
  }

  const stockSnap = await stockQuery.limit(2000).get();

  // Aggregate by hospital
  const byHospital: Record<string, { name: string; count: number; products: Record<string, number> }> = {};

  for (const hosp of hospitals) {
    byHospital[hosp.id] = { name: hosp.name, count: 0, products: {} };
  }

  for (const doc of stockSnap.docs) {
    const data = doc.data();
    const hospId = data.hedefKurumId;

    if (hospId && byHospital[hospId]) {
      byHospital[hospId].count += 1;
      byHospital[hospId].products[data.stokKodu] = (byHospital[hospId].products[data.stokKodu] || 0) + 1;
    }
  }

  return {
    totalHospitals: hospitals.length,
    hospitals: Object.entries(byHospital)
      .map(([id, data]) => ({ hospitalId: id, ...data }))
      .filter(h => h.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

async function fetchProductInfoEnhanced(params: FetchParams) {
  const snapshot = await adminDb.collection('productCodes').limit(1000).get();
  const products: unknown[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (params.stokKodu && data.stokKodu !== params.stokKodu) continue;
    if (params.stokAdi && !data.stokAdi?.toLowerCase().includes(params.stokAdi.toLowerCase())) continue;

    products.push({
      stokKodu: data.stokKodu,
      stokAdi: data.stokAdi,
      urunGrubu: data.urunGrubu,
      marka: data.marka,
      ambalajDegeri: data.ambalajDegeri,
      testAdi: data.testAdi,
    });
  }

  return {
    found: products.length,
    products: products.slice(0, 20),
  };
}

// ============================================
// CONTEXT FORMATTING
// ============================================

function formatDataAsContext(data: Record<string, unknown>, intent: ExtractedQueryIntent): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Sorgu: "${intent.originalQuery}"\n`);

  if (intent.entities.hospitals.length > 0) {
    sections.push(`## Tespit Edilen Hastane/Lab: ${intent.entities.hospitals.map(h => h.name).join(', ')}`);
  }
  if (intent.entities.products.length > 0) {
    sections.push(`## Tespit Edilen Urunler: ${intent.entities.products.map(p => p.name).join(', ')}`);
  }

  sections.push('\n---\n');

  // Data sections
  if (data.stock_by_hospital) {
    const stockData = data.stock_by_hospital as { hospitalName: string; totalItems: number; products: unknown[] };
    sections.push(`## Stok Durumu: ${stockData.hospitalName}`);
    sections.push(`Toplam: ${stockData.totalItems} adet\n`);
    if (stockData.products) {
      sections.push('| Urun Kodu | Urun Adi | Miktar |');
      sections.push('|-----------|----------|--------|');
      for (const p of (stockData.products as { stokKodu: string; stokAdi: string; miktar: number }[]).slice(0, 20)) {
        sections.push(`| ${p.stokKodu} | ${p.stokAdi} | ${p.miktar} |`);
      }
    }
    sections.push('');
  }

  if (data.device_faults) {
    const faultData = data.device_faults as { total: number; faults: unknown[]; byFaultType: Record<string, number>; byModel?: Record<string, number>; avgDurationDays: number };
    sections.push(`## Cihaz Arizalari`);
    sections.push(`Toplam Ariza Kaydi: ${faultData.total}`);
    sections.push(`Ortalama Cozum Suresi: ${faultData.avgDurationDays} gun\n`);

    if (faultData.byModel && Object.keys(faultData.byModel).length > 0) {
      sections.push('### Modele Gore Ariza Sayisi (Ilk 10)');
      const topModels = Object.entries(faultData.byModel)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      for (const [model, count] of topModels) {
        sections.push(`- ${model}: ${count} adet`);
      }
      sections.push('');
    }

    sections.push('### Ariza Tiplerine Gore');
    for (const [type, count] of Object.entries(faultData.byFaultType)) {
      sections.push(`- ${type}: ${count} adet`);
    }

    sections.push('\n### Son Ariza Detaylari');
    for (const f of (faultData.faults as { hospital: string; brand?: string; model: string; serial?: string; description: string; closeDescription?: string; openedAt: Date }[]).slice(0, 8)) {
      sections.push(`- **${f.hospital}** - ${f.brand ? `${f.brand} / ` : ''}${f.model} (${f.serial || '-'})`);
      sections.push(`  - Acilis: ${f.description || '-'}`);
      if (f.closeDescription) {
        sections.push(`  - Kapanis: ${f.closeDescription}`);
      }
    }
    sections.push('');
  }


  if (data.efficiency_data) {
    const effData = data.efficiency_data as { totalRecords: number; records: unknown[] };
    sections.push(`## Verimlilik Verileri`);
    sections.push(`Kayit Sayisi: ${effData.totalRecords}\n`);
    for (const r of (effData.records as { hospitalName: string; year: number; month: number; verimlilik: unknown }[]).slice(0, 5)) {
      sections.push(`### ${r.hospitalName} - ${r.month}/${r.year}`);
      sections.push(`Verimlilik: ${JSON.stringify(r.verimlilik)}`);
    }
    sections.push('');
  }

  if (data.consumption_history) {
    const consData = data.consumption_history as { period: string; totalConsumption: number; byProduct: unknown[]; byHospital: unknown[] };
    sections.push(`## Tuketim Verileri (${consData.period})`);
    sections.push(`Toplam Tuketim: ${consData.totalConsumption} adet\n`);
    sections.push('### Urune Gore');
    for (const p of (consData.byProduct as { stokKodu: string; stokAdi: string; toplamMiktar: number }[]).slice(0, 10)) {
      sections.push(`- ${p.stokAdi}: ${p.toplamMiktar} adet`);
    }
    sections.push('');
  }

  if (data.expiring_stock) {
    const expData = data.expiring_stock as { total: number; expired: { count: number }; critical: { count: number }; warning: { count: number } };
    sections.push(`## Miad Durumu`);
    sections.push(`- **Suresi Gecmis:** ${expData.expired.count} adet`);
    sections.push(`- **Kritik (<30 gun):** ${expData.critical.count} adet`);
    sections.push(`- **Uyari (30-90 gun):** ${expData.warning.count} adet`);
    sections.push('');
  }

  if (data.low_stock) {
    const lowData = data.low_stock as { total: number; criticalCount: number; items: unknown[] };
    sections.push(`## Dusuk Stok Uyarilari`);
    sections.push(`Toplam: ${lowData.total} urun minimum altinda`);
    sections.push(`Kritik: ${lowData.criticalCount} urun\n`);
    for (const item of (lowData.items as { hospital: string; stokAdi: string; current: number; min: number }[]).slice(0, 10)) {
      sections.push(`- **${item.hospital}** - ${item.stokAdi}: ${item.current}/${item.min}`);
    }
    sections.push('');
  }

  // No data warning
  const hasAnyData = Object.keys(data).some(k => !k.includes('_error') && data[k]);
  if (!hasAnyData) {
    sections.push('## UYARI: Veri Bulunamadi');
    sections.push('Sorgunuzla eslesen veri bulunamadi. Lutfen farkli bir ifade deneyin.');
  }

  return sections.join('\n');
}

// ============================================
// MAIN FUNCTION
// ============================================

export async function executeSmartQuery(userQuery: string): Promise<SmartQueryResult> {
  aiLogger.info('Smart query processing', { query: userQuery.substring(0, 100) });

  // Step 1: Extract intent and resolve entities
  const intent = await extractQueryIntent(userQuery);
  aiLogger.debug('Query intent extracted', {
    action: intent.action,
    hospitalCount: intent.entities.hospitals.length,
    productCount: intent.entities.products.length,
  });

  // Step 2: Determine query plan
  const queryPlan = await determineQueryPlan(intent);
  aiLogger.debug('Query plan determined', { queries: queryPlan.queries, reasoning: queryPlan.reasoning });

  // Step 3: Fetch data
  const data = await fetchEnhancedData(queryPlan.queries, intent);
  aiLogger.info('Data fetched', { dataKeys: Object.keys(data) });

  // Step 4: Format context
  const context = formatDataAsContext(data, intent);

  // Step 5: Evaluate data quality
  const hasData = Object.keys(data).some(k => !k.includes('_error') && data[k]);
  const errors = Object.keys(data).filter(k => k.includes('_error'));
  const missingData = queryPlan.queries.filter(q => !data[q]);

  const dataQuality = {
    hasData,
    confidence: hasData ? 0.8 : 0.2,
    missingData,
    warnings: errors.map(e => `${e}: ${data[e]}`),
  };

  // Step 6: Generate summary
  let summary = '';
  if (intent.entities.hospitals.length > 0) {
    summary += `Hastane: ${intent.entities.hospitals[0].name}. `;
  }
  if (intent.entities.products.length > 0) {
    summary += `Urun: ${intent.entities.products[0].name}. `;
  }
  summary += `${queryPlan.queries.length} veri kaynagindan veri cekildi.`;

  return {
    data,
    context,
    summary,
    dataQuality,
    queryPlan: {
      intent,
      executedQueries: queryPlan.queries,
      reasoning: queryPlan.reasoning,
    },
  };
}
