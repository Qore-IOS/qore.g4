'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Scan, AlertTriangle, CheckCircle, Trash2, Wand2, FileText, Calendar, Building2 } from 'lucide-react';
import { extractTextFromPdf, renderPdfPagesToImages } from '@/lib/pdf';
import type { BekleyenIrsaliyeItem, ProductCode } from '@/lib/types';
import { db } from '@/lib/firebase';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';

interface DosyaMeta {
  id: string;
  fileName: string;
  storagePath: string;
  downloadURL: string;
  locationType?: 'hospital' | 'depot';
  locationId?: string;
  locationName?: string;
}

interface ScanResponse {
  irsaliyeNumber?: string;
  irsaliyeDate?: string;
  supplierName?: string;
  notes?: string;
  brands: string[];
  itemCount: number;
  totalConvertedQuantity: number;
  items: ScanItemRaw[];
  scanModel?: string;
}

interface ScanItemRaw {
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  lot?: string;
  miad?: string;
  rawLine?: string;
  sourceQuantity: number;
  sourceUnit?: string;
  convertedQuantity: number;
  convertedUnit?: string;
  anaBirim?: string;
  ambalajDegeri?: number;
  conversionApplied: boolean;
  conversionReasoning?: string;
  matchConfidence: 'high' | 'medium' | 'low';
  matchedBy: 'stok_kodu' | 'stok_adi' | 'none';
}

interface IrsaliyeScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: DosyaMeta | null;
  productCodes: ProductCode[];
}

