
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { BarcodeFormat, ProductCode, ParsedResult } from './types';
import { where, type QueryConstraint, type WhereFilterOp } from 'firebase/firestore';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Wraps Firestore where() to guard against undefined/null/empty values.
 * Throws an Error if value is invalid.
 */
export function safeWhere<T>(
  field: keyof T,
  op: WhereFilterOp,
  value: any
): QueryConstraint {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Invalid query value for field "${String(field)}": ${value}`);
  }
  return where(String(field) as string, op, value);
}

/**
 * Remove GS1 group separators (ASCII 29) and any whitespace
 * from a raw scanned barcode string.
 */
export function sanitizeGS1(raw: string): string {
  // The character is \u001D in unicode.
  return raw.replace(/[\u001D\s]/g, '');
}

/**
 * Validate that the cleaned barcode is exactly 61 digits.
 */
export function isValid61Digits(code: string): boolean {
  return /^\d{61}$/.test(code);
}


/**
 * Parses a fixed 61-char Roche QR code.
 * Returns null if the barcode is not 61 characters long.
 * - chars 19–24 (0-based 18-24): yy (year), aa (month), gg (day) → dd.MM.yyyy
 * - chars 27–34 (0-based 26-34): lot number
 * - chars 37–48 (0-based 36-48): serial number
 * - chars 51–61 (0-based 50-61): reference number
 */
export function parseBarcode(barcode: string): ParsedResult | null {
  if (barcode.length !== 61) {
    return null;
  }
  
  try {
    // Expiry: positions 18–24 (0-based)
    const expRaw = barcode.slice(18, 24);    // yyaagg
    const yy = expRaw.slice(0, 2);
    const aa = expRaw.slice(2, 4);
    const gg = expRaw.slice(4, 6);
    const miad = `${gg}.${aa}.20${yy}`;      // dd.MM.yyyy

    // Lot: positions 26–34
    const lotNumarasi = barcode.slice(26, 34);

    // Serial: positions 36–48
    const seriNumarasi = barcode.slice(36, 48);

    // Reference: positions 50–61
    const refNo = barcode.slice(50, 61);

    return { miadFormatted: miad, lotNumarasi, seriNumarasi, refNo };
  } catch (e) {
    console.error("Error parsing fixed barcode:", e);
    return null;
  }
}



// Tarih formatlama (yymmdd -> dd.mm.yyyy)
export function formatDateYYMMDDtoDDMMYYYY(yymmdd: string): string {
  if (yymmdd.length !== 6) return "Geçersiz Tarih";
  const yy = yymmdd.substring(0, 2);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  const currentYear = new Date().getFullYear().toString().substring(2,4);
  const century = parseInt(yy) <= parseInt(currentYear) + 10 ? '20' : '19';
  return `${dd}.${mm}.${century}${yy}`; 
}

// Genel tarih formatlama (Date -> dd.mm.yyyy)
export function formatDateToDDMMYYYY(date: Date | undefined | null): string {
  if (!date) return "";
  try {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        // Attempt to parse if it's a string representation of a date
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) return "Geçersiz Tarih";
        date = parsedDate;
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Aylar 0-indexed
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  } catch (e) {
    return "Geçersiz Tarih";
  }
}

// Excel export related functions
export function exportDataToExcel(data: any[] | Record<string, any[]>, fileName: string, toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void): void;
export function exportDataToExcel(data: any[] | Record<string, any[]>, fileName: string, sheetName: string, toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void): void;
export function exportDataToExcel(
  data: any[] | Record<string, any[]>,
  fileName: string,
  arg3: any, // Can be sheetName or toastFn
  arg4?: any // Can be toastFn or undefined
) {
  let sheetName: string;
  let toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;

  if (typeof arg3 === 'string') {
    sheetName = arg3;
    toastFn = arg4;
  } else {
    sheetName = 'Sheet1';
    toastFn = arg3;
  }
  
  try {
    import('xlsx').then(XLSX => {
      const workbook = XLSX.utils.book_new();
      
      if (Array.isArray(data)) {
        // Handle single sheet export
        const worksheet = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      } else {
        // Handle multi-sheet export
        for (const [name, sheetData] of Object.entries(data)) {
          if (Array.isArray(sheetData)) {
            const worksheet = XLSX.utils.json_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, worksheet, name.substring(0, 31)); // Sheet names have a 31-char limit
          }
        }
      }

      if (workbook.SheetNames.length === 0) {
        toastFn({ title: "Veri Yok", description: "Dışa aktarılacak veri bulunamadı.", variant: "default" });
        return;
      }

      const safeFileName = fileName.replace(/[^a-z0-9_]/gi, '_');
      XLSX.writeFile(workbook, `${safeFileName}_${new Date().toLocaleDateString('tr-TR', {day:'2-digit', month: '2-digit', year:'numeric'}).replace(/\./g, '-')}.xlsx`);
      toastFn({ title: "Başarılı", description: `${fileName} başarıyla Excel'e aktarıldı.` });
    }).catch(error => {
      console.error("Excel export error (dynamic import):", error);
      toastFn({ title: "Hata", description: "Excel'e aktarılırken bir sorun oluştu. 'xlsx' kütüphanesi yüklenemedi.", variant: "destructive" });
    });
  } catch (error) {
    console.error("Excel export error:", error);
    toastFn({ title: "Hata", description: "Excel'e aktarılırken bir sorun oluştu.", variant: "destructive" });
  }
}

