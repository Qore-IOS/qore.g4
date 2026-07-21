/**
 * Anlık maliyet PDF raporu için veri modeli üreticisi.
 *
 * StockCostSnapshot'tan (byDepot + byLab, ürünlerde marka bilgisi var) genelden
 * detaya bir rapor modeli çıkarır: marka toplamları, lider marka vs diğerleri,
 * lokasyon kırılımı, lider markanın lokasyon/hastane dağılımı, treemap ve tablo.
 * Demodaki "Roche vs Non-Roche" mantığı burada "en büyük marka vs diğerleri"
 * olarak genelleştirilir.
 */
import type { StockCostSnapshot, CostLocationRow } from './cost-snapshot';

/** Kategorik palet (lider marka her zaman violet). RGB. */
export const REPORT_PALETTE: [number, number, number][] = [
  [45, 199, 166],  // teal
  [249, 128, 128], // coral
  [249, 180, 94],  // orange
  [91, 155, 240],  // blue
  [244, 143, 184], // pink
  [126, 208, 138], // green
  [123, 110, 246], // purple
  [96, 190, 214],  // cyan
  [230, 150, 110], // terracotta
];
export const ANCHOR_COLOR: [number, number, number] = [108, 92, 231]; // violet
export const OTHER_COLOR: [number, number, number] = [169, 166, 192];  // gray

export interface BrandAgg { brand: string; tryTotal: number; share: number; color: [number, number, number]; }
export interface NamedTotal { name: string; tryTotal: number; }
export interface ReportLocation { name: string; type: 'depo' | 'lab'; tryTotal: number; anchorTotal: number; restTotal: number; share: number; }
export interface TableRow { brand: string; mainLocation: string; tryTotal: number; share: number; color: [number, number, number]; muted?: boolean; }
export interface TreemapItem { brand: string; tryTotal: number; share: number; color: [number, number, number]; }

export interface CostReportModel {
  periodLabel: string;
  computedAt: string;
  totalTRY: number;
  brandCount: number;
  locationCount: number;

  anchorBrand: string;
  anchorTotal: number;
  anchorShare: number;   // 0..1
  restTotal: number;
  restShare: number;

  brands: BrandAgg[];           // tümü, azalan
  nonAnchorBrands: BrandAgg[];  // lider hariç, sıralama sayfası için (kuyruk "Diğer N")
  nonAnchorDiğer?: { count: number; tryTotal: number };

  anchorByLocation: NamedTotal[]; // lider markanın lokasyon kırılımı (sayfa 04)
  locations: ReportLocation[];    // stacked (sayfa 07), azalan
  anchorByHospital: NamedTotal[]; // lider markanın lab/hastane dağılımı (sayfa 08)

  treemap: TreemapItem[];
  tableRows: TableRow[];

  insightTitle: string;
  insightBody: string;

  prev?: { totalTRY: number; anchorShare: number; label: string } | null;
}

const rgb = (i: number): [number, number, number] => REPORT_PALETTE[i % REPORT_PALETTE.length];

function allLocations(snap: StockCostSnapshot): CostLocationRow[] {
  return [...(snap.byDepot || []), ...(snap.byLab || [])];
}

