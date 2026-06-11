import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { matchesCompanyScope } from '@/lib/company-scope';

/**
 * STABİLİZASYON (P0.3) — bu route iki kritik kusur taşıyordu:
 *
 *  1. Yetki, istemcinin değiştirebildiği query parametrelerinden geliyordu
 *     (companyId / isSuperAdmin=1 / isAdmin=1 / assignedLabs). Artık kimlik
 *     YALNIZ doğrulanmış Firebase ID token + sunucudaki kullanıcı
 *     profilinden türetilir; istemci parametreleri yok sayılır.
 *  2. Her liste isteği deviceFaultReports koleksiyonunun TAMAMINI tüm
 *     alanlarıyla okuyordu. Artık tarama tenant-scoped sorgularla ve yalnız
 *     filtre/sıralama/sayaç için gereken alanların `.select()`
 *     projeksiyonuyla yapılır; sayfadaki satırların tam dokümanları ayrıca
 *     `getAll` ile çekilir. Payload ve bellek kullanımı sayfa boyutuyla
 *     sınırlanır.
 */

const LEGACY_COMPANY_ID = '__legacy__';

/**
 * companyId alanı hiç olmayan çok eski kayıtlar için unscoped uyumluluk
 * taraması. Migration audit'i untagged kayıt kalmadığını doğrulayınca
 * NEXT_PUBLIC_LEGACY_UNTAGGED_COMPAT=off yapın — liste başına bir tam
 * koleksiyon taraması tasarruf ettirir.
 */
const LEGACY_UNTAGGED_COMPAT =
  process.env.NEXT_PUBLIC_LEGACY_UNTAGGED_COMPAT !== 'off';

/** Tarama fazında okunan hafif alanlar (filtre/sıralama/sayaç/options). */
const SCAN_PROJECTION = [
  'status', 'openedAt', 'createdAt', 'labName', 'serial',
  'openedByName', 'hospitalId', 'labId', 'companyId',
] as const;

interface CallerContext {
  uid: string;
  companyId: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  assignedLabIds: string[];
}

async function resolveCaller(request: NextRequest): Promise<CallerContext | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const profileSnap = await adminDb.collection('users').doc(decoded.uid).get();
    const profile = (profileSnap.exists ? profileSnap.data() : {}) as {
      role?: string;
      companyId?: string;
      assignedLaboratories?: unknown;
    };
    const role = profile.role ?? 'user';
    const isSuperAdmin = decoded.isSuperAdmin === true || role === 'super_admin';
    const isAdmin = isSuperAdmin || role === 'admin' || role === 'admin_developer';
    const companyId =
      (typeof decoded.companyId === 'string' && decoded.companyId) ||
      profile.companyId ||
      LEGACY_COMPANY_ID;
    const assignedLabIds = Array.isArray(profile.assignedLaboratories)
      ? profile.assignedLaboratories.filter((v): v is string => typeof v === 'string')
      : [];
    return { uid: decoded.uid, companyId, isSuperAdmin, isAdmin, assignedLabIds };
  } catch {
    return null;
  }
}

function unauthorized() {
  return NextResponse.json(
    { success: false, error: 'Oturum doğrulanamadı. Lütfen yeniden giriş yapın.' },
    { status: 401 },
  );
}

// Firestore Timestamp to Date converter
function convertTimestamp(timestamp: any): string | null {
  if (!timestamp) return null;
  if (timestamp._seconds !== undefined) {
    return new Date(timestamp._seconds * 1000).toISOString();
  }
  if (timestamp.toDate) {
    return timestamp.toDate().toISOString();
  }
  return null;
}

// Serialize fault report data
function serializeFaultReport(doc: FirebaseFirestore.DocumentSnapshot): any {
  const data = doc.data();
  if (!data) return null;

  return {
    id: doc.id,
    ...data,
    openedAt: convertTimestamp(data.openedAt),
    closedAt: convertTimestamp(data.closedAt),
    assignedAt: convertTimestamp(data.assignedAt),
    interventionStartedAt: convertTimestamp(data.interventionStartedAt),
    locationVerifiedAt: convertTimestamp(data.locationVerifiedAt),
    createdAt: convertTimestamp(data.createdAt),
  };
}

// Normalize status for legacy values
function normalizeStatus(status: string): string {
  if (status === 'open') return 'atama_bekliyor';
  if (status === 'closed') return 'cozuldu';
  return status;
}

function toUnixMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'number') return value;
  if (value._seconds !== undefined) return value._seconds * 1000;
  if (value.seconds !== undefined) return value.seconds * 1000;
  if (typeof value.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}

type LightRow = {
  id: string;
  status: string;
  openedAt: unknown;
  createdAt: unknown;
  labName: string;
  serial: string;
  openedByName: string;
  hospitalId: string;
  labId: string;
};

/**
 * Tenant-scoped, projeksiyonlu tarama. Tam doküman gövdeleri yalnız
 * sayfadaki satırlar için ayrıca okunur.
 */
async function scanLightRows(caller: CallerContext): Promise<LightRow[]> {
  const col = adminDb.collection('deviceFaultReports');
  const projected = (q: FirebaseFirestore.Query) =>
    q.select(...SCAN_PROJECTION).get();

  let snaps: FirebaseFirestore.QuerySnapshot[];
  if (caller.isSuperAdmin || caller.companyId === LEGACY_COMPANY_ID) {
    // Süperadmin her şeyi görür; legacy (tek-tenant) kurulumda zaten tüm
    // kayıtlar bu kullanıcının kapsamındadır.
    snaps = [await projected(col)];
  } else if (LEGACY_UNTAGGED_COMPAT) {
    // Untagged kayıtlar sorguyla seçilemediği için compat açıkken unscoped
    // projeksiyonlu tek tarama yapılır ve sunucuda scope filtrelenir.
    snaps = [await projected(col)];
  } else {
    snaps = await Promise.all([
      projected(col.where('companyId', '==', caller.companyId)),
      projected(col.where('companyId', '==', LEGACY_COMPANY_ID)),
    ]);
  }

  const rowsById = new Map<string, LightRow>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (rowsById.has(doc.id)) continue;
      const data = doc.data();
      if (!matchesCompanyScope(data, caller.companyId, caller.isSuperAdmin)) continue;
      rowsById.set(doc.id, {
        id: doc.id,
        status: typeof data.status === 'string' ? data.status : '',
        openedAt: data.openedAt ?? null,
        createdAt: data.createdAt ?? null,
        labName: typeof data.labName === 'string' ? data.labName : '',
        serial: typeof data.serial === 'string' ? data.serial : '',
        openedByName: typeof data.openedByName === 'string' ? data.openedByName : '',
        hospitalId: typeof data.hospitalId === 'string' ? data.hospitalId : '',
        labId: typeof data.labId === 'string' ? data.labId : '',
      });
    }
  }
  return Array.from(rowsById.values());
}

