'use client';
import { extractTextFromPdf, renderPdfPagesToImages } from '@/lib/pdf';
import type { BekleyenIrsaliyeItem, ProductCode } from '@/lib/types';
import { addDoc, collection, Timestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';

/**
 * Yüklenen bir PDF'i indirip Gemini Vision endpoint'inden geçirir ve sonucu
 * doğrudan `bekleyenIrsaliyeler` koleksiyonuna yazar. UI'a iş havalesi yapan
 * dosya-yönetimi sayfası kullanır; manuel modal (`IrsaliyeScanModal`) ile aynı
 * Vision API çağrısını paylaşır, sadece kullanıcı etkileşimi yoktur.
 */
export interface AutoScanInput {
  fileId: string;
  fileName: string;
  storagePath: string;
  downloadURL: string;
  locationType: 'hospital' | 'depot';
  locationId: string;
  locationName: string;
  productCodes: ProductCode[];
  /** companyId — `withCompanyScope` etiketi için. */
  companyId?: string | null;
  /** İşlemi yapan kullanıcı (loglama amaçlı). */
  user?: { uid?: string | null; name?: string | null };
}

export interface AutoScanOutcome {
  ok: boolean;
  bekleyenIrsaliyeId?: string;
  itemCount?: number;
  matchedCount?: number;
  error?: string;
}

interface ScanItemFromApi {
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

interface ScanApiResponse {
  irsaliyeNumber?: string;
  irsaliyeDate?: string;
  supplierName?: string;
  notes?: string;
  brands: string[];
  itemCount: number;
  totalConvertedQuantity: number;
  items: ScanItemFromApi[];
  scanModel?: string;
}

export async function autoScanIrsaliyeFile(input: AutoScanInput): Promise<AutoScanOutcome> {
  try {
    // 1. PDF indir
    const resp = await fetch('/api/storage/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: input.storagePath }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error || 'PDF indirilemedi.');
    }
    const blob = await resp.blob();
    const pdfFile = new File([blob], input.fileName, { type: 'application/pdf' });

    // 2. Sayfalar görüntüye + yardımcı metin paralel.
    const [images, ocrText] = await Promise.all([
      renderPdfPagesToImages(pdfFile, { scale: 2.0, quality: 0.85, maxPages: 8 }),
      extractTextFromPdf(pdfFile).catch(() => ''),
    ]);
    if (images.length === 0) throw new Error('PDF sayfaları okunamadı.');

    // 3. Vision API çağrısı (manuel modal ile aynı endpoint).
    const formData = new FormData();
    images.forEach((img, idx) => {
      formData.append('images', new File([img], `page-${idx + 1}.jpg`, { type: 'image/jpeg' }));
    });
    const compactProducts = input.productCodes.slice(0, 1500).map(p => ({
      stokKodu: p.stokKodu,
      stokAdi: p.stokAdi,
      marka: p.marka,
      anaBirim: p.anaBirim,
      ambalajDegeri: p.ambalajDegeri,
    }));
    formData.append('products', JSON.stringify(compactProducts));
    formData.append('ocrText', ocrText.slice(0, 12000));

    const scanRes = await fetch('/api/ai/irsaliye-scan', { method: 'POST', body: formData });
    const scanData: ScanApiResponse | { error?: string } = await scanRes.json().catch(() => ({} as any));
    if (!scanRes.ok) {
      throw new Error((scanData as any)?.error || 'Tarama başarısız.');
    }
    const result = scanData as ScanApiResponse;
    const matchedItems = (result.items || []).filter(i => i.stokKodu && i.matchedBy !== 'none' && i.convertedQuantity > 0);
    if (matchedItems.length === 0) {
      // Hiçbir ürün eşleşmediyse Firestore'a yazmıyoruz — kullanıcı manuel
      // moddan deneyebilsin.
      return { ok: false, itemCount: result.items?.length ?? 0, matchedCount: 0, error: 'Hiç ürün eşleşmedi.' };
    }

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

    const docRef = await addDoc(
      collection(db, 'bekleyenIrsaliyeler'),
      withCompanyScope({
        dosyaId: input.fileId,
        dosyaName: input.fileName,
        storagePath: input.storagePath,
        downloadURL: input.downloadURL,
        locationType: input.locationType,
        locationId: input.locationId,
        locationName: input.locationName,
        irsaliyeNumber: result.irsaliyeNumber || undefined,
        irsaliyeDate: result.irsaliyeDate || undefined,
        supplierName: result.supplierName || undefined,
        brands,
        itemCount: itemsToSave.length,
        totalConvertedQuantity: totalConverted,
        items: itemsToSave,
        status: 'pending',
        scannedAt: Timestamp.now(),
        scannedByUid: input.user?.uid || null,
        scannedByName: input.user?.name || 'Otomatik Tarama',
        aiNotes: result.notes || undefined,
        scanModel: result.scanModel || undefined,
        autoScanned: true,
      }, input.companyId),
    );

    // Stoğa aktarılan irsaliyenin orijinal dosyasını veritabanından ve depolamadan otomatik sil
    try {
      await fetch('/api/storage/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: input.storagePath }),
      }).catch((e) => console.warn('[auto-scan] Storage delete failed:', e));

      await deleteDoc(doc(db, 'irsaliyeDosyalari', input.fileId));
    } catch (delErr) {
      console.error('[auto-scan] delete doc failed:', delErr);
    }

    return {
      ok: true,
      bekleyenIrsaliyeId: docRef.id,
      itemCount: result.items?.length ?? 0,
      matchedCount: matchedItems.length,
    };
  } catch (err: any) {
    console.error('[auto-scan] error', err);
    return { ok: false, error: err?.message || 'Otomatik tarama başarısız.' };
  }
}
