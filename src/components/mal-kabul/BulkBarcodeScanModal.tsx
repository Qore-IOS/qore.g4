'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import {
  Camera, X, Loader2, CheckCircle, AlertTriangle, Trash2, ImagePlus,
  Search, Eye, ZoomIn, RotateCcw, Sparkles, Upload,
} from 'lucide-react';
import type { ProductCode } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BulkScanResultItem {
  urunAdi: string;
  katalogNo: string;
  lotNo: string;
  skt: string;
  seriNo: string;
  gtin: string;
  barkodVerisi: string;
  confidence: 'high' | 'medium' | 'low';
  /** Resolved product from product database (matched after AI extraction) */
  matchedProduct?: ProductCode;
  /** Whether this item is selected for import */
  selected: boolean;
}

interface BulkBarcodeScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  onResults: (items: BulkScanResultItem[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchProductFromExtracted(
  item: Omit<BulkScanResultItem, 'matchedProduct' | 'selected'>,
  productCodes: ProductCode[]
): ProductCode | undefined {
  // 1. Try matching by katalogNo (reference/stok kodu)
  if (item.katalogNo) {
    const byKatalog = productCodes.find(
      (p) => p.stokKodu === item.katalogNo || (p as any).barcodeNumber === item.katalogNo
    );
    if (byKatalog) return byKatalog;
  }

  // 2. Try matching by GTIN
  if (item.gtin) {
    const byGtin = productCodes.find(
      (p) => (p as any).barcodeNumber === item.gtin || (p as any).gtin === item.gtin
    );
    if (byGtin) return byGtin;
  }

  // 3. Try matching by product name similarity (fuzzy)
  if (item.urunAdi) {
    const normalizedName = item.urunAdi.toLowerCase().replace(/\s+/g, ' ').trim();
    const byName = productCodes.find((p) => {
      const pName = (p.stokAdi || '').toLowerCase().replace(/\s+/g, ' ').trim();
      return pName === normalizedName || pName.includes(normalizedName) || normalizedName.includes(pName);
    });
    if (byName) return byName;
  }

  return undefined;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BulkBarcodeScanModal({
  isOpen,
  onClose,
  productCodes,
  onResults,
}: BulkBarcodeScanModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [results, setResults] = useState<BulkScanResultItem[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [enhanceResolution, setEnhanceResolution] = useState(true);
  const [aiNotes, setAiNotes] = useState('');

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, [images]);

  // ── Camera logic ──

  const startCamera = useCallback(async () => {
    setShowCamera(true);
    await new Promise((r) => setTimeout(r, 100)); // Wait for DOM

    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: 'Hata', description: 'Tarayıcınız kamera erişimini desteklemiyor.', variant: 'destructive' });
      setShowCamera(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (finalErr: any) {
        toast({
          title: 'Kamera Hatasi',
          description: finalErr.name === 'NotAllowedError'
            ? 'Kamera izni verilmedi.'
            : 'Kamera baslatilamadi: ' + finalErr.message,
          variant: 'destructive',
        });
        setShowCamera(false);
      }
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    // Use full resolution from the video stream
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `bulk-scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const preview = URL.createObjectURL(blob);
        setImages((prev) => [...prev, { file, preview }]);
        toast({ title: 'Fotograf eklendi', description: `${canvas.width}x${canvas.height} cozunurluk` });
      },
      'image/jpeg',
      0.95 // High quality for barcode readability
    );
  }, [toast]);

  const handleCameraClose = useCallback(() => {
    stopCamera();
    setShowCamera(false);
  }, [stopCamera]);

  // ── Gallery upload ──

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const newImages = files.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setImages((prev) => [...prev, ...newImages]);
      toast({ title: `${files.length} fotograf eklendi` });
      e.target.value = '';
    },
    [toast]
  );

  const removeImage = useCallback(
    (index: number) => {
      setImages((prev) => {
        const copy = [...prev];
        URL.revokeObjectURL(copy[index].preview);
        copy.splice(index, 1);
        return copy;
      });
    },
    []
  );

  // ── AI Analysis ──

  const analyzeImages = useCallback(async () => {
    if (images.length === 0) {
      toast({ title: 'Uyari', description: 'Lutfen en az bir fotograf ekleyin.', variant: 'default' });
      return;
    }

    setProcessing(true);
    setProcessingStatus('Fotograflar AI motoruna gonderiliyor...');
    setResults([]);
    setAiNotes('');

    try {
      const formData = new FormData();
      for (const img of images) {
        formData.append('images', img.file);
      }
      formData.append('enhanceResolution', String(enhanceResolution));

      setProcessingStatus('Gemini AI ile analiz ediliyor... Bu islem birden fazla urun icin biraz zaman alabilir.');

      const res = await fetch('/api/ai/bulk-barcode-scan', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Bilinmeyen hata' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.success || !data.products?.length) {
        toast({
          title: 'Sonuc bulunamadi',
          description: 'Fotograflarda okunabilir etiket veya barkod tespit edilemedi.',
          variant: 'default',
        });
        setProcessing(false);
        setProcessingStatus('');
        return;
      }

      // Match extracted products against the product database
      const matched: BulkScanResultItem[] = data.products.map((p: any) => {
        const matchedProduct = matchProductFromExtracted(p, productCodes);
        return {
          ...p,
          matchedProduct,
          selected: true,
        };
      });

      setResults(matched);
      setAiNotes(data.notes || '');

      const matchedCount = matched.filter((m) => m.matchedProduct).length;
      toast({
        title: `${matched.length} urun tespit edildi`,
        description: `${matchedCount} urun veritabaninda eslesti, ${matched.length - matchedCount} eslesme bulunamadi.`,
      });
    } catch (err: any) {
      console.error('Bulk barcode scan error:', err);
      toast({
        title: 'Analiz Hatasi',
        description: err.message || 'Fotograflar analiz edilirken bir hata olustu.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
  }, [images, enhanceResolution, productCodes, toast]);

  // ── Result editing ──

  const toggleItemSelection = useCallback((index: number) => {
    setResults((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item))
    );
  }, []);

  const removeResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateResultField = useCallback((index: number, field: string, value: string) => {
    setResults((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }, []);

  // ── Confirm & close ──

  const confirmResults = useCallback(() => {
    const selected = results.filter((r) => r.selected);
    if (selected.length === 0) {
      toast({ title: 'Uyari', description: 'Lutfen en az bir urun secin.', variant: 'default' });
      return;
    }
    onResults(selected);
    handleModalClose();
  }, [results, onResults, toast]);

  const handleModalClose = useCallback(() => {
    stopCamera();
    setShowCamera(false);
    setProcessing(false);
    setProcessingStatus('');
    setImages([]);
    setResults([]);
    setAiNotes('');
    onClose();
  }, [onClose, stopCamera]);

  const selectedCount = results.filter((r) => r.selected).length;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (showCamera) {
    return (
      <Dialog open={isOpen} onOpenChange={handleModalClose}>
        <DialogContent className="max-w-full h-[100dvh] p-0 gap-0 rounded-none border-none">
          <div className="relative w-full h-full bg-black flex flex-col">
            <video
              ref={videoRef}
              className="flex-1 w-full object-contain"
              playsInline
              autoPlay
              muted
            />
            {/* Overlay grid for alignment */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="w-full h-full border-2 border-white/20 m-0">
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/15" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/15" />
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/15" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/15" />
              </div>
              <div className="absolute top-4 left-0 right-0 text-center">
                <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                  Kutulari cerceve icine alin, yakindan veya uzaktan cekim yapabilirsiniz
                </span>
              </div>
            </div>

            {/* Camera controls */}
            <div className="absolute bottom-6 left-0 right-0 flex justify-center items-center gap-6">
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={handleCameraClose}
              >
                <X className="h-6 w-6" />
              </Button>
              <Button
                size="icon"
                className="h-20 w-20 rounded-full bg-white border-4 border-gray-300 hover:bg-gray-100 transition-all active:scale-95 ring-2 ring-offset-2 ring-offset-black ring-white"
                onClick={capturePhoto}
              >
                <Camera className="h-8 w-8 text-black" />
              </Button>
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                  onClick={handleCameraClose}
                >
                  <CheckCircle className="h-6 w-6" />
                </Button>
                {images.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                    {images.length}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 sm:px-6 border-b border-[var(--dashboard-stroke)]">
          <DialogTitle className="flex items-center gap-2 text-[var(--dashboard-text)]">
            <Sparkles className="h-5 w-5 text-[var(--dashboard-accent)]" />
            AI Toplu Barkod Tarama
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--dashboard-muted)]">
            Kutularin fotografini cekin veya galeriden yukleyin. AI tum etiketleri ve barkodlari analiz edecek.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ── Image sources ── */}
          {results.length === 0 && (
            <div className="px-5 pt-4 sm:px-6">
              {/* Action buttons */}
              <div className="flex flex-wrap gap-3 justify-center mb-4">
                <button
                  onClick={startCamera}
                  disabled={processing}
                  className="cihaz-action-tile flex flex-col items-center justify-center gap-2 w-44 h-24 disabled:opacity-50"
                >
                  <Camera className="h-7 w-7 text-[var(--dashboard-accent)]" />
                  <span className="text-xs font-medium text-[var(--dashboard-text)]">Fotograf Cek</span>
                  <span className="text-[10px] text-[var(--dashboard-muted)]">4K / 8K destekli</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processing}
                  className="cihaz-action-tile flex flex-col items-center justify-center gap-2 w-44 h-24 disabled:opacity-50"
                >
                  <Upload className="h-7 w-7 text-[var(--dashboard-accent)]" />
                  <span className="text-xs font-medium text-[var(--dashboard-text)]">Galeriden Sec</span>
                  <span className="text-[10px] text-[var(--dashboard-muted)]">Birden fazla fotograf</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Selected images preview */}
              {images.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[var(--dashboard-text)]">
                      Secilen Fotograflar ({images.length})
                    </span>
                    <button
                      onClick={() => {
                        images.forEach((img) => URL.revokeObjectURL(img.preview));
                        setImages([]);
                      }}
                      className="text-[10px] font-medium text-red-500 hover:text-red-700"
                    >
                      Tumunu Kaldir
                    </button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-[var(--dashboard-stroke)]">
                        <img
                          src={img.preview}
                          alt={`Fotograf ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeImage(idx)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {/* Add more button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-[var(--dashboard-stroke)] flex flex-col items-center justify-center gap-1 hover:border-[var(--dashboard-accent)] transition-colors"
                    >
                      <ImagePlus className="h-5 w-5 text-[var(--dashboard-muted)]" />
                      <span className="text-[10px] text-[var(--dashboard-muted)]">Ekle</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Enhancement toggle */}
              {images.length > 0 && (
                <div className="flex items-center justify-between mb-4 px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)]">
                  <div className="flex items-center gap-2">
                    <ZoomIn className="h-4 w-4 text-[var(--dashboard-accent)]" />
                    <div>
                      <p className="text-xs font-medium text-[var(--dashboard-text)]">AI Cozunurluk Artirma</p>
                      <p className="text-[10px] text-[var(--dashboard-muted)]">Bulanik etiketler icin super-resolution</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEnhanceResolution(!enhanceResolution)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      enhanceResolution ? 'bg-[var(--dashboard-accent)]' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        enhanceResolution ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Analyze button */}
              {images.length > 0 && !processing && (
                <button
                  onClick={analyzeImages}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold transition-all"
                  style={{ background: 'var(--dashboard-accent)', color: '#fff' }}
                >
                  <Sparkles className="h-4 w-4" />
                  AI ile Analiz Et ({images.length} fotograf)
                </button>
              )}
            </div>
          )}

          {/* ── Processing indicator ── */}
          {processing && (
            <div className="flex flex-col items-center gap-3 py-8 px-5">
              <div className="relative">
                <Loader2 className="w-12 h-12 animate-spin text-[var(--dashboard-accent)]" />
                <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-yellow-500 animate-pulse" />
              </div>
              <p className="text-sm font-medium text-[var(--dashboard-text)]">Gemini AI Analiz Ediyor</p>
              <p className="text-xs text-[var(--dashboard-muted)] text-center max-w-sm">{processingStatus}</p>
              {/* Thumbnail strip during processing */}
              <div className="flex gap-1.5 mt-2">
                {images.slice(0, 6).map((img, idx) => (
                  <div key={idx} className="w-12 h-12 rounded-lg overflow-hidden border border-[var(--dashboard-stroke)] opacity-60">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
                {images.length > 6 && (
                  <div className="w-12 h-12 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center text-[10px] text-[var(--dashboard-muted)]">
                    +{images.length - 6}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Results table ── */}
          {results.length > 0 && (
            <div className="flex-1 overflow-hidden flex flex-col mx-5 mb-4 sm:mx-6 rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
              <div className="px-4 py-2.5 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] flex justify-between items-center rounded-t-2xl">
                <div>
                  <span className="text-xs font-semibold text-[var(--dashboard-text)]">
                    Tespit Edilen Urunler
                    <span className="ml-1.5 text-[var(--dashboard-muted)]">({results.length})</span>
                  </span>
                  {aiNotes && (
                    <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">{aiNotes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setResults([]);
                      setAiNotes('');
                    }}
                    className="flex items-center gap-1 text-[10px] font-medium text-[var(--dashboard-accent)] hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Yeniden Tara
                  </button>
                  <button
                    onClick={() => setResults([])}
                    className="text-[10px] font-medium text-red-500 hover:text-red-700"
                  >
                    Temizle
                  </button>
                </div>
              </div>

              {/* Table header - desktop */}
              <div className="hidden sm:grid grid-cols-[32px_2fr_1fr_1fr_1fr_1fr_32px] gap-2 px-4 py-1.5 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)]">
                <span></span>
                <span>Urun</span>
                <span>Lot No</span>
                <span>SKT</span>
                <span>Seri No / LSN</span>
                <span>Guven</span>
                <span></span>
              </div>

              <ScrollArea className="flex-1">
                <div className="divide-y divide-[var(--dashboard-stroke)]">
                  {results.map((item, idx) => (
                    <div key={idx} className="relative group">
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[32px_2fr_1fr_1fr_1fr_1fr_32px] gap-2 items-center px-4 py-2.5 hover:bg-[var(--dashboard-surface-2)]/60">
                        <div>
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleItemSelection(idx)}
                            className="w-4 h-4 rounded border-[var(--dashboard-stroke)] accent-[var(--dashboard-accent)]"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">
                              {item.matchedProduct?.stokAdi || item.urunAdi || 'Bilinmeyen Urun'}
                            </p>
                            {item.matchedProduct ? (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 shrink-0">
                                <CheckCircle className="h-2.5 w-2.5" />
                                Eslesti
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 shrink-0">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Eslesme yok
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">
                            {item.matchedProduct?.stokKodu || item.katalogNo || '-'}
                          </p>
                        </div>
                        <div>
                          <Input
                            value={item.lotNo}
                            onChange={(e) => updateResultField(idx, 'lotNo', e.target.value)}
                            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            placeholder="-"
                          />
                        </div>
                        <div>
                          <Input
                            value={item.skt}
                            onChange={(e) => updateResultField(idx, 'skt', e.target.value)}
                            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            placeholder="-"
                          />
                        </div>
                        <div>
                          <Input
                            value={item.seriNo}
                            onChange={(e) => updateResultField(idx, 'seriNo', e.target.value)}
                            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                            placeholder="-"
                          />
                        </div>
                        <div>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              item.confidence === 'high'
                                ? 'bg-emerald-100 text-emerald-700'
                                : item.confidence === 'medium'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.confidence === 'high' ? 'Yuksek' : item.confidence === 'medium' ? 'Orta' : 'Dusuk'}
                          </span>
                        </div>
                        <button
                          onClick={() => removeResult(idx)}
                          className="p-1 rounded-lg hover:bg-red-100 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>

                      {/* Mobile card */}
                      <div className="sm:hidden px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={() => toggleItemSelection(idx)}
                              className="w-4 h-4 rounded accent-[var(--dashboard-accent)]"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-medium text-[var(--dashboard-text)]">
                                  {item.matchedProduct?.stokAdi || item.urunAdi || 'Bilinmeyen'}
                                </p>
                                {item.matchedProduct ? (
                                  <span className="text-[10px] text-emerald-700 bg-emerald-100 px-1 py-0.5 rounded">Eslesti</span>
                                ) : (
                                  <span className="text-[10px] text-amber-700 bg-amber-100 px-1 py-0.5 rounded">Eslesme yok</span>
                                )}
                              </div>
                              <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">
                                {item.matchedProduct?.stokKodu || item.katalogNo}
                              </p>
                            </div>
                          </div>
                          <button onClick={() => removeResult(idx)} className="p-1">
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2 ml-6 text-[10px] text-[var(--dashboard-muted)]">
                          {item.lotNo && <span>Lot: <strong>{item.lotNo}</strong></span>}
                          {item.skt && <span>SKT: <strong>{item.skt}</strong></span>}
                          {item.seriNo && <span>SN: <strong>{item.seriNo}</strong></span>}
                          <span
                            className={`px-1 py-0.5 rounded ${
                              item.confidence === 'high'
                                ? 'bg-emerald-100 text-emerald-700'
                                : item.confidence === 'medium'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.confidence === 'high' ? 'Yuksek' : item.confidence === 'medium' ? 'Orta' : 'Dusuk'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Empty state when no images and no results */}
          {images.length === 0 && results.length === 0 && !processing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                <Eye className="h-7 w-7 text-[var(--dashboard-muted)]" />
              </div>
              <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">
                Toplu Barkod Tarama
              </p>
              <p className="text-xs text-[var(--dashboard-muted)] max-w-sm">
                Kutularin fotografini cekin veya galeriden yukleyin. Gemini AI tum etiketleri, barkodlari, seri numaralarini otomatik okuyacak.
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6 border-t border-[var(--dashboard-stroke)]">
          <button
            onClick={handleModalClose}
            className="cihaz-tool-item px-4 py-2 text-xs sm:text-sm font-medium"
          >
            Iptal
          </button>
          {results.length > 0 && (
            <button
              onClick={confirmResults}
              disabled={selectedCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                selectedCount > 0
                  ? { background: 'var(--dashboard-accent)', color: '#fff' }
                  : { background: 'var(--dashboard-surface-2)', color: 'var(--dashboard-muted)' }
              }
            >
              <CheckCircle className="h-4 w-4" />
              Mal Kabule Aktar ({selectedCount})
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