/** Sayfadaki id'lerin tam dokümanlarını chunk'lı getAll ile okur. */
async function fetchFullReports(ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const col = adminDb.collection('deviceFaultReports');
  const CHUNK = 300;
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const refs = ids.slice(i, i + CHUNK).map((id) => col.doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      const serialized = serializeFaultReport(snap);
      if (serialized) results.push(serialized);
    }
  }
  // getAll sırası korunur ama yine de id sırasına sabitle.
  const order = new Map(ids.map((id, idx) => [id, idx]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return results;
}

// GET handler - fetch fault reports with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCaller(request);
    if (!caller) return unauthorized();

    const { searchParams } = new URL(request.url);

    // UI filtreleri (meşru kullanıcı girdisi — yetkiyle ilgisi yok)
    const status = searchParams.get('status') || 'all';
    const lab = searchParams.get('lab') || 'all';
    const device = searchParams.get('device') || 'all';
    const opener = searchParams.get('opener') || 'all';

    // Pagination
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const exportAll = searchParams.get('all') === '1';

    const allRows = await scanLightRows(caller);

    // Lab-level filter: süperadmin/admin şirket içinde her şeyi görür; diğer
    // kullanıcılar yalnız SUNUCUDA kayıtlı atanmış laboratuvarlarını görür.
    const allowedLabs = new Set(caller.assignedLabIds);
    const scopedReports = (caller.isSuperAdmin || caller.isAdmin || allowedLabs.size === 0)
      ? allRows
      : allRows.filter((r) => {
          const candidate = r.hospitalId || r.labId || '';
          return candidate ? allowedLabs.has(candidate) : true;
        });

    // Keep newest reports first using openedAt, then createdAt fallback.
    scopedReports.sort((a, b) => {
      const aMs = toUnixMs(a.openedAt) || toUnixMs(a.createdAt);
      const bMs = toUnixMs(b.openedAt) || toUnixMs(b.createdAt);
      return bMs - aMs;
    });

    // Calculate status counts before filtering
    const statusCounts = {
      all: scopedReports.length,
      atama_bekliyor: 0,
      mudahale_bekliyor: 0,
      mudahale_ediliyor: 0,
      cozuldu: 0,
    };

    scopedReports.forEach((r) => {
      const normalized = normalizeStatus(r.status);
      if (normalized === 'atama_bekliyor') statusCounts.atama_bekliyor++;
      else if (normalized === 'mudahale_bekliyor') statusCounts.mudahale_bekliyor++;
      else if (normalized === 'mudahale_ediliyor') statusCounts.mudahale_ediliyor++;
      else if (normalized === 'cozuldu') statusCounts.cozuldu++;
    });

    // Extract unique filter options
    const uniqueLabs = [...new Set(scopedReports.map((r) => r.labName).filter(Boolean))];
    const uniqueDevices = [...new Set(scopedReports.map((r) => r.serial).filter(Boolean))];
    const uniqueOpeners = [...new Set(scopedReports.map((r) => r.openedByName).filter(Boolean))];

    // Apply filters
    let filteredReports = scopedReports;

    if (status !== 'all') {
      filteredReports = filteredReports.filter((r) => normalizeStatus(r.status) === status);
    }

    if (lab !== 'all') {
      filteredReports = filteredReports.filter((r) => r.labName === lab);
    }

    if (device !== 'all') {
      filteredReports = filteredReports.filter((r) => r.serial === device);
    }

    if (opener !== 'all') {
      filteredReports = filteredReports.filter((r) => r.openedByName === opener);
    }

    // Pagination — tam doküman gövdeleri yalnız bu sayfa için okunur.
    const totalFiltered = filteredReports.length;
    const totalPages = exportAll ? 1 : Math.ceil(totalFiltered / limit);
    const startIndex = (page - 1) * limit;
    const pageIds = exportAll
      ? filteredReports.map((r) => r.id)
      : filteredReports.slice(startIndex, startIndex + limit).map((r) => r.id);
    const paginatedReports = await fetchFullReports(pageIds);

    return NextResponse.json({
      success: true,
      data: paginatedReports,
      pagination: {
        page: exportAll ? 1 : page,
        limit: exportAll ? totalFiltered : limit,
        totalFiltered,
        totalPages,
      },
      statusCounts,
      filterOptions: {
        labs: uniqueLabs,
        devices: uniqueDevices,
        openers: uniqueOpeners,
      },
    });
  } catch (error: any) {
    console.error('Error fetching fault reports:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Arıza kayıtları alınamadı' },
      { status: 500 }
    );
  }
}

// DELETE handler - delete a fault report
export async function DELETE(request: NextRequest) {
  try {
    const caller = await resolveCaller(request);
    if (!caller) return unauthorized();
    if (!caller.isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Bu işlem için yönetici yetkisi gerekli.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('id');

    if (!reportId) {
      return NextResponse.json(
        { success: false, error: 'Rapor ID gerekli' },
        { status: 400 }
      );
    }

    const reportRef = adminDb.collection('deviceFaultReports').doc(reportId);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Arıza kaydı bulunamadı' },
        { status: 404 }
      );
    }
    const reportData = reportSnap.data() || {};
    if (!matchesCompanyScope(reportData, caller.companyId, caller.isSuperAdmin)) {
      return NextResponse.json(
        { success: false, error: 'Bu kayıt sizin şirket kapsamınızda değil.' },
        { status: 403 }
      );
    }
    const deviceId = typeof reportData.deviceId === 'string' ? reportData.deviceId : '';

    // Also delete any history subcollection documents
    const historySnapshot = await adminDb
      .collection('deviceFaultReports')
      .doc(reportId)
      .collection('history')
      .get();

    const batch = adminDb.batch();
    historySnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    batch.delete(reportRef);
    await batch.commit();

    // Keep devices collection consistent with arıza yönetimi:
    // if no open report remains for this device, clear arızaDurumu.
    if (deviceId) {
      const remainingOpenSnap = await adminDb
        .collection('deviceFaultReports')
        .where('deviceId', '==', deviceId)
        .where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
        .limit(1)
        .get();

      if (remainingOpenSnap.empty) {
        await adminDb.collection('devices').doc(deviceId).set({
          arizaDurumu: 'yok',
          arizaAciklamasi: '',
        }, { merge: true });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Arıza kaydı silindi',
    });
  } catch (error: any) {
    console.error('Error deleting fault report:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Arıza kaydı silinemedi' },
      { status: 500 }
    );
  }
}
