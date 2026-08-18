// src/lib/date.ts
import { Timestamp } from "firebase/firestore";
import type { TimestampLike } from "@/lib/types";
import { format as formatDateFns } from 'date-fns';

/** Firestore Timestamp gibi toDate() sunan objeler için type guard */
function hasToDate(v: any): v is { toDate: () => Date } {
  return v && typeof v === "object" && typeof v.toDate === "function";
}

/**
 * Metinsel tarihleri olası formatlarda parse eder (DD.MM.YYYY, DD/MM/YYYY,
 * YYYYMMDD, ISO/RFC).
 *
 * SIRA ÖNEMLİDİR — açık gün.ay.yıl kalıpları `new Date(str)`'den ÖNCE denenir.
 * Eskiden ilk deneme `new Date(str)` idi ve V8'in hoşgörülü ayrıştırıcısı
 * `"01.02.2027"` (1 Şubat 2027) değerini ABD kuralıyla **2 Ocak 2027** olarak
 * kabul ediyordu. Yani günü 12'den küçük her tarihte gün ile ay yer
 * değiştiriyordu: `"05.11.2026"` (5 Kasım) 11 Mayıs'a, altı ay erkene kayıyordu.
 * `depoStok.miad` alanı `normalizeMiad` ile tam olarak bu biçimde (`dd.MM.yyyy`
 * metni) yazıldığı için hata doğrudan miad gösterimini ve FEFO sıralamasını
 * bozuyordu. Açık kalıplar öne alınınca ISO metinleri (`2027-12-31`) yine son
 * çare `new Date(str)` ile çözülür — o kalıplar bu regexlere uymaz.
 */
function parseStringDate(s: string): Date | null {
  const str = s.trim();
  if (!str) return null;

  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY (Türkiye biçimi — gün önde)
  const trTarih = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
  const m = str.match(trTarih);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) {
      const dt = new Date(y, mo, d);
      // `new Date(2027, 1, 31)` 3 Mart'a taşar; taşan tarih geçersizdir.
      if (!isNaN(dt.getTime()) && dt.getDate() === d && dt.getMonth() === mo) return dt;
    }
    return null;
  }

  // YYYYMMDD
  const ymd = /^(\d{4})(\d{2})(\d{2})$/;
  const m2 = str.match(ymd);
  if (m2) {
    const y = parseInt(m2[1], 10);
    const mo = parseInt(m2[2], 10) - 1;
    const d = parseInt(m2[3], 10);
    const dt = new Date(y, mo, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ISO / RFC ve diğer motor tarafından tanınan biçimler
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;

  return null;
}

/**
 * Tüm olası tarih tiplerini güvenle Date'e çevirir.
 * Kabul ettiği tipler: string | number | Date | Firestore.Timestamp | null | undefined
 * number değerlerinde saniye/ms farkını otomatik algılar.
 */
export function toDateSafe(input: TimestampLike | null | undefined): Date | undefined {
  if (input == null) return undefined;

  // Date
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? undefined : new Date(input);
  }
  
  // Firestore Timestamp
  if (hasToDate(input)) {
    const d = input.toDate();
    return isNaN(d.getTime()) ? undefined : d;
  }


  // number: saniye/ms heuristiği
  if (typeof input === "number") {
    // < 10^12 ise genelde saniyedir
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // string
  if (typeof input === "string") {
    return parseStringDate(input) ?? undefined;
  }

  // bilinmeyen tip: son çare
  try {
    const maybe = new Date(String(input));
    return isNaN(maybe.getTime()) ? undefined : maybe;
  } catch {
    return undefined;
  }
}

/** Miad karşılaştırması — null/boş değerler listenin SONUNA gider (yani daha büyük sayılır). */
export function compareMiadAsc(a: TimestampLike | null | undefined, b: TimestampLike | null | undefined): number {
  const da = toDateSafe(a);
  const db = toDateSafe(b);
  if (!da && !db) return 0;
  if (!da) return 1; // a boşsa sona
  if (!db) return -1;
  return da.getTime() - db.getTime();
}

/** UI'da miadı güvenli ve tutarlı şekilde gösterir. */
export function formatMiad(
  input?: TimestampLike | null,
  fallback: string = "-"
): string {
  const d = toDateSafe(input);
  if (!d) return fallback;
  try {
    return formatDateFns(d, "dd.MM.yyyy");
  } catch {
    return fallback;
  }
}

// backward compatibility alias
export const toDateFromAny = (v: TimestampLike) => toDateSafe(v);
export const formatTimestamp = (value: TimestampLike, fmt = 'dd.MM.yyyy') => {
    const dt = toDateSafe(value);
    return dt ? formatDateFns(dt, fmt) : null;
};
export const parseMiad = (v: TimestampLike) => toDateSafe(v);
export const safeCompareByMiad = compareMiadAsc;

/**
 * Miad string'ini DD.MM.YYYY formatına normalize eder.
 * Kabul edilen formatlar: YYMMDD, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
 */
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

export function normalizeMiad(input: string): string {
  const raw = (input || '').trim();

  if (/^\d{6}$/.test(raw)) {
    const yy = parseInt(raw.slice(0, 2), 10);
    const mm = parseInt(raw.slice(2, 4), 10);
    const dd = parseInt(raw.slice(4, 6), 10);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${pad(dd)}.${pad(mm)}.${yyyy}`;
  }

  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) {
    const [d, m, y] = raw.replace(/-/g, '.').replace(/\//g, '.').split('.');
    const yyyy = (y.length === 2) ? (parseInt(y, 10) >= 70 ? `19${y}` : `20${y}`) : y;
    return `${pad(parseInt(d, 10))}.${pad(parseInt(m, 10))}.${yyyy}`;
  }

  return raw;
}
