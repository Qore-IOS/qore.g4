'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import type { ProductCode } from '@/lib/types';
import { resolveDefaultTrackingMode, type TrackingMode } from '@/lib/tracking';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';
import type { BulkScanResultItem } from './BulkBarcodeScanModal';

interface ExcelStokGirisModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  productTracking: Record<string, TrackingMode>;
  onResults: (items: BulkScanResultItem[]) => void;
}

interface ParsedRow {
  rowIndex: number;
  stokKodu: string;
  stokAdi: string;
  lot: string;
  miad: string;
  seriNo: string;
  adet: number;
  error?: string;
}

const HEADERS = {
  stokKodu: ['Stok Kodu', 'stokKodu', 'STOK KODU'],
  stokAdi: ['Ürün Adı', 'stokAdi', 'ÜRÜN ADI'],
  lot: ['Lot Numarası', 'Lot', 'lotNumarasi'],
  miad: ['Miad', 'miad', 'Miad (GG.AA.YYYY)'],
  seriNo: ['Seri No', 'Seri Numarası', 'seriNumarasi'],
  adet: ['Adet', 'adet'],
};

function readCell(row: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function parseRow(row: Record<string, any>, rowIndex: number, productCodes: ProductCode[], productTracking: Record<string, TrackingMode>): ParsedRow | null {
  const stokKodu = readCell(row, HEADERS.stokKodu);
  if (!stokKodu) return null; // boş satır — sessizce atla

  const product = productCodes.find(p => p.stokKodu === stokKodu);
  const lot = readCell(row, HEADERS.lot);
  const miadRaw = readCell(row, HEADERS.miad);
  const miad = miadRaw ? normalizeMiad(miadRaw) : '';
  const seriNo = readCell(row, HEADERS.seriNo);
  const adet = parseInt(readCell(row, HEADERS.adet), 10) || 1;
  const stokAdi = product?.stokAdi || readCell(row, HEADERS.stokAdi) || stokKodu;

  const base: ParsedRow = { rowIndex, stokKodu, stokAdi, lot, miad, seriNo, adet };

  if (!product) return { ...base, error: 'Ürün bulunamadı (stok kodu eşleşmedi)' };

  const mode = productTracking[stokKodu] || resolveDefaultTrackingMode(product as any);
  if (mode === 'serial') {
    if (!seriNo) return { ...base, error: 'Bu ürün seri no takipli — Seri No zorunlu' };
  } else if (mode === 'lot_manual' || mode === 'lot_barcode') {
    if (!lot || !miad) return { ...base, error: 'Bu ürün lot takipli — Lot Numarası ve Miad zorunlu' };
  }
  return base;
}

async function downloadTemplate() {
  const XLSX = await import('xlsx');
  const rows = [
    { 'Stok Kodu': 'ORNEK-001', 'Ürün Adı': '(bilgi amaçlı — eşleştirme Stok Kodu ile yapılır)', 'Lot Numarası': 'L12345', 'Miad': '31.12.2027', 'Seri No': '', 'Adet': 10 },
    { 'Stok Kodu': 'ORNEK-002', 'Ürün Adı': '(seri no takipli ürün örneği — her seri ayrı satır)', 'Lot Numarası': '', 'Miad': '', 'Seri No': 'SN000123', 'Adet': 1 },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mal Kabul');
  const notesWs = XLSX.utils.aoa_to_sheet([
    ['Açıklama'],
    ['Stok Kodu: zorunlu, sistemdeki ürün koduyla birebir eşleşmeli.'],
    ['Seri No dolu ise bu satır TEK bir ürünü temsil eder (seri no takipli ürünler için); her seri için ayrı bir satır açın, Adet sütunu bu satırlarda dikkate alınmaz.'],
    ['Seri No boşsa: Lot takipli ürünlerde Lot Numarası ve Miad zorunludur; Adet o lot için toplam miktardır.'],
    ['Adet takipli (lotsuz, seri takipsiz) ürünlerde sadece Adet sütunu kullanılır.'],
    ['Miad tarihini GG.AA.YYYY formatında girin (örn. 31.12.2027).'],
  ]);
  XLSX.utils.book_append_sheet(wb, notesWs, 'Açıklama');
  XLSX.writeFile(wb, 'mal-kabul-sablonu.xlsx');
}

export default function ExcelStokGirisModal({ isOpen, onClose, productCodes, productTracking, onResults }: ExcelStokGirisModalProps) {
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const validRows = rows.filter(r => !r.error);
  const errorRows = rows.filter(r => !!r.error);

  const reset = () => { setRows([]); if (fileRef.current) fileRef.current.value = ''; };

  const handleFile = async (file: File) => {
    setParsing(true);
    setRows([]);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { raw: false, dateNF: 'dd.mm.yyyy' });
      const parsed = json
        .map((row, i) => parseRow(row, i + 2, productCodes, productTracking))
        .filter((r): r is ParsedRow => r !== null);
      setRows(parsed);
    } catch (e) {
      console.error('[ExcelStokGirisModal] parse hatası:', e);
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = () => {
    if (validRows.length === 0) return;
    const items: BulkScanResultItem[] = validRows.map(r => ({
      urunAdi: r.stokAdi,
      katalogNo: r.stokKodu,
      lotNo: r.lot,
      skt: r.miad,
      seriNo: r.seriNo,
      gtin: '',
      barkodVerisi: 'EXCEL_IMPORT',
      adet: r.seriNo ? 1 : r.adet,
      confidence: 'high',
      matchedProduct: productCodes.find(p => p.stokKodu === r.stokKodu),
      selected: true,
    }));
    onResults(items);
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Excel ile Stok Girişi</DialogTitle>
          <DialogDescription>
            Şablonu indirip doldurun, ardından buradan yükleyin. Stok kodu, lot/miad (lot takipli ürünlerde) ve seri no (seri takipli ürünlerde, satır başına bir seri) girilir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Şablon İndir
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Dosya Seç
          </Button>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 className="h-4 w-4" /> {validRows.length} satır hazır</span>
              {errorRows.length > 0 && (
                <span className="flex items-center gap-1 text-destructive font-medium"><AlertTriangle className="h-4 w-4" /> {errorRows.length} satır hatalı (atlanacak)</span>
              )}
            </div>
            <ScrollArea className="h-64 rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left">Satır</th>
                    <th className="p-2 text-left">Ürün</th>
                    <th className="p-2 text-left">Lot</th>
                    <th className="p-2 text-left">Miad</th>
                    <th className="p-2 text-left">Seri No</th>
                    <th className="p-2 text-right">Adet</th>
                    <th className="p-2 text-left">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowIndex} className={`border-t ${r.error ? 'bg-destructive/5' : ''}`}>
                      <td className="p-2 text-muted-foreground">{r.rowIndex}</td>
                      <td className="p-2">
                        <div className="font-medium">{r.stokAdi}</div>
                        <div className="font-mono text-muted-foreground">{r.stokKodu}</div>
                      </td>
                      <td className="p-2 font-mono">{r.lot || '—'}</td>
                      <td className="p-2">{r.miad || '—'}</td>
                      <td className="p-2 font-mono">{r.seriNo || '—'}</td>
                      <td className="p-2 text-right">{r.seriNo ? 1 : r.adet}</td>
                      <td className="p-2">
                        {r.error ? <span className="text-destructive">{r.error}</span> : <span className="text-emerald-600">Hazır</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Vazgeç</Button>
          <Button onClick={handleConfirm} disabled={validRows.length === 0}>
            {validRows.length > 0 ? `${validRows.length} Satırı Ekle` : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
