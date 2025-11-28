'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Camera, FileText, Scan, CheckCircle, AlertTriangle, Trash2, UploadCloud } from 'lucide-react';
import { extractTextFromPdf, renderFirstPageToBlob, ocrBlob } from '@/lib/pdf';
import { parseIrsaliyeText, IrsaliyeParseResult } from '@/lib/irsaliye-parser';
import type { ProductCode } from '@/lib/types';
import { CameraCapture } from './CameraCapture';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

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


  const processExtractedText = (text: string, source: 'Camera' | 'PDF') => {
    setOcrText(text);
    const rawItems = parseIrsaliyeText(text, productCodes);
    
    const processedItems = rawItems.map(item => {
        const product = productCodes.find(p => p.stokKodu === item.stokKodu);
        let finalQuantity = item.quantity || 1;
        let note = "";

        if (product && product.ambalajDegeri && product.ambalajDegeri > 1) {
            if (finalQuantity >= product.ambalajDegeri && Number.isInteger(finalQuantity / product.ambalajDegeri)) {
                const converted = finalQuantity / product.ambalajDegeri;
                note = `Dönüşüm: ${finalQuantity} Adet -> ${converted} ${product.anaBirim || 'Kutu'}`;
                finalQuantity = converted;
            }
        }

        return {
            ...item,
            productName: product?.stokAdi || "Bilinmeyen Ürün",
            quantity: finalQuantity,
            note: note,
            unit: product?.anaBirim || "Adet"
        };
    });

    setDetectedItems(prev => [...prev, ...processedItems]);
    
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

  const removeItem = (index: number) => {
    setDetectedItems(prev => prev.filter((_, i) => i !== index));
  };
  
  const handleModalClose = () => {
    setShowCamera(false);
    setProcessing(false);
    setImagePreview(null);
    setOcrText('');
    setDetectedItems([]);
    onClose();
  };

  const confirmAdd = () => {
    onResults(detectedItems);
    handleModalClose();
  };

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
            <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full mb-4">
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
              <TabsContent value="pdf" className="py-8 flex justify-center">
                <div className="flex items-center justify-center w-full max-w-md">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-slate-50 border-slate-300">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <UploadCloud className="w-8 h-8 mb-3 text-slate-400" />
                      <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">PDF Yüklemek için Tıkla</span></p>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={handlePdfUpload} disabled={processing} />
                  </label>
                </div>
              </TabsContent>
            </Tabs>
            {processing && (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-muted-foreground">Lütfen bekleyin, belge analiz ediliyor...</p>
                {imagePreview && <img src={imagePreview} alt="Preview" className="max-w-xs rounded-md" />}
              </div>
            )}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50 rounded-lg border">
              <div className="p-3 border-b bg-white font-semibold flex justify-between items-center">
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
                    {detectedItems.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border shadow-sm flex flex-col gap-2 relative group">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-primary text-lg">{item.stokKodu}</div>
                            <div className="text-sm text-slate-700">{item.productName}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-lg bg-green-50 text-green-700 px-2 py-1 rounded inline-block">
                              {item.quantity} {item.unit}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-500 border-t pt-2 mt-1">
                          {item.lot && (
                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded">
                              <span className="font-semibold">Lot:</span> {item.lot}
                            </div>
                          )}
                          {item.miad && (
                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded">
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
