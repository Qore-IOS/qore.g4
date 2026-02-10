'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Camera, FileText, Scan, CheckCircle, AlertTriangle, Trash2, UploadCloud, FolderOpen, FileSpreadsheet, Clock } from 'lucide-react';
import { extractTextFromPdf, renderFirstPageToBlob, ocrBlob } from '@/lib/pdf';
import { parseIrsaliyeText, IrsaliyeParseResult } from '@/lib/irsaliye-parser';
import type { ProductCode } from '@/lib/types';
import { CameraCapture } from './CameraCapture';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, Timestamp, where } from 'firebase/firestore';

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
}

interface IrsaliyeOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  onResults: (results: IrsaliyeParseResult[]) => void;
}

export default function IrsaliyeOcrModal({
  isOpen,
  onClose,
  productCodes,
  onResults,
}: IrsaliyeOcrModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [detectedItems, setDetectedItems] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'camera' | 'pdf'>('camera');
  const [pdfSource, setPdfSource] = useState<'upload' | 'files'>('upload');
  const [savedFiles, setSavedFiles] = useState<SavedIrsaliyeFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Load saved invoice files when PDF tab is active and "files" source is selected
  useEffect(() => {
    if (!isOpen) return;

    setLoadingFiles(true);
    const now = Timestamp.now();
    const q = query(
      collection(db, 'irsaliyeDosyalari'),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const files: SavedIrsaliyeFile[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // Only show non-expired files
        if (data.expiresAt && data.expiresAt.toMillis() > Date.now()) {
          files.push({ id: docSnap.id, ...data } as SavedIrsaliyeFile);
        }
      });
      setSavedFiles(files);
      setLoadingFiles(false);
    }, () => {
      setLoadingFiles(false);
    });

    return () => unsubscribe();
  }, [isOpen]);


  const processExtractedText = (text: string, source: 'Camera' | 'PDF') => {
    setOcrText(text);
    console.log(`[OCR Modal] Processing ${source} text, length: ${text.length}`);
    const rawItems = parseIrsaliyeText(text, productCodes);
    console.log(`[OCR Modal] Parser returned ${rawItems.length} items:`, rawItems);

    const processedItems = rawItems.map(item => {
        const product = productCodes.find(p => p.stokKodu === item.stokKodu);

        return {
            ...item,
            productName: product?.stokAdi || "Bilinmeyen Ürün",
            quantity: item.quantity || 1,
            unit: "Adet"
        };
    });

    setDetectedItems((prev: any[]) => [...prev, ...processedItems]);

    if (processedItems.length === 0) {
        toast({ title: `${source} tarandı ancak ürün/miktar eşleşmesi bulunamadı.`, variant: "default" });
    } else {
        toast({ title: "Başarılı", description: `${processedItems.length} ürün başarıyla ayrıştırıldı.` });
    }
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
      // Download via server-side API proxy to avoid CORS issues with Firebase Storage
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

  const handleModalClose = () => {
    setShowCamera(false);
    setProcessing(false);
    setImagePreview(null);
    setOcrText('');
    setDetectedItems([]);
    setPdfSource('upload');
    setSelectedFileId(null);
    onClose();
  };

  const confirmAdd = () => {
    onResults(detectedItems);
    handleModalClose();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pdfFiles = savedFiles.filter(f => f.fileType === 'pdf');

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Akıllı İrsaliye Tarama (OCR)</DialogTitle>
          <DialogDescription>
            Resim veya PDF formatındaki irsaliyeyi yükleyerek veya kamerasını kullanarak ürünleri otomatik olarak listeye ekleyin.
          </DialogDescription>
        </DialogHeader>

        {showCamera ? (
          <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden px-6">
            <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'camera' | 'pdf')} className="w-full mb-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="camera">Kamera ile Tara</TabsTrigger>
                <TabsTrigger value="pdf">PDF İrsaliye Yükle</TabsTrigger>
              </TabsList>
              <TabsContent value="camera" className="py-8 flex justify-center">
                <Button size="lg" className="h-24 w-64 text-lg gap-3" onClick={() => setShowCamera(true)} disabled={processing}>
                  <Camera className="h-8 w-8" />
                  {processing ? "İşleniyor..." : "Kamerayı Aç"}
                </Button>
              </TabsContent>
              <TabsContent value="pdf" className="py-4">
                {/* PDF Source Toggle */}
                <div className="flex gap-2 mb-4 justify-center">
                  <Button
                    variant={pdfSource === 'upload' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPdfSource('upload')}
                    className="gap-2"
                  >
                    <UploadCloud className="h-4 w-4" />
                    Dosya Yükle
                  </Button>
                  <Button
                    variant={pdfSource === 'files' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPdfSource('files')}
                    className="gap-2"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Dosyalardan Seç
                    {pdfFiles.length > 0 && (
                      <span className="ml-1 bg-primary-foreground text-primary text-xs px-1.5 py-0.5 rounded-full">
                        {pdfFiles.length}
                      </span>
                    )}
                  </Button>
                </div>

                {pdfSource === 'upload' ? (
                  <div className="flex items-center justify-center w-full max-w-md mx-auto">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-600">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <UploadCloud className="w-8 h-8 mb-3 text-slate-400" />
                        <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">PDF Yüklemek için Tıkla</span></p>
                      </div>
                      <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={handlePdfUpload} disabled={processing} />
                    </label>
                  </div>
                ) : (
                  <div className="w-full max-w-md mx-auto">
                    {loadingFiles ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : pdfFiles.length === 0 ? (
                      <div className="text-center py-8 border-2 border-dashed rounded-lg border-slate-300 dark:border-slate-600">
                        <FolderOpen className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                        <p className="text-sm text-muted-foreground mb-2">
                          Kayıtlı PDF dosyası bulunamadı.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Raporlama &gt; Dosya Yönetimi panelinden irsaliye yükleyebilirsiniz.
                        </p>
                      </div>
                    ) : (
                      <ScrollArea className="max-h-[200px] border rounded-lg">
                        <div className="divide-y">
                          {pdfFiles.map((file) => (
                            <button
                              key={file.id}
                              className="flex items-center gap-3 w-full p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left disabled:opacity-50"
                              onClick={() => handleSelectSavedFile(file)}
                              disabled={processing}
                            >
                              <FileText className="h-6 w-6 text-red-500 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{file.fileName}</p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{formatFileSize(file.fileSize)}</span>
                                  <span>{file.uploadedByName}</span>
                                </div>
                              </div>
                              {selectedFileId === file.id && processing ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                              ) : (
                                <Scan className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
            {processing && (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-muted-foreground">Lütfen bekleyin, belge analiz ediliyor...</p>
                {imagePreview && <img src={imagePreview} alt="Preview" className="max-w-xs rounded-md" />}
              </div>
            )}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-900 rounded-lg border">
              <div className="p-3 border-b bg-white dark:bg-slate-800 font-semibold flex justify-between items-center">
                <span>Tespit Edilen Kalemler ({detectedItems.length})</span>
                {detectedItems.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setDetectedItems([])} className="text-red-500 h-8">
                    Tümünü Temizle
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1 p-3">
                {detectedItems.length === 0 ? (
                  <div className="text-center text-muted-foreground py-10">
                    Henüz ürün taranmadı.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {detectedItems.map((item: any, idx: number) => (
                      <div key={idx} className="bg-white dark:bg-slate-800 p-3 rounded border shadow-sm flex flex-col gap-2 relative group">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-primary text-lg">{item.stokKodu}</div>
                            <div className="text-sm text-slate-700 dark:text-slate-300">{item.productName}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded inline-block">
                              {item.quantity} {item.unit}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-500 border-t pt-2 mt-1">
                          {item.lot && (
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                              <span className="font-semibold">Lot:</span> {item.lot}
                            </div>
                          )}
                          {item.miad && (
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                              <span className="font-semibold">SKT:</span> {item.miad}
                            </div>
                          )}
                        </div>
                        {item.note && (
                          <div className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                            <AlertTriangle className="h-3 w-3" />
                            {item.note}
                          </div>
                        )}
                        <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 h-6 w-6 bg-red-100 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
        <DialogFooter className="p-6 pt-4 border-t">
          <Button variant="ghost" onClick={handleModalClose}>İptal</Button>
          <Button onClick={confirmAdd} disabled={detectedItems.length === 0} className="gap-2">
            <CheckCircle className="h-4 w-4" />
            Listeye Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
