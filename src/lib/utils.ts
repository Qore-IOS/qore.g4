
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
 * Normalizes different scanner representations of GS1 Group Separator (ASCII 29)
 * into the canonical \u001D control character.
 *
 * Some scanners may emit GS as:
 * - literal control char: \u001D
 * - visible control picture: ␝ (U+241D)
 * - escaped tokens: "<GS>", "[GS]", "{GS}", "FNC1", "<FNC1>", "\\x1D", "\\u001D"
 *
 * This keeps parsing stable across fast/slow scanners that encode FNC1 differently.
 */
export function normalizeGS1GroupSeparators(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  return raw
    .replace(/\u241D/g, '\u001D')
    .replace(/\\x1d/gi, '\u001D')
    .replace(/\\u001d/gi, '\u001D')
    .replace(/<\s*GS\s*>/gi, '\u001D')
    .replace(/\[\s*GS\s*\]/gi, '\u001D')
    .replace(/\{\s*GS\s*\}/gi, '\u001D')
    .replace(/<\s*FNC1\s*>/gi, '\u001D')
    .replace(/\[\s*FNC1\s*\]/gi, '\u001D')
    .replace(/\{\s*FNC1\s*\}/gi, '\u001D')
    .replace(/\bFNC1\b/gi, '\u001D');
}

/**
 * Remove normalized GS1 separators and any whitespace from a raw scanned barcode string.
 */