export function readExcelData(file: File, toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          import('xlsx').then(XLSX => {
            const data = event.target?.result;
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Try to find a sheet with a more specific name first
            const sheetPriority = ['Urunler', 'Yeni Urunler', 'Products', 'Sheet1'];
            const targetSheetName = sheetPriority.find(name => workbook.SheetNames.includes(name)) || workbook.SheetNames[0];
            
            if (!targetSheetName) {
              toastFn({ title: 'Sayfa Bulunamadı', description: "Excel dosyasında okunacak bir sayfa bulunamadı.", variant: 'destructive' });
              reject(new Error("No sheets found in Excel file."));
              return;
            }
  
            const worksheet = workbook.Sheets[targetSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'dd.mm.yyyy' });
            resolve(jsonData);
          }).catch(error => {
            console.error("Excel import error (dynamic import):", error);
            toastFn({ title: "Hata", description: "Excel dosyası okunurken bir sorun oluştu. 'xlsx' kütüphanesi yüklenemedi.", variant: "destructive" });
            reject(error);
          });
        } catch (e) {
          console.error("Excel read error:", e);
          toastFn({ title: "Hata", description: "Excel dosyası okunurken bir sorun oluştu.", variant: "destructive" });
          reject(e);
        }
      };
      reader.onerror = (error) => {
          toastFn({ title: "Hata", description: "Dosya okuma hatası.", variant: "destructive" });
          reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }

const flattenObject = (obj: any, prefix = ''): any => {
    if (obj === null || obj === undefined) return {};
    return Object.keys(obj).reduce((acc, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        const value = obj[k];
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value.toDate && typeof value.toDate === 'function')) {
            Object.assign(acc, flattenObject(value, pre + k));
        } else if (Array.isArray(value)) {
            acc[pre + k] = JSON.stringify(value);
        } else if (value?.toDate && typeof value.toDate === 'function') {
            // Handle Firestore Timestamps
            acc[pre + k] = value.toDate().toISOString();
        } else if (value instanceof Date) {
            acc[pre + k] = value.toISOString();
        } else {
            acc[pre + k] = value;
        }
        return acc;
    }, {} as Record<string, any>);
};

