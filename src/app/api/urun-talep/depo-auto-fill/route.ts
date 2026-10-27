import type * as DocumentStore from '../../../../lib/data/admin';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../../lib/data/admin';
import { normalizeCompanyId } from '@/lib/company-scope';

const STOCK_CODE_CHUNK_SIZE = 30;

type MinMaxRuleForAutoFill = {
  stokKodu: string;
  min?: number;
  max?: number;
  maxGun?: number;
  stokAdi?: string;
};

type AutoFillItem = {
  id: string;
  stokKodu: string;
  stokAdi: string;
  urunGrubu?: string;
  adet: number;
  explanation: string;
};

type ProductMetaForAutoFill = {
  id: string;
  stokAdi: string;
  urunGrubu?: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseStockExpiryDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object' && value !== null) {
    const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds ?? (value as { _seconds?: unknown })._seconds;
    if (typeof seconds === 'number') {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const turkishDate = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (turkishDate) {
      const [, day, month, year] = turkishDate;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function daysUntilStockExpiry(value: unknown): number | null {
  const expiryDate = parseStockExpiryDate(value);
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // audit-miad: guvenli — `expiryDate` zaten `Date`; bu bir kopya, metin ayrıştırma değil.
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isMissingIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('FAILED_PRECONDITION') || message.toLowerCase().includes('index');
}

async function fetchDepotRules(depotId: string): Promise<MinMaxRuleForAutoFill[]> {
  const rulesSnap = await adminDb.collection('depots').doc(depotId).collection('minMaxRules').get();
  return rulesSnap.docs
    .map((doc) => ({ stokKodu: doc.id, ...doc.data() } as MinMaxRuleForAutoFill))
    .filter((rule) => String(rule.stokKodu || '').trim() && (Number(rule.max) || 0) > 0);
}

async function fetchProductNames(stokKodlari: string[]): Promise<Map<string, ProductMetaForAutoFill>> {
  const productByCode = new Map<string, ProductMetaForAutoFill>();
  await Promise.all(chunkArray(stokKodlari, STOCK_CODE_CHUNK_SIZE).map(async (codes) => {
    const snap = await adminDb.collection('productCodes').where('stokKodu', 'in', codes).get();
    snap.docs.forEach((doc) => {
      const data = doc.data();
      const stokKodu = String(data.stokKodu || '').trim();
      if (stokKodu && !productByCode.has(stokKodu)) {
        productByCode.set(stokKodu, {
          id: doc.id,
          stokAdi: data.stokAdi || stokKodu,
          urunGrubu: typeof data.urunGrubu === 'string' ? data.urunGrubu : undefined,
        });
      }
    });
  }));
  return productByCode;
}

async function fetchIndexedDepotStockDocs(params: {
  depotId: string;
  stokKodlari: string[];
  companyId: string;
  isSuperAdmin: boolean;
}): Promise<DocumentStore.QueryDocumentSnapshot[]> {
  const { depotId, stokKodlari, companyId, isSuperAdmin } = params;
  const codeChunks = chunkArray(stokKodlari, STOCK_CODE_CHUNK_SIZE);
  const companyScopes = !isSuperAdmin && companyId !== '__legacy__' ? [companyId, '__legacy__'] : [null];
  const snapshots = await Promise.all(companyScopes.flatMap((companyScope) => codeChunks.map((codes) => {
    let query: DocumentStore.Query = adminDb.collection('depoStok')
      .where('depotId', '==', depotId)
      .where('isShipped', '==', false)
      .where('stokKodu', 'in', codes);
    if (companyScope) query = query.where('companyId', '==', companyScope);
    return query.get();
  })));

  const docsById = new Map<string, DocumentStore.QueryDocumentSnapshot>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => docsById.set(doc.id, doc));
  });
  return Array.from(docsById.values());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const depotId = String(body.depotId || '').trim();
    const hedefIsGunu = Math.ceil(Number(body.hedefIsGunu));
    const urunGrubu = String(body.urunGrubu || 'all').trim();
    const isSuperAdmin = body.isSuperAdmin === true;
    const companyId = normalizeCompanyId(body.companyId);

    if (!depotId) return NextResponse.json({ ok: false, error: 'depotId zorunludur.' }, { status: 400 });
    if (!Number.isFinite(hedefIsGunu) || hedefIsGunu <= 0) {
      return NextResponse.json({ ok: false, error: 'Hedef iş günü 1 veya daha büyük olmalıdır.' }, { status: 400 });
    }

    const rules = await fetchDepotRules(depotId);
    const stokKodlari = Array.from(new Set(rules.map((rule) => String(rule.stokKodu || '').trim()).filter(Boolean)));
    if (stokKodlari.length === 0) {
      return NextResponse.json({ ok: true, items: [], explanations: {}, totalNeeded: 0, itemCount: 0 });
    }

    const productByCode = await fetchProductNames(stokKodlari);
    const filteredRules = urunGrubu === 'all'
      ? rules
      : rules.filter((rule) => productByCode.get(String(rule.stokKodu || '').trim())?.urunGrubu === urunGrubu);
    const wantedCodes = new Set(filteredRules.map((rule) => String(rule.stokKodu || '').trim()).filter(Boolean));
    if (wantedCodes.size === 0) {
      return NextResponse.json({ ok: true, items: [], explanations: {}, totalNeeded: 0, itemCount: 0, indexed: true });
    }

    let stockDocs: DocumentStore.QueryDocumentSnapshot[] = [];
    try {
      stockDocs = await fetchIndexedDepotStockDocs({ depotId, stokKodlari: Array.from(wantedCodes), companyId, isSuperAdmin });
    } catch (error) {
      if (isMissingIndexError(error)) {
        return NextResponse.json({
          ok: false,
          error: 'Depo talep hesaplaması için zorunlu Firestore index eksik. Lütfen depoStok için depotId + isShipped + stokKodu + companyId indeksini oluşturup tekrar deneyin.',
        }, { status: 412 });
      }
      throw error;
    }

    const usableStockByCode = new Map<string, number>();
    const soonExpiringStockByCode = new Map<string, number>();

    for (const doc of stockDocs) {
      const data = doc.data();
      const stokKodu = String(data.stokKodu || '').trim();
      if (!stokKodu || !wantedCodes.has(stokKodu)) continue;
      const qty = Math.max(1, Number(data.adet) || 1);
      const expiryDays = daysUntilStockExpiry(data.miad);
      const targetMap = typeof expiryDays === 'number' && expiryDays < 30 ? soonExpiringStockByCode : usableStockByCode;
      targetMap.set(stokKodu, (targetMap.get(stokKodu) || 0) + qty);
    }

    const items: AutoFillItem[] = [];
    const explanations: Record<string, string> = {};
    for (const rule of filteredRules) {
      const stokKodu = String(rule.stokKodu || '').trim();
      const maxAdet = Number(rule.max) || 0;
      const maxGun = Number(rule.maxGun) || 0;
      const hedefAdet = maxGun > 0 ? Math.ceil((hedefIsGunu / maxGun) * maxAdet) : maxAdet;
      const kullanilabilirStok = usableStockByCode.get(stokKodu) || 0;
      const yaklasanMiadStok = soonExpiringStockByCode.get(stokKodu) || 0;
      const ihtiyacAdet = Math.max(0, hedefAdet - kullanilabilirStok);
      if (ihtiyacAdet <= 0) continue;

      const product = productByCode.get(stokKodu);
      const explanation = maxGun > 0
        ? `${maxAdet} adet / ${maxGun} iş günü tanımından ${hedefIsGunu} iş günü için hedef ${hedefAdet} adet hesaplandı. Kullanılabilir stok ${kullanilabilirStok} adet.${yaklasanMiadStok > 0 ? ` Miadına 30 günden az kalan ${yaklasanMiadStok} adet stoğa dahil edilmedi.` : ''}`
        : `Max gün tanımı olmadığı için hedef ${hedefAdet} adet kabul edildi. Kullanılabilir stok ${kullanilabilirStok} adet.${yaklasanMiadStok > 0 ? ` Miadına 30 günden az kalan ${yaklasanMiadStok} adet stoğa dahil edilmedi.` : ''}`;
      explanations[stokKodu] = explanation;
      items.push({
        id: product?.id || stokKodu,
        stokKodu,
        stokAdi: product?.stokAdi || rule.stokAdi || stokKodu,
        urunGrubu: product?.urunGrubu,
        adet: ihtiyacAdet,
        explanation,
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      explanations,
      itemCount: items.length,
      totalNeeded: items.reduce((sum, item) => sum + item.adet, 0),
      indexed: true,
    });
  } catch (error) {
    console.error('Depot auto-fill API failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Depo talep hesaplaması yapılamadı.' }, { status: 500 });
  }
}