export function buildCostReportModel(snap: StockCostSnapshot, prev?: StockCostSnapshot | null): CostReportModel {
  const locs = allLocations(snap);
  const total = snap.totalTRY || locs.reduce((a, l) => a + l.tryTotal, 0) || 0;

  // marka toplamları
  const brandTotals = new Map<string, number>();
  const brandMainLoc = new Map<string, { name: string; v: number }>();
  locs.forEach((loc) => {
    loc.products.forEach((p) => {
      brandTotals.set(p.brand, (brandTotals.get(p.brand) || 0) + p.tryTotal);
      const cur = brandMainLoc.get(p.brand);
      if (!cur || p.tryTotal > cur.v) brandMainLoc.set(p.brand, { name: loc.name, v: p.tryTotal });
    });
  });

  const brandsSorted = Array.from(brandTotals.entries())
    .map(([brand, tryTotal]) => ({ brand, tryTotal }))
    .sort((a, b) => b.tryTotal - a.tryTotal);

  const anchor = brandsSorted[0] || { brand: '—', tryTotal: 0 };
  const anchorBrand = anchor.brand;
  const anchorTotal = anchor.tryTotal;
  const restTotal = Math.max(0, total - anchorTotal);

  // renkli marka listesi
  const brands: BrandAgg[] = brandsSorted.map((b, i) => ({
    brand: b.brand,
    tryTotal: b.tryTotal,
    share: total > 0 ? b.tryTotal / total : 0,
    color: b.brand === anchorBrand ? ANCHOR_COLOR : rgb(i - 1),
  }));

  // lider hariç sıralama (ilk 7 + "Diğer N")
  const nonAnchorAll = brands.filter((b) => b.brand !== anchorBrand);
  const TOP = 7;
  const nonAnchorBrands = nonAnchorAll.slice(0, TOP);
  const tail = nonAnchorAll.slice(TOP);
  const nonAnchorDiğer = tail.length
    ? { count: tail.length, tryTotal: tail.reduce((a, b) => a + b.tryTotal, 0) }
    : undefined;

  // lider markanın lokasyon kırılımı
  const anchorByLocMap = new Map<string, number>();
  locs.forEach((loc) => {
    const v = loc.products.filter((p) => p.brand === anchorBrand).reduce((a, p) => a + p.tryTotal, 0);
    if (v > 0) anchorByLocMap.set(loc.name, (anchorByLocMap.get(loc.name) || 0) + v);
  });
  const anchorByLocation = Array.from(anchorByLocMap.entries())
    .map(([name, tryTotal]) => ({ name, tryTotal }))
    .sort((a, b) => b.tryTotal - a.tryTotal)
    .slice(0, 6);

  // lokasyonlar — stacked (lider vs diğer)
  const locations: ReportLocation[] = locs
    .map((loc) => {
      const anchorV = loc.products.filter((p) => p.brand === anchorBrand).reduce((a, p) => a + p.tryTotal, 0);
      return {
        name: loc.name, type: loc.type, tryTotal: loc.tryTotal,
        anchorTotal: anchorV, restTotal: Math.max(0, loc.tryTotal - anchorV),
        share: total > 0 ? loc.tryTotal / total : 0,
      };
    })
    .sort((a, b) => b.tryTotal - a.tryTotal);

  // lider markanın lab/hastane dağılımı (sayfa 08)
  const anchorByHospital: NamedTotal[] = (snap.byLab || [])
    .map((loc) => ({ name: loc.name, tryTotal: loc.products.filter((p) => p.brand === anchorBrand).reduce((a, p) => a + p.tryTotal, 0) }))
    .filter((x) => x.tryTotal > 0)
    .sort((a, b) => b.tryTotal - a.tryTotal)
    .slice(0, 16);

  // treemap — ilk 8 marka + "Diğer N" (küçük dilimleri toplayarak, demodaki gibi)
  const TREE_TOP = 8;
  const treemap: TreemapItem[] = brands.slice(0, TREE_TOP).map((b) => ({ brand: b.brand, tryTotal: b.tryTotal, share: b.share, color: b.color }));
  const treeTail = brands.slice(TREE_TOP);
  if (treeTail.length) {
    treemap.push({
      brand: `Diğer ${treeTail.length}`,
      tryTotal: treeTail.reduce((a, b) => a + b.tryTotal, 0),
      share: treeTail.reduce((a, b) => a + b.share, 0),
      color: OTHER_COLOR,
    });
  }

  // tablo (ilk 8 + Diğer)
  const TABLE_TOP = 8;
  const tableRows: TableRow[] = brands.slice(0, TABLE_TOP).map((b) => ({
    brand: b.brand,
    mainLocation: brandMainLoc.get(b.brand)?.name || '—',
    tryTotal: b.tryTotal, share: b.share, color: b.color,
  }));
  const tableTail = brands.slice(TABLE_TOP);
  if (tableTail.length) {
    tableRows.push({
      brand: `Diğer ${tableTail.length} tedarikçi`,
      mainLocation: tableTail.slice(0, 5).map((b) => b.brand).join(', ') + (tableTail.length > 5 ? '…' : ''),
      tryTotal: tableTail.reduce((a, b) => a + b.tryTotal, 0),
      share: tableTail.reduce((a, b) => a + b.share, 0),
      color: OTHER_COLOR, muted: true,
    });
  }

  // yönetici özeti insight'ı
  const topLoc = locations[0];
  const insightTitle = topLoc && topLoc.share >= 0.4
    ? 'Maliyetin büyük kısmı tek noktada toplanıyor'
    : 'Maliyet lokasyonlara dağılmış durumda';
  const insightBody = topLoc
    ? `${topLoc.name} tek başına ${fmtM(topLoc.tryTotal)} (%${(topLoc.share * 100).toFixed(0)}) ile en büyük stok noktası; kalan maliyet diğer depo ve laboratuvarlara dağılıyor.`
    : 'Stok maliyeti verisi bulunamadı.';

  return {
    periodLabel: snap.forDate || '—',
    computedAt: snap.computedAt,
    totalTRY: total,
    brandCount: brands.length,
    locationCount: locs.length,
    anchorBrand,
    anchorTotal,
    anchorShare: total > 0 ? anchorTotal / total : 0,
    restTotal,
    restShare: total > 0 ? restTotal / total : 0,
    brands,
    nonAnchorBrands,
    nonAnchorDiğer,
    anchorByLocation,
    locations: locations.slice(0, 6),
    anchorByHospital,
    treemap,
    tableRows,
    insightTitle,
    insightBody,
    prev: prev ? { totalTRY: prev.totalTRY, anchorShare: prev.totalTRY > 0 ? (buildAnchorShare(prev)) : 0, label: prev.forDate } : null,
  };
}

function buildAnchorShare(snap: StockCostSnapshot): number {
  const locs = allLocations(snap);
  const total = snap.totalTRY || 0;
  const bt = new Map<string, number>();
  locs.forEach((l) => l.products.forEach((p) => bt.set(p.brand, (bt.get(p.brand) || 0) + p.tryTotal)));
  const top = Array.from(bt.values()).sort((a, b) => b - a)[0] || 0;
  return total > 0 ? top / total : 0;
}

/** 1.234.567 ₺ → "1,23 M ₺" gibi kısaltma */
export function fmtM(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M ₺`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ₺`;
  return `${Math.round(v).toLocaleString('tr-TR')} ₺`;
}
export function fmtFull(v: number): string {
  return `${Math.round(v).toLocaleString('tr-TR')} ₺`;
}
export function fmtPct(x: number): string {
  return `%${(x * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