export function exportAllDataToCSV(data: Record<string, any[]>, fileName: string, toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void) {
    try {
        import('xlsx').then(XLSX => {
            const workbook = XLSX.utils.book_new();

            for (const sheetName in data) {
                if (data[sheetName] && data[sheetName].length > 0) {
                    const flattenedData = data[sheetName].map(item => flattenObject(item));
                    const worksheet = XLSX.utils.json_to_sheet(flattenedData);
                    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
                }
            }

            if (workbook.SheetNames.length === 0) {
                toastFn({ title: "Veri Yok", description: "Dışa aktarılacak veri bulunamadı.", variant: "default" });
                return;
            }
            
            const safeFileName = fileName.replace(/[^a-z0-9_]/gi, '_');
            XLSX.writeFile(workbook, `${safeFileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
            toastFn({ title: "Başarılı", description: "Tüm veriler çok sayfalı Excel dosyası olarak dışa aktarıldı." });
        }).catch(error => {
            console.error("CSV/Excel export error:", error);
            toastFn({ title: "Hata", description: "Excel'e aktarılırken bir sorun oluştu.", variant: "destructive" });
        });
    } catch(e) {
        console.error("General export error", e);
        toastFn({ title: "Hata", description: "Veri dışa aktarılırken beklenmedik bir hata oluştu.", variant: "destructive" });
    }
}

export function exportAllDataToJSON(data: Record<string, any[]>, fileName: string, toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void) {
    try {
        const jsonString = JSON.stringify(data, (key, value) => {
            if (value && typeof value === 'object' && value.toDate && typeof value.toDate === 'function') {
                return value.toDate().toISOString();
            }
            if (value instanceof Date) {
                return value.toISOString();
            }
            return value;
        }, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastFn({ title: "Başarılı", description: "Tüm veriler JSON olarak dışa aktarıldı." });
    } catch (e) {
        console.error("JSON export error", e);
        toastFn({ title: "Hata", description: "Veri JSON'a aktarılırken beklenmedik bir hata oluştu.", variant: "destructive" });
    }
}

// Preloaded notification sound for instant playback
let notificationAudio: HTMLAudioElement | null = null;

const getNotificationAudio = () => {
  if (typeof window === 'undefined') return null;
  if (!notificationAudio) {
    notificationAudio = new Audio('/notif.wav');
    notificationAudio.volume = 0.5;
    notificationAudio.preload = 'auto';
  }
  return notificationAudio;
};

// Preload on first import (client-side only)
if (typeof window !== 'undefined') {
  getNotificationAudio();
}

export const playNotificationSound = () => {
  if (typeof window === 'undefined') return;
  const audio = getNotificationAudio();
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Ignore autoplay errors (user hasn't interacted yet)
    });
  }
};

export const playFeedback = (isError = false) => {
  if (typeof window === 'undefined') return;
  if (navigator.vibrate) navigator.vibrate(isError ? [200, 100, 200] : 100);

  // Play custom notification sound for success, oscillator beep for error
  if (!isError) {
    playNotificationSound();
    return;
  }

  // Error sound - use oscillator beep
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(220, ctx.currentTime);
    oscillator.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  } catch {
    // fallback silently if sound is not supported
  }
};


function replaceTurkishChars(str: string): string {
  if (!str) return '';
  const map: { [key: string]: string } = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
  };
  return str.replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => map[char]);
};

export type ExcelContext = 'product' | 'address' | 'hospital';

function normalizeHeaderKey(h: string): string {
  if (!h) return '';
  const map: Record<string, string> = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u'
  };
  return String(h)
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => map[ch])
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

function sheetNameCandidatesFor(context: ExcelContext): string[] {
  switch (context) {
    case 'product':
      return ['urunler','ürünler','products','yeniurunler','yeniürünler','urunkodlari','urun-kodlari','productcodes'];
    case 'address':
      return ['adresler','adres','adres-tanimlari','adres tanimlari','address','addressdefinitions'];
    case 'hospital':
      return ['hastaneler','hastane','hospitals'];
    default:
      return [];
  }
}

function hasExpectedHeaders(headers: string[], expectedAnyOf: string[]): boolean {
  const set = new Set(headers.map(normalizeHeaderKey));
  return expectedAnyOf.some(k => set.has(k));
}

/**
 * Smarter Excel reader:
 *  - Picks worksheet by (normalized) name first,
 *  - Else scans worksheets and picks the one whose header row has expected fields,
 *  - Falls back to the first sheet.
 * Keeps the same JSON shape as readExcelData.
 */
export async function readExcelDataSmart(
  file: File,
  context: ExcelContext,
  toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });

        const normalized = workbook.SheetNames.map(n => ({ raw: n, norm: normalizeHeaderKey(n) }));
        const wanted = sheetNameCandidatesFor(context);
        let targetSheet = normalized.find(s => wanted.includes(s.norm))?.raw;

        const EXPECTED: Record<ExcelContext, string[]> = {
          product: ['stokkodu','stokadi','stokadı'],
          address: ['adresbarkodu','adresadi','adresadı'],
          hospital: ['hastaneadi','hastaneadı']
        };

        if (!targetSheet) {
          for (const s of workbook.SheetNames) {
            const headerRow = XLSX.utils.sheet_to_json(workbook.Sheets[s], { header: 1 })[0] || [];
            const headers = (headerRow as any[]).map(h => normalizeHeaderKey(h as any));
            if (hasExpectedHeaders(headers, EXPECTED[context])) {
              targetSheet = s;
              break;
            }
          }
        }
        if (!targetSheet) targetSheet = workbook.SheetNames[0];
        
        if (!targetSheet) {
          toastFn({ title: 'Sayfa Bulunamadı', description: "Excel dosyasında okunacak bir sayfa bulunamadı.", variant: 'destructive' });
          reject(new Error("No sheets found in Excel file."));
          return;
        }

        const worksheet = workbook.Sheets[targetSheet];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'dd.mm.yyyy' });
        resolve(jsonData);
      } catch (error) {
        console.error("Excel import error (smart):", error);
        toastFn({ title: "Excel Hatası", description: "Excel dosyası okunamadı veya uyumsuz.", variant: "destructive" });
        reject(error);
      }
    };
    reader.onerror = (error) => {
      toastFn({ title: "Hata", description: "Dosya okuma hatası.", variant: "destructive" });
      reject(error);
    };
    reader.readAsArrayBuffer(file);
  });
}
