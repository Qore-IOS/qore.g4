'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Camera, FileText, Scan, CheckCircle, AlertTriangle, Trash2, UploadCloud, FolderOpen, FileSpreadsheet, Clock, Search } from 'lucide-react';
import { extractTextFromPdf, renderFirstPageToBlob, ocrBlob } from '@/lib/pdf';
import { parseIrsaliyeText, IrsaliyeParseResult } from '@/lib/irsaliye-parser';
import type { ProductCode } from '@/lib/types';
import { CameraCapture } from './CameraCapture';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, Timestamp, where } from 'firebase/firestore';
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

interface IrsaliyeOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  onResults: (results: IrsaliyeParseResult[]) => void;
  locationType?: 'depot' | 'hospital';
  locationId?: string;
}

export default function IrsaliyeOcrModal({
  isOpen,
  onClose,
  productCodes,
  onResults,
  locationType,
  locationId,
}: IrsaliyeOcrModalProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [detectedItems, setDetectedItems] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'camera' | 'pdf'>('camera');
  const [savedFiles, setSavedFiles] = useState<SavedIrsaliyeFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Load saved invoice files
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


  const processExtractedText = (text: string, source: 'Camera' | 'PDF') => {
    setOcrText(text);
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
      }

      const processedItems = rawItems.map(item => {
          const product = productCodes.find(p => p.stokKodu === item.stokKodu);
          return {
              ...item,
              productName: product?.stokAdi || "Bilinmeyen Ürün",
              quantity: item.quantity || 1,
              unit: "Adet",
              confidence: product ? 'high' : 'low',
          };
      });

      setDetectedItems((prev: any[]) => [...prev, ...processedItems]);

      if (processedItems.length === 0) {
          toast({ title: `${source} tarandı ancak ürün/miktar eşleşmesi bulunamadı.`, variant: "default" });
      } else {
          toast({ title: "Başarılı", description: `${processedItems.length} ürün başarıyla ayrıştırıldı.` });
      }
    })();
  };

  const handleCapture = async (blob: Blob | null) => {
    setShowCamera(false);
    if (!blob) return;

    setProcessing(true);
    setImagePreview(URL.createObjectURL(blob));
    toast({ title: 'İşleniyor', description: 'Çekilen fotoğraf analiz ediliyor...' });

    try {
      const text = await ocrBlob(blob);
      processExtractedText(text, 'Camera');
    } catch (error: any) {
      toast({ title: 'OCR Hatası', description: error.message || 'Fotoğraf işlenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setDetectedItems([]);
    toast({ title: 'İşleniyor', description: 'PDF verileri okunuyor...' });

    try {
      const text = await extractTextFromPdf(file);
      processExtractedText(text, 'PDF');
    } catch (error: any) {
      console.error("PDF Error:", error);
      toast({ title: 'PDF Okuma Hatası', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const handleSelectSavedFile = async (file: SavedIrsaliyeFile) => {
    if (file.fileType !== 'pdf') {
      toast({
        title: 'Desteklenmiyor',
        description: 'OCR taraması sadece PDF dosyaları için desteklenmektedir.',
        variant: 'destructive',
      });
      return;
    }

    setProcessing(true);
    setSelectedFileId(file.id);
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
      processExtractedText(text, 'PDF');
    } catch (error: any) {
      console.error("Saved PDF Error:", error);
      toast({
        title: 'PDF Okuma Hatası',
        description: error.message || 'Kayıtlı dosya işlenirken bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
      setSelectedFileId(null);
    }
  };

  const removeItem = (index: number) => {
    setDetectedItems((prev: any[]) => prev.filter((_: any, i: number) => i !== index));
  };

  const updateItemField = (index: number, field: string, value: string | number) => {
    setDetectedItems((prev: any[]) => prev.map((item: any, i: number) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleModalClose = () => {
    setShowCamera(false);
    setProcessing(false);
    setImagePreview(null);
    setOcrText('');
    setDetectedItems([]);
    setSelectedFileId(null);
    onClose();
  };

  const confirmAdd = () => {
    const validItems = detectedItems.filter((item: any) => item.stokKodu && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: 'Uyarı', description: 'Eklenecek geçerli kalem bulunamadı.', variant: 'default' });
      return;
    }
    onResults(validItems);
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
            İrsaliye Tara (OCR)
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--dashboard-muted)]">
            Kamera veya PDF ile irsaliyeyi tarayın, tespit edilen kalemleri kontrol edip listeye ekleyin.
          </DialogDescription>
        </DialogHeader>

        {showCamera ? (
          <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Source selector */}
            <div className="px-5 pt-4 sm:px-6">
              <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'camera' | 'pdf')} className="w-full">
                <TabsList className="grid w-full grid-cols-2 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-1">
                  <TabsTrigger value="camera" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)]">
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                    Kamera ile Tara
                  </TabsTrigger>
                  <TabsTrigger value="pdf" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)]">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    PDF / Dosya
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="camera" className="py-6 flex justify-center">
                  <button
                    onClick={() => setShowCamera(true)}
                    disabled={processing}
                    className="cihaz-action-tile flex flex-col items-center justify-center gap-3 w-56 h-28 disabled:opacity-50"
                  >
                    <Camera className="h-8 w-8 text-[var(--dashboard-accent)]" />
                    <span className="text-sm font-medium text-[var(--dashboard-text)]">
                      {processing ? "İşleniyor..." : "Kamerayı Aç"}
                    </span>
                  </button>
                </TabsContent>

                <TabsContent value="pdf" className="py-4">
                  {/* Unified dropzone + saved files */}
                  <div className="space-y-3 max-w-lg mx-auto">
                    {/* Primary: Dropzone for upload */}
                    <label className="flex flex-col items-center justify-center w-full h-28 rounded-2xl cursor-pointer transition-all bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] hover:shadow-[var(--dashboard-raised-soft)] border-2 border-dashed border-[var(--dashboard-stroke)]">
                      <UploadCloud className="w-7 h-7 mb-2 text-[var(--dashboard-accent)]" />
                      <p className="text-sm font-medium text-[var(--dashboard-text)]">PDF Dosya Seç veya Sürükle</p>
                      <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">PDF / JPG / PNG</p>
                      <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handlePdfUpload} disabled={processing} />
                    </label>

                    {/* Saved files list */}
                    {pdfFiles.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-2">Kayıtlı Dosyalar</p>
                        <ScrollArea className="max-h-[140px] rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
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
                                {selectedFileId === file.id && processing ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-[var(--dashboard-accent)] shrink-0" />
                                ) : (
                                  <Scan className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Processing indicator */}
            {processing && (
              <div className="flex flex-col items-center gap-3 py-4 px-5">
                <Loader2 className="w-10 h-10 animate-spin text-[var(--dashboard-accent)]" />
                <p className="text-xs text-[var(--dashboard-muted)]">Belge analiz ediliyor...</p>
                {imagePreview && <img src={imagePreview} alt="Preview" className="max-w-xs rounded-xl" />}
              </div>
            )}

            {/* Detected items – inline editable table */}
            <div className="flex-1 overflow-hidden flex flex-col mx-5 mb-4 sm:mx-6 rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
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

              {/* Table header */}
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
                    <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">Yukarıdan kamera veya dosya seçin.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--dashboard-stroke)]">
                    {detectedItems.map((item: any, idx: number) => (
                      <div key={idx} className="relative group">
                        {/* Desktop: inline row */}
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

                        {/* Mobile: card row */}
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
                            {item.lot && (
                              <span className="text-[10px] text-[var(--dashboard-muted)]">Lot: <strong>{item.lot}</strong></span>
                            )}
                            {item.miad && (
                              <span className="text-[10px] text-[var(--dashboard-muted)]">SKT: <strong>{item.miad}</strong></span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}

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
            disabled={validItemCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={validItemCount > 0 ? { background: 'var(--dashboard-accent)', color: '#fff' } : { background: 'var(--dashboard-surface-2)', color: 'var(--dashboard-muted)' }}
          >
            <CheckCircle className="h-4 w-4" />
            Listeye Ekle ({validItemCount})
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
