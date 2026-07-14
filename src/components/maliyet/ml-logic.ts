'use client';

import type { ProductCode, MinMaxRule } from '@/lib/types';

export type LocationType = 'lab' | 'depot';

export interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: string;       // string to allow empty input
  cihazUstuAdedi: string;  // string to allow empty input
  counted: boolean;
}

export interface CostByCurrency { TRY: number; EUR: number; USD: number; }

export interface BrandProgress {
  brand: string;
  total: number;
  completed: number;
  status: 'idle' | 'in_progress' | 'completed';
  costs: CostByCurrency;
}

/* Per-product cost — EXACT formula from the existing panel (calcProductCost).
   ambalaj = ambalajDegeri||1; toplamTest = stokAdedi*ambalaj + cihazUstuAdedi;
   amount = (cost/ambalaj) * toplamTest; currency = product.currency||'TRY'. */
export function calcProductCost(product: ProductCode, entry?: ProductCountEntry): { amount: number; currency: string } {
  const currency = (product.currency as string) || 'TRY';
  if (!entry || !product.cost) return { amount: 0, currency };
  const ambalaj = product.ambalajDegeri || 1;
  const stokNum = parseInt(entry.stokAdedi, 10) || 0;
  const cihazNum = parseInt(entry.cihazUstuAdedi, 10) || 0;
  const toplamTest = stokNum * ambalaj + cihazNum;
  if (toplamTest <= 0) return { amount: 0, currency };
  return { amount: (product.cost / ambalaj) * toplamTest, currency };
}

export function productTotalTests(product: ProductCode, entry?: ProductCountEntry): number {
  if (!entry) return 0;
  const ambalaj = product.ambalajDegeri || 1;
  const stokNum = parseInt(entry.stokAdedi, 10) || 0;
  const cihazNum = parseInt(entry.cihazUstuAdedi, 10) || 0;
  return stokNum * ambalaj + cihazNum;
}

/* Multi-currency label — 'N€ + N$ + N₺' (EUR,USD,TRY order, tr-TR, 0 decimals). '' if all zero. */
export function formatCosts(costs: CostByCurrency): string {
  const parts: string[] = [];
  const f = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
  if (costs.EUR > 0) parts.push(`${f(costs.EUR)}€`);
  if (costs.USD > 0) parts.push(`${f(costs.USD)}$`);
  if (costs.TRY > 0) parts.push(`${f(costs.TRY)}₺`);
  return parts.join(' + ');
}

export const currencySymbol = (c?: string) => (c === 'EUR' ? '€' : c === 'USD' ? '$' : '₺');

/* Brands = distinct marka of products whose stokKodu is in the location's min/max rules. */
export function getBrandsFromRules(minMaxRules: MinMaxRule[], productCodes: ProductCode[]): string[] {
  if (!minMaxRules || minMaxRules.length === 0) return [];
  const set = new Set(minMaxRules.map(r => r.stokKodu));
  const brands = new Set<string>();
  productCodes.forEach(p => { if (set.has(p.stokKodu) && p.marka) brands.add(p.marka); });
  return Array.from(brands).sort((a, b) => a.localeCompare(b, 'tr'));
}

export function getProductsForBrandFromRules(brand: string, minMaxRules: MinMaxRule[], productCodes: ProductCode[]): ProductCode[] {
  if (!minMaxRules || minMaxRules.length === 0) return [];
  const set = new Set(minMaxRules.map(r => r.stokKodu));
  return productCodes
    .filter(p => p.marka === brand && set.has(p.stokKodu))
    .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || '', 'tr'));
}

export function normalizeText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const urunGrubuLabel = (g?: string) => (g === 'kit' ? 'Kit' : g === 'sarf' ? 'Sarf' : g === 'yedek_parca' ? 'Yedek Parça' : '');