export function sanitizeGS1(raw: string): string {
  return normalizeGS1GroupSeparators(raw).replace(/[\u001D\s]/g, '');
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

// Turkish font cache for PDF export
let turkishFontBase64ForPdf: string | null = null;

async function loadTurkishFontForPdf(): Promise<string | null> {
  if (turkishFontBase64ForPdf) return turkishFontBase64ForPdf;

  try {
    const fontUrl = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf';
    const response = await fetch(fontUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        turkishFontBase64ForPdf = result.split(',')[1];
        resolve(turkishFontBase64ForPdf);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Could not load Turkish font:', e);
    return null;
  }
}

function sanitizeTurkishForPdf(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}

function pdfText(str: string | null | undefined, useTurkish: boolean): string {
  if (!str) return '';
  return useTurkish ? str : sanitizeTurkishForPdf(str);
}

/**
 * Export data to PDF in landscape orientation with all columns.
 * Creates a plain white PDF with tabular data spanning multiple pages.
 */
export async function exportDataToPdf(
  data: Record<string, any>[],
  fileName: string,
  title: string,
  toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void
): Promise<void> {
  if (!data || data.length === 0) {
    toastFn({ title: "Veri Yok", description: "Disa aktarilacak veri bulunamadi.", variant: "default" });
    return;
  }

  try {
    const [jsPDFModule, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);
    const jsPDF = jsPDFModule.default;
    const autoTable = autoTableModule.default;

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const padX = 30;
    const padY = 30;

    // Try to load Turkish font
    const fontBase64 = await loadTurkishFontForPdf();
    let useTurkish = false;
    const FALLBACK_FONT = 'helvetica';
    let FONT = FALLBACK_FONT;

    if (fontBase64) {
      try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        FONT = 'NotoSans';
        useTurkish = true;
      } catch (e) {
        console.error('Could not setup Turkish font:', e);
      }
    }

    doc.setFont(FONT);

    // Get headers from first data object
    const headers = Object.keys(data[0]);

    // Convert data to rows
    const rows = data.map(item =>
      headers.map(header => {
        const value = item[header];
        if (value === null || value === undefined) return '';
        return pdfText(String(value), useTurkish);
      })
    );

    // Process headers for display
    const displayHeaders = headers.map(h => pdfText(h, useTurkish));

    // Calculate column widths based on content
    const availableWidth = pageW - (padX * 2);
    const numColumns = headers.length;

    // Set base column width, but limit minimum width
    const baseColWidth = Math.max(availableWidth / numColumns, 35);

    autoTable(doc, {
      head: [displayHeaders],
      body: rows,
      startY: padY + 25,
      theme: 'grid',
      styles: {
        font: FONT,
        fontSize: 6,
        cellPadding: 3,
        overflow: 'linebreak',
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [60, 60, 60],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6,
        halign: 'center',
      },
      bodyStyles: {
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      margin: { left: padX, right: padX, top: padY + 25, bottom: padY },
      tableWidth: 'auto',
      didDrawPage: (data) => {
        // Header on each page
        doc.setFont(FONT, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text(pdfText(title, useTurkish), padX, padY + 10);

        // Date on right
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        const dateStr = new Date().toLocaleDateString('tr-TR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        doc.text(dateStr, pageW - padX, padY + 10, { align: 'right' });

        // Page number at footer
        const pageNumber = doc.getCurrentPageInfo().pageNumber;
        const totalPages = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.text(
          `Sayfa ${pageNumber}`,
          pageW / 2,
          pageH - 15,
          { align: 'center' }
        );
      },
    });

    const safeFileName = fileName.replace(/[^a-z0-9_]/gi, '_');
    const dateStr = new Date().toLocaleDateString('tr-TR', {day:'2-digit', month: '2-digit', year:'numeric'}).replace(/\./g, '-');
    doc.save(`${safeFileName}_${dateStr}.pdf`);

    toastFn({ title: "Basarili", description: `${fileName} basariyla PDF olarak disari aktarildi.` });
  } catch (error) {
    console.error("PDF export error:", error);
    toastFn({ title: "Hata", description: "PDF'e aktarilirken bir sorun olustu.", variant: "destructive" });
  }
}

/**
 * Export personnel performance data to PDF - one person per landscape page.
 * Each page contains the person's name, role, all metrics and scores.
 */
export async function exportPersonnelToPdf(
  personnelData: Array<{
    name: string;
    role: string;
    totalScore: number;
    metrics: Array<{ label: string; value: string; score: string; maxScore: string }>;
  }>,
  fileName: string,
  title: string,
  toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void
): Promise<void> {
  if (!personnelData || personnelData.length === 0) {
    toastFn({ title: "Veri Yok", description: "Dışa aktarılacak personel verisi bulunamadı.", variant: "default" });
    return;
  }

  try {
    const [jsPDFModule, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);
    const jsPDF = jsPDFModule.default;
    const autoTable = autoTableModule.default;

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const padX = 30;
    const padY = 30;

    const fontBase64 = await loadTurkishFontForPdf();
    let useTurkish = false;
    const FALLBACK_FONT = 'helvetica';
    let FONT = FALLBACK_FONT;

    if (fontBase64) {
      try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        FONT = 'NotoSans';
        useTurkish = true;
      } catch (e) {
        console.error('Could not setup Turkish font:', e);
      }
    }

    personnelData.forEach((person, index) => {
      if (index > 0) doc.addPage();

      // Title bar
      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text(pdfText(title, useTurkish), padX, padY + 10);

      // Date
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      const dateStr = new Date().toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      doc.text(dateStr, pageW - padX, padY + 10, { align: 'right' });

      // Person name and role
      doc.setFont(FONT, 'bold');
      doc.setFontSize(16);
      doc.text(pdfText(person.name, useTurkish), padX, padY + 40);

      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(pdfText(`Rol: ${person.role}`, useTurkish), padX, padY + 55);

      // Total score
      doc.setFont(FONT, 'bold');
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text(pdfText(`Toplam Puan: ${person.totalScore}`, useTurkish), pageW - padX, padY + 45, { align: 'right' });

      // Metrics table
      const headers = [
        pdfText('Metrik', useTurkish),
        pdfText('Değer', useTurkish),
        pdfText('Puan', useTurkish),
        pdfText('Maks. Puan', useTurkish),
      ];

      const rows = person.metrics.map(m => [
        pdfText(m.label, useTurkish),
        pdfText(m.value, useTurkish),
        pdfText(m.score, useTurkish),
        pdfText(m.maxScore, useTurkish),
      ]);

      autoTable(doc, {
        head: [headers],
        body: rows,
        startY: padY + 70,
        theme: 'grid',
        styles: {
          font: FONT,
          fontSize: 9,
          cellPadding: 6,
          overflow: 'linebreak',
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [60, 60, 60],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
          halign: 'center',
        },
        bodyStyles: { valign: 'middle' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: {
          0: { cellWidth: 200 },
          1: { cellWidth: 200 },
          2: { halign: 'center', cellWidth: 100 },
          3: { halign: 'center', cellWidth: 100 },
        },
        margin: { left: padX, right: padX },
      });

      // Page number
      const pageNumber = doc.getCurrentPageInfo().pageNumber;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(`Sayfa ${pageNumber} / ${personnelData.length}`, pageW / 2, pageH - 15, { align: 'center' });
    });

    const safeFileName = fileName.replace(/[^a-z0-9_]/gi, '_');
    const fileDateStr = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\./g, '-');
    doc.save(`${safeFileName}_${fileDateStr}.pdf`);

    toastFn({ title: "Başarılı", description: `${fileName} başarıyla PDF olarak dışa aktarıldı.` });
  } catch (error) {
    console.error("PDF export error:", error);
    toastFn({ title: "Hata", description: "PDF'e aktarılırken bir sorun oluştu.", variant: "destructive" });
  }
}

/**
 * Export device models data to PDF - one device per landscape page with all info.
 */
export async function exportDevicesToPdf(
  devicesData: Array<{
    name: string;
    info: Array<{ label: string; value: string }>;
    maintenancePlans?: Array<{ taskName: string; period: string; type: string }>;
    periodicParts?: Array<{ partName: string; partCode: string; period: string; responsibility: string }>;
  }>,
  fileName: string,
  title: string,
  toastFn: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void
): Promise<void> {
  if (!devicesData || devicesData.length === 0) {
    toastFn({ title: "Veri Yok", description: "Dışa aktarılacak cihaz verisi bulunamadı.", variant: "default" });
    return;
  }

  try {
    const [jsPDFModule, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);
    const jsPDF = jsPDFModule.default;
    const autoTable = autoTableModule.default;

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const padX = 30;
    const padY = 30;

    const fontBase64 = await loadTurkishFontForPdf();
    let useTurkish = false;
    const FALLBACK_FONT = 'helvetica';
    let FONT = FALLBACK_FONT;

    if (fontBase64) {
      try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        FONT = 'NotoSans';
        useTurkish = true;
      } catch (e) {
        console.error('Could not setup Turkish font:', e);
      }
    }

    devicesData.forEach((device, index) => {
      if (index > 0) doc.addPage();

      // Title bar
      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text(pdfText(title, useTurkish), padX, padY + 10);

      // Date
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      const dateStr = new Date().toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      doc.text(dateStr, pageW - padX, padY + 10, { align: 'right' });

      // Device name
      doc.setFont(FONT, 'bold');
      doc.setFontSize(16);
      doc.text(pdfText(device.name, useTurkish), padX, padY + 40);

      let currentY = padY + 55;

      // Device info table
      if (device.info.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(60, 60, 60);
        doc.text(pdfText('Cihaz Bilgileri', useTurkish), padX, currentY);
        currentY += 5;

        autoTable(doc, {
          head: [[pdfText('Özellik', useTurkish), pdfText('Değer', useTurkish)]],
          body: device.info.map(i => [pdfText(i.label, useTurkish), pdfText(i.value, useTurkish)]),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT, fontSize: 9, cellPadding: 5, lineWidth: 0.5 },
          headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
          alternateRowStyles: { fillColor: [245, 245, 245] },
          columnStyles: { 0: { cellWidth: 180, fontStyle: 'bold' } },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Maintenance plans table
      if (device.maintenancePlans && device.maintenancePlans.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(60, 60, 60);
        doc.text(pdfText('Periyodik Bakım Planları', useTurkish), padX, currentY);
        currentY += 5;

        autoTable(doc, {
          head: [[pdfText('İş Adı', useTurkish), pdfText('Periyot', useTurkish), pdfText('Tip', useTurkish)]],
          body: device.maintenancePlans.map(p => [
            pdfText(p.taskName, useTurkish),
            pdfText(p.period, useTurkish),
            pdfText(p.type, useTurkish),
          ]),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT, fontSize: 9, cellPadding: 5, lineWidth: 0.5 },
          headStyles: { fillColor: [40, 80, 120], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
          alternateRowStyles: { fillColor: [240, 245, 250] },
          margin: { left: padX, right: padX },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Periodic parts table
      if (device.periodicParts && device.periodicParts.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(60, 60, 60);
        doc.text(pdfText('Periyodik Parça Değişimleri', useTurkish), padX, currentY);
        currentY += 5;

        autoTable(doc, {
          head: [[
            pdfText('Parça Adı', useTurkish),
            pdfText('Stok Kodu', useTurkish),
            pdfText('Periyot', useTurkish),
            pdfText('Sorumluluk', useTurkish),
          ]],
          body: device.periodicParts.map(p => [
            pdfText(p.partName, useTurkish),
            pdfText(p.partCode, useTurkish),
            pdfText(p.period, useTurkish),
            pdfText(p.responsibility, useTurkish),
          ]),
          startY: currentY,
          theme: 'grid',
          styles: { font: FONT, fontSize: 9, cellPadding: 5, lineWidth: 0.5 },
          headStyles: { fillColor: [80, 40, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
          alternateRowStyles: { fillColor: [248, 243, 250] },
          margin: { left: padX, right: padX },
        });
      }

      // Page number
      const pageNumber = doc.getCurrentPageInfo().pageNumber;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(`Sayfa ${pageNumber} / ${devicesData.length}`, pageW / 2, pageH - 15, { align: 'center' });
    });

    const safeFileName = fileName.replace(/[^a-z0-9_]/gi, '_');
    const fileDateStr = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\./g, '-');
    doc.save(`${safeFileName}_${fileDateStr}.pdf`);

    toastFn({ title: "Başarılı", description: `${fileName} başarıyla PDF olarak dışa aktarıldı.` });
  } catch (error) {
    console.error("PDF export error:", error);
    toastFn({ title: "Hata", description: "PDF'e aktarılırken bir sorun oluştu.", variant: "destructive" });
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

  // Play browser-generated beep for both success and error
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    
    oscillator.type = isError ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(isError ? 220 : 440, ctx.currentTime);
    oscillator.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15); // Short beep

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
