'use client';
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileText, Scan, CheckCircle, AlertTriangle, Trash2, Search } from 'lucide-react';
import { extractTextFromPdf } from '@/lib/pdf';
import { parseIrsaliyeText, IrsaliyeParseResult } from '@/lib/irsaliye-parser';
import type { ProductCode } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope } from '@/lib/company-scope';

interface SavedIrsaliyeFile {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'xlsx' | 'xls';
  fileSize: number;
  storagePath: string;
  downloadURL: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
  expiresAt: Timestamp;
  companyId?: string;
  locationType?: 'hospital' | 'depot';
  locationId?: string;
  locationName?: string;
}

export interface LabOcrResult extends IrsaliyeParseResult {
  productName: string;
  confidence: 'high' | 'low';
}

interface LabIrsaliyeOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  onResults: (results: LabOcrResult[], file: SavedIrsaliyeFile) => void;
  locationType?: 'hospital' | 'depot';
  locationId?: string;
}

export default function LabIrsaliyeOcrModal({
  isOpen,
  onClose,
  productCodes,
  onResults,
  locationType,
  locationId,
}: LabIrsaliyeOcrModalProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [detectedItems, setDetectedItems] = useState<any[]>([]);
  const [savedFiles, setSavedFiles] = useState<SavedIrsaliyeFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SavedIrsaliyeFile | null>(null);

  const normalizeLotToken = (value?: string) => {
    if (!value) return undefined;
    const token = value.trim().replace(/[|;,]+/g, ' ').match(/\b([A-Za-z0-9-]{3,})\b/)?.[1]?.toUpperCase();
    return token || undefined;
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoadingFiles(true);
    const q = query(
      collection(db, 'irsaliyeDosyalari'),
      orderBy('uploadedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const files: SavedIrsaliyeFile[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const file = { id: docSnap.id, ...data } as SavedIrsaliyeFile;
        const inScope = matchesCompanyScope(file, currentCompanyId, isSuperAdmin);
        const locationMatch = locationType && locationId
          ? file.locationType === locationType && file.locationId === locationId
          : true;
        if (data.expiresAt && data.expiresAt.toMillis() > Date.now() && inScope && locationMatch) {
          files.push(file);
        }
      });
      setSavedFiles(files);
      setLoadingFiles(false);
    }, () => {
      setLoadingFiles(false);
    });
    return () => unsubscribe();
  }, [isOpen, currentCompanyId, isSuperAdmin, locationType, locationId]);

  const processExtractedText = (text: string) => {
    (async () => {
      let rawItems: IrsaliyeParseResult[] = [];
      try {
        const aiRes = await fetch('/api/ai/irsaliye-parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            productCodes: productCodes.map((p) => ({ stokKodu: p.stokKodu, stokAdi: p.stokAdi })),
          }),
        });
        const aiData = await aiRes.json().catch(() => ({}));
        if (Array.isArray(aiData?.parsed) && aiData.parsed.length > 0) {
          rawItems = aiData.parsed as IrsaliyeParseResult[];
        }
      } catch (error) {
        console.warn('AI irsaliye parse unavailable, falling back local parser:', error);
      }

      if (rawItems.length === 0) {
        rawItems = parseIrsaliyeText(text, productCodes);
      } else {
        // AI çıktısı geldiğinde de lokal parser ile LOT doğrulaması yap.
        const localItems = parseIrsaliyeText(text, productCodes);
        rawItems = rawItems.map((item) => {
          const localMatch = localItems.find((local) =>
            local.stokKodu === item.stokKodu &&
            (
              (!!item.miad && !!local.miad && item.miad === local.miad) ||
              (!!item.quantity && !!local.quantity && item.quantity === local.quantity)
            )
          ) || localItems.find((local) => local.stokKodu === item.stokKodu);

          const localLot = normalizeLotToken(localMatch?.lot);
          return {
            ...item,
            // LOT değeri her zaman lokal parser'dan gelsin (LOT başlığına göre çıkarım).
            lot: localLot || undefined,
          };
        });
      }

      const processedItems = rawItems.map(item => {
        const product = productCodes.find(p => p.stokKodu === item.stokKodu);
        return {
          ...item,
          productName: product?.stokAdi || 'Bilinmeyen Ürün',
          quantity: item.quantity || 1,
          confidence: product ? 'high' : 'low',
        };
      });
      setDetectedItems(prev => [...prev, ...processedItems]);
      if (processedItems.length === 0) {
        toast({ title: 'PDF tarandı ancak ürün/miktar eşleşmesi bulunamadı.', variant: 'default' });
      } else {
        toast({ title: 'Başarılı', description: `${processedItems.length} ürün başarıyla ayrıştırıldı.` });
      }
    })();
  };

  const handleSelectSavedFile = async (file: SavedIrsaliyeFile) => {
    if (file.fileType !== 'pdf') {
      toast({ title: 'Desteklenmiyor', description: 'OCR taraması sadece PDF dosyaları için desteklenmektedir.', variant: 'destructive' });
      return;
    }
    setProcessing(true);
    setSelectedFile(file);
    setDetectedItems([]);
    toast({ title: 'İşleniyor', description: `${file.fileName} okunuyor...` });
    try {
      const response = await fetch('/api/storage/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Dosya indirilemedi');
      }
      const blob = await response.blob();
      const pdfFile = new File([blob], file.fileName, { type: 'application/pdf' });
      const text = await extractTextFromPdf(pdfFile);
      processExtractedText(text);
    } catch (error: any) {
      console.error('Saved PDF Error:', error);
      toast({ title: 'PDF Okuma Hatası', description: error.message || 'Kayıtlı dosya işlenirken bir hata oluştu.', variant: 'destructive' });
      setSelectedFile(null);
    } finally {
      setProcessing(false);
    }
  };

  const removeItem = (index: number) => {
    setDetectedItems(prev => prev.filter((_: any, i: number) => i !== index));
  };

  const updateItemField = (index: number, field: string, value: string | number) => {
    setDetectedItems(prev => prev.map((item: any, i: number) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleModalClose = () => {
    setProcessing(false);
    setDetectedItems([]);
    setSelectedFile(null);
    onClose();
  };

  const confirmAdd = () => {
    const validItems = detectedItems.filter((item: any) => item.stokKodu && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: 'Uyarı', description: 'Eklenecek geçerli kalem bulunamadı.', variant: 'default' });
      return;
    }
    if (!selectedFile) {
      toast({ title: 'Hata', description: 'Dosya bilgisi bulunamadı.', variant: 'destructive' });
      return;
    }
    onResults(validItems, selectedFile);
    handleModalClose();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pdfFiles = savedFiles.filter(f => f.fileType === 'pdf');
  const validItemCount = detectedItems.filter((item: any) => item.stokKodu && item.quantity > 0).length;

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 sm:px-6 border-b border-[var(--dashboard-stroke)]">
          <DialogTitle className="flex items-center gap-2 text-[var(--dashboard-text)]">
            <Scan className="h-5 w-5 text-[var(--dashboard-accent)]" />
            İrsaliye ile Stok Girişi (OCR)
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--dashboard-muted)]">
            Dosya yönetimindeki PDF irsaliyelerden birini seçin, tespit edilen kalemleri kontrol edip laboratuvar stoğuna ekleyin.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* File selection area */}
          <div className="px-5 pt-4 sm:px-6">
            <div className="space-y-3 max-w-lg mx-auto">
              <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-2">
                Dosya Yönetimindeki İrsaliyeler
              </p>
              {loadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--dashboard-accent)]" />
                </div>
              ) : pdfFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="h-8 w-8 text-[var(--dashboard-muted)] mb-2" />
                  <p className="text-xs text-[var(--dashboard-muted)]">Dosya yönetiminde PDF irsaliye bulunamadı.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[180px] rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                  <div className="divide-y divide-[var(--dashboard-stroke)]">
                    {pdfFiles.map((file) => (
                      <button
                        key={file.id}
                        className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-[var(--dashboard-surface-2)] transition-colors text-left disabled:opacity-50"
                        onClick={() => handleSelectSavedFile(file)}
                        disabled={processing}
                      >
                        <FileText className="h-5 w-5 text-red-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{file.fileName}</p>
                          <div className="flex items-center gap-2 text-[10px] text-[var(--dashboard-muted)]">
                            <span>{formatFileSize(file.fileSize)}</span>
                            <span>{file.uploadedByName}</span>
                          </div>
                        </div>
                        {selectedFile?.id === file.id && processing ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--dashboard-accent)] shrink-0" />
                        ) : (
                          <Scan className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          {/* Processing indicator */}
          {processing && (
            <div className="flex flex-col items-center gap-3 py-4 px-5">
              <Loader2 className="w-10 h-10 animate-spin text-[var(--dashboard-accent)]" />
              <p className="text-xs text-[var(--dashboard-muted)]">Belge analiz ediliyor...</p>
            </div>
          )}

          {/* Detected items table */}
          <div className="flex-1 overflow-hidden flex flex-col mx-5 mb-4 sm:mx-6 rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] mt-4">
            <div className="px-4 py-2.5 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] flex justify-between items-center rounded-t-2xl">
              <span className="text-xs font-semibold text-[var(--dashboard-text)]">
                Tespit Edilen Kalemler
                <span className="ml-1.5 text-[var(--dashboard-muted)]">({detectedItems.length})</span>
              </span>
              {detectedItems.length > 0 && (
                <button
                  onClick={() => setDetectedItems([])}
                  className="text-[10px] font-medium text-red-500 hover:text-red-700 transition-colors"
                >
                  Tümünü Temizle
                </button>
              )}
            </div>

            {detectedItems.length > 0 && (
              <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_32px] gap-2 px-4 py-1.5 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)]">
                <span>Ürün</span>
                <span>Lot</span>
                <span>SKT</span>
                <span className="text-right">Adet</span>
                <span></span>
              </div>
            )}

            <ScrollArea className="flex-1">
              {detectedItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-3">
                    <Search className="h-5 w-5 text-[var(--dashboard-muted)]" />
                  </div>
                  <p className="text-xs text-[var(--dashboard-muted)]">Henüz ürün taranmadı.</p>
                  <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">Yukarıdan bir irsaliye dosyası seçin.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--dashboard-stroke)]">
                  {detectedItems.map((item: any, idx: number) => (
                    <div key={idx} className="relative group">
                      <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_32px] gap-2 items-center px-4 py-2.5 hover:bg-[var(--dashboard-surface-2)]/60">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{item.productName}</p>
                            {item.confidence === 'low' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 shrink-0">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Eşleşmedi
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p>
                        </div>
                        <div>
                          <Input
                            value={item.lot || ''}
                            onChange={(e) => updateItemField(idx, 'lot', e.target.value)}
                            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            placeholder="-"
                          />
                        </div>
                        <div>
                          <Input
                            value={item.miad || ''}
                            onChange={(e) => updateItemField(idx, 'miad', e.target.value)}
                            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            placeholder="-"
                          />
                        </div>
                        <div>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateItemField(idx, 'quantity', parseInt(e.target.value) || 0)}
                            className="h-7 text-xs text-center font-bold bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                          />
                        </div>
                        <button
                          onClick={() => removeItem(idx)}
                          className="p-1 rounded-lg hover:bg-red-100 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>

                      {/* Mobile card */}
                      <div className="sm:hidden px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-medium text-[var(--dashboard-text)]">{item.stokKodu}</p>
                              {item.confidence === 'low' && (
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Eşleşmedi
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[var(--dashboard-muted)] truncate">{item.productName}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => updateItemField(idx, 'quantity', parseInt(e.target.value) || 0)}
                              className="h-7 w-14 text-center font-bold text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            />
                            <button onClick={() => removeItem(idx)} className="p-1">
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          {item.lot && <span className="text-[10px] text-[var(--dashboard-muted)]">Lot: <strong>{item.lot}</strong></span>}
                          {item.miad && <span className="text-[10px] text-[var(--dashboard-muted)]">SKT: <strong>{item.miad}</strong></span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6 border-t border-[var(--dashboard-stroke)]">
          <button
            onClick={handleModalClose}
            className="cihaz-tool-item px-4 py-2 text-xs sm:text-sm font-medium"
          >
            İptal
          </button>
          <button
            onClick={confirmAdd}
            disabled={validItemCount === 0 || !selectedFile}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={validItemCount > 0 ? { background: 'var(--dashboard-accent)', color: '#fff' } : { background: 'var(--dashboard-surface-2)', color: 'var(--dashboard-muted)' }}
          >
            <CheckCircle className="h-4 w-4" />
            Stoğa Aktar ({validItemCount})
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