export default function IrsaliyeScanModal({ isOpen, onClose, file, productCodes }: IrsaliyeScanModalProps) {
  const { currentUserProfile, currentCompanyId } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase] = useState<'idle' | 'rendering' | 'scanning' | 'review' | 'saving'>('idle');
  const [progress, setProgress] = useState('');
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [items, setItems] = useState<ScanItemRaw[]>([]);
  const [irsaliyeNumber, setIrsaliyeNumber] = useState('');
  const [irsaliyeDate, setIrsaliyeDate] = useState('');
  const [supplierName, setSupplierName] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      setProgress('');
      setScanResult(null);
      setItems([]);
      setIrsaliyeNumber('');
      setIrsaliyeDate('');
      setSupplierName('');
    }
  }, [isOpen]);

  const runScan = useCallback(async () => {
    if (!file) return;
    setPhase('rendering');
    setProgress('Dosya indiriliyor...');
    try {
      const response = await fetch('/api/storage/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'PDF indirilemedi.');
      }
      const blob = await response.blob();
      const pdfFile = new File([blob], file.fileName, { type: 'application/pdf' });

      setProgress('Sayfalar görüntüye çevriliyor...');
      // Run text extraction in parallel; helps the AI when image OCR is uncertain.
      const imagesPromise = renderPdfPagesToImages(pdfFile, { scale: 2.0, quality: 0.85, maxPages: 8 });
      const textPromise = extractTextFromPdf(pdfFile).catch(() => '');

      const [images, ocrText] = await Promise.all([imagesPromise, textPromise]);
      if (images.length === 0) {
        throw new Error('PDF sayfaları okunamadı.');
      }

      setPhase('scanning');
      setProgress(`${images.length} sayfa Gemini Vision ile taranıyor...`);

      const formData = new FormData();
      images.forEach((img, idx) => {
        formData.append('images', new File([img], `page-${idx + 1}.jpg`, { type: 'image/jpeg' }));
      });
      const compactProducts = productCodes.slice(0, 1500).map(p => ({
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        marka: p.marka,
        anaBirim: p.anaBirim,
        ambalajDegeri: p.ambalajDegeri,
      }));
      formData.append('products', JSON.stringify(compactProducts));
      formData.append('ocrText', ocrText.slice(0, 12000));

      const res = await fetch('/api/ai/irsaliye-scan', { method: 'POST', body: formData });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Tarama başarısız.');
      }

      const result = data as ScanResponse;
      setScanResult(result);
      setItems(result.items || []);
      setIrsaliyeNumber(result.irsaliyeNumber || '');
      setIrsaliyeDate(result.irsaliyeDate || '');
      setSupplierName(result.supplierName || '');
      setPhase('review');
      setProgress('');
      if ((result.items || []).length === 0) {
        toast({ title: 'Uyarı', description: 'Hiç ürün satırı tespit edilemedi.', variant: 'destructive' });
      } else {
        toast({ title: 'Tarama tamamlandı', description: `${result.items.length} ürün satırı bulundu.` });
      }
    } catch (err: any) {
      console.error('Irsaliye scan error:', err);
      toast({ title: 'Hata', description: err?.message || 'Tarama sırasında hata oluştu.', variant: 'destructive' });
      setPhase('idle');
      setProgress('');
    }
  }, [file, productCodes, toast]);

  // Auto-start scan when modal opens with a file
  useEffect(() => {
    if (isOpen && file && phase === 'idle') {
      void runScan();
    }
  }, [isOpen, file, phase, runScan]);

  const updateItem = (idx: number, patch: Partial<ScanItemRaw>) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const validItems = items.filter(i => i.stokKodu && i.convertedQuantity > 0);
  const matchedItems = validItems.filter(i => i.matchedBy !== 'none');
  const unmatchedItems = items.filter(i => i.matchedBy === 'none');

  const handleApprove = useCallback(async () => {
    if (!file) return;
    if (matchedItems.length === 0) {
      toast({ title: 'Onaylanacak ürün yok', description: 'En az bir eşleşmiş ürün gerekli.', variant: 'destructive' });
      return;
    }
    setPhase('saving');
    try {
      const itemsToSave: BekleyenIrsaliyeItem[] = matchedItems.map(it => ({
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        marka: it.marka,
        lot: it.lot,
        miad: it.miad,
        rawLine: it.rawLine,
        sourceQuantity: it.sourceQuantity,
        sourceUnit: it.sourceUnit,
        convertedQuantity: it.convertedQuantity,
        convertedUnit: it.convertedUnit,
        anaBirim: it.anaBirim,
        ambalajDegeri: it.ambalajDegeri,
        conversionApplied: it.conversionApplied,
        conversionReasoning: it.conversionReasoning,
        matchConfidence: it.matchConfidence,
        matchedBy: it.matchedBy,
      }));

      const brands = Array.from(new Set(itemsToSave.map(i => i.marka).filter(Boolean) as string[]));
      const totalConverted = itemsToSave.reduce((s, i) => s + i.convertedQuantity, 0);

      await addDoc(
        collection(db, 'bekleyenIrsaliyeler'),
        withCompanyScope({
          dosyaId: file.id,
          dosyaName: file.fileName,
          storagePath: file.storagePath,
          downloadURL: file.downloadURL,
          locationType: file.locationType || 'hospital',
          locationId: file.locationId || '',
          locationName: file.locationName || '',
          irsaliyeNumber: irsaliyeNumber || undefined,
          irsaliyeDate: irsaliyeDate || undefined,
          supplierName: supplierName || undefined,
          brands,
          itemCount: itemsToSave.length,
          totalConvertedQuantity: totalConverted,
          items: itemsToSave,
          status: 'pending',
          scannedAt: Timestamp.now(),
          scannedByUid: currentUserProfile?.uid || null,
          scannedByName: currentUserProfile?.name || currentUserProfile?.email || 'Bilinmeyen',
          aiNotes: scanResult?.notes || undefined,
          scanModel: scanResult?.scanModel || undefined,
        }, currentCompanyId),
      );

      toast({
        title: 'Onaylandı',
        description: `${itemsToSave.length} ürün lab stok yönetimindeki "Bekleyen İrsaliyeler" listesine eklendi.`,
      });
      onClose();
    } catch (err: any) {
      console.error('Approve error:', err);
      toast({ title: 'Hata', description: err?.message || 'Kayıt sırasında hata oluştu.', variant: 'destructive' });
      setPhase('review');
    }
  }, [file, matchedItems, irsaliyeNumber, irsaliyeDate, supplierName, scanResult, currentUserProfile, currentCompanyId, toast, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o && phase !== 'saving' && phase !== 'scanning' && phase !== 'rendering') onClose(); }}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 sm:px-6 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5 text-primary" />
            İrsaliye Tara ve Onayla
          </DialogTitle>
          <DialogDescription className="text-xs">
            {file ? file.fileName : ''} — Gemini Vision ile taranır, kullanıcı onayından sonra lab stok yönetimindeki "Bekleyen İrsaliyeler" bölümünde görünür.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {(phase === 'idle' || phase === 'rendering' || phase === 'scanning') && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm font-medium">{progress || 'Hazırlanıyor...'}</p>
              <p className="text-xs text-muted-foreground max-w-md">
                Tarama 5-30 saniye sürebilir. Her sayfa Gemini Vision üzerinden işleniyor.
              </p>
            </div>
          )}

          {phase === 'review' && (
            <>
              {/* Header info */}
              <div className="px-5 sm:px-6 py-4 border-b bg-muted/30 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> İrsaliye No
                  </label>
                  <Input value={irsaliyeNumber} onChange={(e) => setIrsaliyeNumber(e.target.value)} placeholder="otomatik tespit edilmedi" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Tarih
                  </label>
                  <Input value={irsaliyeDate} onChange={(e) => setIrsaliyeDate(e.target.value)} placeholder="dd.MM.yyyy" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Satıcı
                  </label>
                  <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="firma adı" className="h-8 text-xs" />
                </div>
              </div>

              {/* Summary chips */}
              <div className="px-5 sm:px-6 py-2 flex flex-wrap gap-2 border-b text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle className="h-3 w-3" />
                  {matchedItems.length} eşleşti
                </span>
                {unmatchedItems.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    {unmatchedItems.length} eşleşmedi
                  </span>
                )}
                {scanResult?.brands && scanResult.brands.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    Markalar: <strong>{scanResult.brands.join(', ')}</strong>
                  </span>
                )}
                {scanResult?.scanModel && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    Model: {scanResult.scanModel}
                  </span>
                )}
              </div>

              {/* Items table */}
              <ScrollArea className="flex-1 px-5 sm:px-6 py-3">
                {items.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    Hiç ürün satırı tespit edilemedi.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, idx) => {
                      const isUnmatched = it.matchedBy === 'none';
                      return (
                        <div
                          key={idx}
                          className={`border rounded-lg p-3 grid grid-cols-12 gap-2 items-start ${
                            isUnmatched ? 'bg-amber-50/40 border-amber-200' : 'bg-card'
                          }`}
                        >
                          <div className="col-span-12 sm:col-span-4 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate">
                                {it.stokAdi || <span className="italic text-muted-foreground">Adı yok</span>}
                              </p>
                              {it.matchConfidence === 'low' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">düşük güven</span>
                              )}
                              {it.matchConfidence === 'medium' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">orta</span>
                              )}
                              {isUnmatched && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">eşleşmedi</span>
                              )}
                              {it.conversionApplied && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5">
                                  <Wand2 className="h-2.5 w-2.5" /> AI dönüştürdü
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{it.stokKodu || '-'}</p>
                            {it.marka && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">Marka: {it.marka}</p>
                            )}
                            {it.conversionReasoning && (
                              <p className="text-[10px] text-muted-foreground italic mt-1">{it.conversionReasoning}</p>
                            )}
                          </div>

                          <div className="col-span-6 sm:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Lot</label>
                            <Input
                              value={it.lot || ''}
                              onChange={(e) => updateItem(idx, { lot: e.target.value.toUpperCase() })}
                              className="h-7 text-xs"
                              placeholder="-"
                            />
                          </div>
                          <div className="col-span-6 sm:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Miad</label>
                            <Input
                              value={it.miad || ''}
                              onChange={(e) => updateItem(idx, { miad: e.target.value })}
                              className="h-7 text-xs"
                              placeholder="dd.MM.yyyy"
                            />
                          </div>

                          <div className="col-span-5 sm:col-span-2">
                            <label className="text-[10px] text-muted-foreground">
                              Faturadaki ({it.sourceUnit || 'birim'})
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={it.sourceQuantity}
                              onChange={(e) => updateItem(idx, { sourceQuantity: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="col-span-5 sm:col-span-1">
                            <label className="text-[10px] text-emerald-700 font-semibold">
                              {it.anaBirim || it.convertedUnit || 'Adet'}
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={it.convertedQuantity}
                              onChange={(e) => updateItem(idx, { convertedQuantity: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="h-7 text-xs font-bold"
                            />
                          </div>
                          <div className="col-span-2 sm:col-span-1 flex items-end justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(idx)}
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Sil"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </>
          )}

          {phase === 'saving' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm">Onaylanıyor ve bekleyen irsaliyelere kaydediliyor...</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 sm:px-6 py-3 border-t flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {phase === 'review' && matchedItems.length > 0 && (
              <span>
                Onaylanacak: <strong>{matchedItems.length}</strong> ürün,{' '}
                <strong>{matchedItems.reduce((s, i) => s + i.convertedQuantity, 0)}</strong> birim
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={phase === 'saving' || phase === 'scanning' || phase === 'rendering'}
            >
              İptal
            </Button>
            {phase === 'review' && (
              <Button
                onClick={() => void runScan()}
                variant="outline"
                disabled={phase !== 'review'}
                size="sm"
              >
                <Scan className="h-4 w-4 mr-1" /> Yeniden Tara
              </Button>
            )}
            <Button
              onClick={() => void handleApprove()}
              disabled={phase !== 'review' || matchedItems.length === 0}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Onayla ve Lab Stoğa Gönder
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
