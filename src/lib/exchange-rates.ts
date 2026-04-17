import type { Currency } from '@/lib/types';

export type ExchangeRates = Record<Currency, number>;

const FREE_CURRENCY_API_KEY = process.env.NEXT_PUBLIC_FREECURRENCY_API_KEY || 'fca_live_OqvlK2t8iNDegmis9Mm5AS5I37g4GpBC5J05WkU6';
const FREE_CURRENCY_API_URL = 'https://api.freecurrencyapi.com/v1/latest';

export const EXCHANGE_RATES_CACHE_KEY = 'exchange_rates_cache';
export const EXCHANGE_RATES_CACHE_TTL = 1000 * 60 * 60; // 1 saat
export const EXCHANGE_RATES_FALLBACK: ExchangeRates = { EUR: 1, USD: 1.08, TRY: 38.5 };

function getTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchFromFreeCurrencyApi(): Promise<ExchangeRates> {
  const params = new URLSearchParams({
    base_currency: 'EUR',
    currencies: 'USD,TRY,CAD',
  });

  const res = await fetch(`${FREE_CURRENCY_API_URL}?${params.toString()}`, {
    headers: { apikey: FREE_CURRENCY_API_KEY },
  });

  if (!res.ok) {
    throw new Error(`FreeCurrencyAPI HTTP ${res.status}`);
  }

  const payload = await res.json();
  const data = payload?.data || {};
  const usd = Number(data.USD);
  const tryRate = Number(data.TRY);

  if (!Number.isFinite(usd) || !Number.isFinite(tryRate) || usd <= 0 || tryRate <= 0) {
    throw new Error('FreeCurrencyAPI response missing valid USD/TRY values');
  }

  return { EUR: 1, USD: usd, TRY: tryRate };
}

export async function getExchangeRates(options?: {
  cacheKey?: string;
  ttl?: number;
  useFallback?: boolean;
  forceRefresh?: boolean;
  cacheStrategy?: 'ttl' | 'daily';
  scopeKey?: string;
}): Promise<ExchangeRates> {
  const baseKey = options?.cacheKey || EXCHANGE_RATES_CACHE_KEY;
  const cacheStrategy = options?.cacheStrategy || 'daily';
  const scopeKey = options?.scopeKey ? `:${options.scopeKey}` : '';
  const cacheKey = cacheStrategy === 'daily'
    ? `${baseKey}:${getTodayKey()}${scopeKey}`
    : `${baseKey}${scopeKey}`;
  const ttl = options?.ttl ?? EXCHANGE_RATES_CACHE_TTL;
  const useFallback = options?.useFallback ?? true;
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { rates, data, timestamp } = JSON.parse(cached);
        const parsed = rates || data;
        if (!parsed) {
          // ignore
        } else if (cacheStrategy === 'daily') {
          return parsed as ExchangeRates;
        } else if (Date.now() - timestamp < ttl) {
          return parsed as ExchangeRates;
        }
      }
    } catch {
      // Cache parse hatasında canlı çağrıya düş
    }
  }

  try {
    const rates = await fetchFromFreeCurrencyApi();
    localStorage.setItem(cacheKey, JSON.stringify({ rates, timestamp: Date.now() }));
    return rates;
  } catch (error) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { rates, data } = JSON.parse(cached);
        const parsed = rates || data;
        if (parsed) return parsed as ExchangeRates;
      }
    } catch {
      // ignore
    }

    if (useFallback) return EXCHANGE_RATES_FALLBACK;
    throw error;
  }
}

export async function getTryRateForCurrency(
  currency: Currency,
  options?: { forceRefresh?: boolean; scopeKey?: string }
): Promise<number> {
  if (currency === 'TRY') return 1;

  const rates = await getExchangeRates({
    cacheStrategy: 'daily',
    forceRefresh: options?.forceRefresh,
    scopeKey: options?.scopeKey,
  });
  if (currency === 'EUR') return rates.TRY;
  if (currency === 'USD') return rates.TRY / rates.USD;

  return rates.TRY;
}
