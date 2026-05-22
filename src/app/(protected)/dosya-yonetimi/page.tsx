'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { useDepots, useHospitals } from '@/hooks/useFirebaseQueries';
import { matchesCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  where,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import {
  FileText,
  Trash2,
  Loader2,
  FileSpreadsheet,
  FolderOpen,
  Clock,
  Download,
  FileUp,
  AlertCircle,
  Scan,
  CheckCircle2,
  Wand2,
  HelpCircle,
} from 'lucide-react';
import BackButton from '@/components/BackButton';
import CeomedIrsaliyePanel from '@/components/ceomed/CeomedIrsaliyePanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import IrsaliyeScanModal from '@/components/dosya-yonetimi/IrsaliyeScanModal';
import { useProductCodes } from '@/hooks/useFirebaseQueries';
import { matchLocationFromFileName, type LocationCandidate } from '@/lib/match-location-from-filename';
import { autoScanIrsaliyeFile } from '@/lib/irsaliye-auto-scan';
import { Switch } from '@/components/ui/switch';

interface IrsaliyeDosya {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'xlsx' | 'xls';
  fileSize: number;
  storagePath: string;
  downloadURL: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
  expiresAt: Timestamp;
  companyId?: string;
  locationType?: 'hospital' | 'depot';
  locationId?: string;
  locationName?: string;
}

export default function DosyaYonetimiPage() {
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: depots = [] } = useDepots();
  const { data: hospitals = [] } = useHospitals();

  const [dosyalar, setDosyalar] = useState<IrsaliyeDosya[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedLocationType, setSelectedLocationType] = useState<'hospital' | 'depot' | ''>('');
  /** Eşleşmeyen dosyalar için kullanıcı isterse manuel varsayılan konum. */
  const [defaultLocationId, setDefaultLocationId] = useState<string>('');
  const [scanningFile, setScanningFile] = useState<IrsaliyeDosya | null>(null);
  const [pendingScannedDosyaIds, setPendingScannedDosyaIds] = useState<Set<string>>(new Set());
  /** Yüklemeden sonra arka planda otomatik tarama başlatılsın mı. */
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  /** Şu an arka planda taranan dosya kimliği (UI feedback için). */
  const [autoScanningId, setAutoScanningId] = useState<string | null>(null);
  /** Sırada taranmak için bekleyen dosya kimlikleri. */
  const [autoScanQueue, setAutoScanQueue] = useState<string[]>([]);
  const { data: productCodes = [] } = useProductCodes();

  // Listen to irsaliye files in real-time
  useEffect(() => {
    const q = query(
      collection(db, 'irsaliyeDosyalari'),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const files: IrsaliyeDosya[] = [];
      snapshot.forEach((docSnap) => {
        const file = { id: docSnap.id, ...docSnap.data() } as IrsaliyeDosya;
        if (matchesCompanyScope(file, currentCompanyId, isSuperAdmin)) {
          files.push(file);
        }
      });
      setDosyalar(files);
      setLoading(false);
    }, (error) => {
      console.error('Dosya listesi yüklenirken hata:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentCompanyId, isSuperAdmin]);

  // Track which uploaded files already have a pending scanned invoice waiting
  // for transfer — so we can show a "Onaylandı, lab stoğa gönderildi" badge.
  useEffect(() => {
    const q = query(collection(db, 'bekleyenIrsaliyeler'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ids = new Set<string>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (!matchesCompanyScope(data, currentCompanyId, isSuperAdmin)) return;
        if (data?.status === 'pending' && data?.dosyaId) ids.add(String(data.dosyaId));
      });
      setPendingScannedDosyaIds(ids);
    }, (error) => {
      console.error('Bekleyen irsaliyeler dinlenemiyor:', error);
    });
    return () => unsubscribe();
  }, [currentCompanyId, isSuperAdmin]);

  /**
   * Background queue: kuyrukta dosya varsa ve şu an taranan biri yoksa,
   * baştaki dosyayı al → Vision ile tara → `bekleyenIrsaliyeler`'e yaz.
   * Tek seferde tek dosya tarar (rate-limit dostu).
   */
  useEffect(() => {
    if (autoScanningId || autoScanQueue.length === 0) return;
    if (productCodes.length === 0) return;
    const fileId = autoScanQueue[0];
    const file = dosyalar.find(d => d.id === fileId);
    if (!file) {
      // dosya henüz snapshot'a düşmemiş olabilir — sıradakini bekle.
      setAutoScanQueue(q => q.slice(1));
      return;
    }
    if (file.fileType !== 'pdf' || !file.locationType || !file.locationId) {
      setAutoScanQueue(q => q.slice(1));
      return;
    }
    if (pendingScannedDosyaIds.has(fileId)) {
      // Zaten bekleyen irsaliye var, tekrar tarama.
      setAutoScanQueue(q => q.slice(1));
      return;
    }
    let cancelled = false;
    (async () => {
      setAutoScanningId(fileId);
      const outcome = await autoScanIrsaliyeFile({
        fileId: file.id,
        fileName: file.fileName,
        storagePath: file.storagePath,
        downloadURL: file.downloadURL,
        locationType: (file.locationType || 'hospital') as 'hospital' | 'depot',
        locationId: file.locationId || '',
        locationName: file.locationName || '',
        productCodes,
        companyId: currentCompanyId,
        user: {
          uid: currentUser?.uid || null,
          name: currentUserProfile?.displayName || currentUserProfile?.email || null,
        },
      });
      if (cancelled) return;
      if (outcome.ok) {
        toast({
          title: 'Otomatik tarandı',
          description: `${file.fileName}: ${outcome.matchedCount} ürün eşleşti, bekleyen irsaliyelere eklendi.`,
        });
      } else if (outcome.error) {
        toast({
          title: 'Otomatik tarama başarısız',
          description: `${file.fileName}: ${outcome.error}. Manuel "Tara" ile tekrar deneyebilirsiniz.`,
          variant: 'destructive',
        });
      }
      setAutoScanningId(null);
      setAutoScanQueue(q => q.slice(1));
    })();
    return () => { cancelled = true; };
  }, [
    autoScanningId,
    autoScanQueue,
    dosyalar,
    productCodes,
    currentCompanyId,
    currentUser,
    currentUserProfile,
    pendingScannedDosyaIds,
    toast,
  ]);

  /** Eşleşen ama taranmamış dosyalar için "Tümünü Otomatik Tara" butonu. */
  const queueAutoScanForUnscannedMatched = useCallback(() => {
    const ids: string[] = [];
    for (const f of dosyalar) {
      if (f.fileType !== 'pdf') continue;
      if (!f.locationId) continue;
      if (pendingScannedDosyaIds.has(f.id)) continue;
      ids.push(f.id);
    }
    if (ids.length === 0) {
      toast({ title: 'Tarama gerekmez', description: 'Eşleşen tüm dosyalar zaten taranmış görünüyor.' });
      return;
    }
    setAutoScanQueue(prev => [...prev, ...ids.filter(id => !prev.includes(id))]);
    toast({ title: 'Kuyruğa eklendi', description: `${ids.length} dosya arka planda taranıyor.` });
  }, [dosyalar, pendingScannedDosyaIds, toast]);

  // Clean up expired files on mount
  useEffect(() => {
    const cleanupExpired = async () => {
      try {
        const now = Timestamp.now();
        const expiredQuery = query(
          collection(db, 'irsaliyeDosyalari'),
          where('expiresAt', '<=', now)
        );
        const snapshot = await getDocs(expiredQuery);
        let deletedCount = 0;

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          if (!matchesCompanyScope(data as any, currentCompanyId, isSuperAdmin)) {
            continue;
          }
          try {
            await fetch('/api/storage/delete-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storagePath: data.storagePath }),
            });
          } catch {
            // File may already be deleted from storage
          }
          await deleteDoc(doc(db, 'irsaliyeDosyalari', docSnap.id));
          deletedCount += 1;
        }

        if (deletedCount > 0) {
          toast({
            title: 'Temizlik',
            description: `${deletedCount} süresi dolmuş dosya silindi.`,
          });
        }
      } catch (error) {
        console.error('Süresi dolmuş dosyalar temizlenirken hata:', error);
      }
    };

    cleanupExpired();
  }, [toast, currentCompanyId, isSuperAdmin]);

  const locationCandidates: LocationCandidate[] = useMemo(() => {
    if (selectedLocationType === 'hospital') {
      return hospitals.map((h: any) => ({ id: h.id, name: h.name || h.ad || '', kod: h.kod }));
    }
    if (selectedLocationType === 'depot') {
      return depots.map((d: any) => ({ id: d.id, name: d.name || '', kod: d.kod }));
    }
    return [];
  }, [selectedLocationType, hospitals, depots]);

  const findLocationName = useCallback((locId: string): string => {
    if (selectedLocationType === 'hospital') {
      const h = hospitals.find((x: any) => x.id === locId);
      return (h?.name || h?.ad || '') as string;
    }
    return (depots.find((d: any) => d.id === locId)?.name || '') as string;
  }, [selectedLocationType, hospitals, depots]);

  /** Konum atanmamış bir dosyayı manuel olarak konumla eşleştir. */
  const assignLocationToFile = useCallback(async (dosya: IrsaliyeDosya, locId: string) => {
    const name = findLocationName(locId);
    if (!name) return;
    try {
      await updateDoc(doc(db, 'irsaliyeDosyalari', dosya.id), {
        locationType: selectedLocationType,
        locationId: locId,
        locationName: name,
        autoMatchedLocation: false,
      });
      toast({ title: 'Konum atandı', description: `${dosya.fileName} → ${name}` });
      if (autoScanEnabled && dosya.fileType === 'pdf') {
        setAutoScanQueue(prev => prev.includes(dosya.id) ? prev : [...prev, dosya.id]);
      }
    } catch (err: any) {
      toast({ title: 'Hata', description: err?.message || 'Konum atanamadı.', variant: 'destructive' });
    }
  }, [findLocationName, selectedLocationType, autoScanEnabled, toast]);

  const processFile = useCallback(async (file: File): Promise<{ ok: boolean; matched: boolean; docId?: string; locationId?: string; locationName?: string }> => {
    if (!currentUser) return { ok: false, matched: false };
    if (!selectedLocationType) {
      toast({
        title: 'Kategori seçimi gerekli',
        description: 'Yükleme öncesinde dosyanın bağlı olduğu kategoriyi (Hastane veya Depo) seçin.',
        variant: 'destructive',
      });
      return { ok: false, matched: false };
    }

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Geçersiz Dosya',
        description: `${file.name} desteklenmiyor. Sadece PDF ve Excel (.xlsx, .xls).`,
        variant: 'destructive',
      });
      return { ok: false, matched: false };
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        title: 'Dosya Çok Büyük',
        description: `${file.name} 20 MB sınırını aşıyor.`,
        variant: 'destructive',
      });
      return { ok: false, matched: false };
    }

    // 1. Dosya adından otomatik eşleştirme; eşleşmediyse varsayılan konum (varsa).
    const match = matchLocationFromFileName(file.name, locationCandidates);
    const locId = match?.id || defaultLocationId || '';
    const locName = match?.name || (defaultLocationId ? findLocationName(defaultLocationId) : '');
    const wasAutoMatched = !!match;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'irsaliyeler');
      formData.append('userUid', currentUser.uid);
      const uploadResponse = await fetch('/api/storage/upload-file', {
        method: 'POST',
        body: formData,
      });
      const uploadPayload = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok || !uploadPayload?.url || !uploadPayload?.path) {
        throw new Error(uploadPayload?.error || 'Dosya yüklenirken bir hata oluştu.');
      }

      const fileType = file.name.endsWith('.pdf') ? 'pdf' : file.name.endsWith('.xlsx') ? 'xlsx' : 'xls';
      const now = Timestamp.now();
      const oneWeekLater = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);

      const newDoc = await addDoc(collection(db, 'irsaliyeDosyalari'), {
        companyId: normalizeCompanyId(currentCompanyId),
        fileName: file.name,
        fileType,
        fileSize: file.size,
        storagePath: uploadPayload.path,
        downloadURL: uploadPayload.url,
        uploadedBy: currentUser.uid,
        uploadedByName: currentUserProfile?.displayName || currentUserProfile?.email || 'Bilinmeyen',
        uploadedAt: now,
        expiresAt: oneWeekLater,
        locationType: selectedLocationType,
        locationId: locId,
        locationName: locName,
        // Auto-match teşhisi için (UI'da rozet ve kullanım istatistikleri için):
        autoMatchedLocation: wasAutoMatched,
        autoMatchConfidence: match?.confidence ?? null,
        autoMatchReason: match?.reason ?? null,
      });

      return {
        ok: true,
        matched: !!locId,
        docId: newDoc.id,
        locationId: locId || undefined,
        locationName: locName || undefined,
      };
    } catch (error: any) {
      console.error('Dosya yükleme hatası:', error);
      toast({
        title: 'Hata',
        description: `${file.name}: ${error.message || 'Yüklenemedi.'}`,
        variant: 'destructive',
      });
      return { ok: false, matched: false };
    }
  }, [
    currentUser,
    currentUserProfile,
    toast,
    selectedLocationType,
    defaultLocationId,
    locationCandidates,
    findLocationName,
    currentCompanyId,
  ]);

  /**
   * Çoklu dosya yükleyici. Drop ve input event'leri buradan geçer; eşleşen
   * dosyalar varsa autoScan kuyruğuna eklenir.
   */
  const processManyFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;
    if (!selectedLocationType) {
      toast({
        title: 'Kategori seçimi gerekli',
        description: 'Yükleme öncesinde Hastane veya Depo kategorisini seçin.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    setUploadProgress(0);

    let matchedCount = 0;
    let unmatchedCount = 0;
    let errorCount = 0;
    const queueForAutoScan: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(Math.round(((i) / files.length) * 100));
      const result = await processFile(file);
      if (!result.ok) { errorCount += 1; continue; }
      if (result.matched) {
        matchedCount += 1;
        // PDF değilse otomatik tarama anlamlı değil.
        if (autoScanEnabled && result.docId && file.name.toLowerCase().endsWith('.pdf')) {
          queueForAutoScan.push(result.docId);
        }
      } else {
        unmatchedCount += 1;
      }
    }

    setUploadProgress(100);
    setUploading(false);
    setUploadProgress(0);

    const parts: string[] = [];
    if (matchedCount > 0) parts.push(`${matchedCount} dosya otomatik konum ile atandı`);
    if (unmatchedCount > 0) parts.push(`${unmatchedCount} dosya için konum bulunamadı (manuel atama gerekli)`);
    if (errorCount > 0) parts.push(`${errorCount} dosya yüklenemedi`);
    if (parts.length > 0) {
      toast({
        title: 'Yükleme tamamlandı',
        description: parts.join(' · '),
      });
    }

    if (queueForAutoScan.length > 0) {
      setAutoScanQueue(prev => [...prev, ...queueForAutoScan]);
    }
  }, [selectedLocationType, autoScanEnabled, processFile, toast]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processManyFiles(files);
    e.target.value = '';
  }, [processManyFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) await processManyFiles(files);
  }, [processManyFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDelete = useCallback(async (dosya: IrsaliyeDosya) => {
    if (!currentUser) return;
    if (!matchesCompanyScope(dosya, currentCompanyId, isSuperAdmin)) {
      toast({
        title: 'Yetkisiz işlem',
        description: 'Bu dosya için silme yetkiniz bulunmuyor.',
        variant: 'destructive',
      });
      return;
    }

    setDeleting(dosya.id);
    try {
      try {
        await fetch('/api/storage/delete-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: dosya.storagePath }),
        });
      } catch {
        // File may already be deleted
      }
      await deleteDoc(doc(db, 'irsaliyeDosyalari', dosya.id));
      toast({
        title: 'Silindi',
        description: `${dosya.fileName} başarıyla silindi.`,
      });
    } catch (error: any) {
      console.error('Silme hatası:', error);
      toast({
        title: 'Hata',
        description: 'Dosya silinirken bir sorun oluştu.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(null);
    }
  }, [currentUser, toast, currentCompanyId, isSuperAdmin]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getRemainingDays = (expiresAt: Timestamp) => {
    const now = Date.now();
    const expiry = expiresAt.toMillis();
    const diff = expiry - now;
    if (diff <= 0) return 'Süresi doldu';
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return `${days} gün kaldı`;
  };

  const konumSecenekleri = selectedLocationType === 'hospital' ? hospitals : depots;
  /**
   * Liste filtresi: yalnızca seçili kategori türüne ait dosyalar gösterilir.
   * Konum-ID bazlı filtre artık yok — listeye seçili kategorideki tüm dosyalar
   * gelir (her satırda zaten kendi konum etiketi var).
   */
  const gorunenDosyalar = selectedLocationType
    ? dosyalar.filter((d) => d.locationType === selectedLocationType)
    : dosyalar;

  return (
    <div className="dashboard-neu-page min-h-screen p-4 md:p-6 lg:p-8">
      {/* ─── Header ───────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6">
        <BackButton />
        <div className="flex items-center gap-3">
          <span className="dashboard-panel-icon flex items-center justify-center w-10 h-10 rounded-full shrink-0">
            <FolderOpen className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--dashboard-text)' }}>
              Dosya Yönetimi
            </h1>
            <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>
              Dosyalarınızı yükleyin ve yönetin. Yüklenen dosyalar 1 hafta sonra otomatik olarak silinir.
            </p>
          </div>
        </div>
      </div>

      {/* ─── İrsaliye Yönetimi Section ──────────────────────── */}
      <div className="glass-card rounded-3xl overflow-hidden" style={{ borderRadius: '24px' }}>
        {/* Section Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <span className="dashboard-panel-icon flex items-center justify-center w-8 h-8 rounded-full shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--dashboard-text)' }}>İrsaliye Yönetimi</h2>
              <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>
                İrsaliye PDF veya Excel dosyalarını yükleyin. Bu dosyalar Mal Kabul &gt; İrsaliye OCR panelinden &quot;Dosyalardan Seç&quot; seçeneği ile kullanılabilir.
              </p>
            </div>
          </div>
        </div>

        {/* ─── Kategori Seçimi + Otomatik Tarama Ayarları ──────── */}
        <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-4">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--dashboard-muted)' }}>Kategori</p>
            <Select
              value={selectedLocationType}
              onValueChange={(value: 'hospital' | 'depot') => {
                setSelectedLocationType(value);
                setDefaultLocationId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Hastane veya Depo havuzu seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hospital">Hastaneler / Laboratuvarlar</SelectItem>
                <SelectItem value="depot">Depolar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4">
            <p className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--dashboard-muted)' }}>
              Eşleşmeyenler için varsayılan
              <span title="Dosya adından konum bulunamazsa bu seçilen konuma atanır. Boş bırakılırsa konumsuz yüklenir." className="cursor-help inline-flex">
                <HelpCircle className="h-3 w-3" />
              </span>
            </p>
            <Select
              value={defaultLocationId}
              onValueChange={setDefaultLocationId}
              disabled={!selectedLocationType}
            >
              <SelectTrigger>
                <SelectValue placeholder={selectedLocationType ? 'Otomatik eşleşmeyenler için (opsiyonel)' : 'Önce kategori seçin'} />
              </SelectTrigger>
              <SelectContent>
                {konumSecenekleri.map((loc: any) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name || loc.ad}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4 flex items-center gap-3 pb-2">
            <div className="flex-1">
              <p className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--dashboard-muted)' }}>
                <Wand2 className="h-3 w-3" /> Otomatik Tarama
              </p>
              <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                Yüklenen PDF irsaliyeler Vision ile arka planda taranıp Bekleyen İrsaliyelere düşer.
              </p>
            </div>
            <Switch checked={autoScanEnabled} onCheckedChange={setAutoScanEnabled} />
          </div>
        </div>

        {/* ─── Upload Area ────────────────────────────────── */}
        <div className="px-6 pb-4">
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className="flex flex-col items-center justify-center w-full py-10 px-6 rounded-2xl cursor-pointer transition-all duration-200"
            style={{
              background: 'var(--dashboard-surface-2)',
              border: isDragging ? '2px dashed var(--dashboard-accent)' : '2px dashed var(--dashboard-stroke)',
              boxShadow: isDragging ? 'var(--dashboard-pressed)' : 'none',
              transform: isDragging ? 'scale(1.005)' : 'scale(1)',
              pointerEvents: uploading ? 'none' : 'auto',
              opacity: !selectedLocationType ? 0.65 : 1,
            }}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <span className="dashboard-panel-icon flex items-center justify-center w-12 h-12 rounded-full">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
                </span>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>Yükleniyor... %{Math.round(uploadProgress)}</p>
                  <Progress value={uploadProgress} className="w-48 mt-2" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="dashboard-panel-icon flex items-center justify-center w-12 h-12 rounded-full">
                  <FileUp className="w-6 h-6" style={{ color: isDragging ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }} />
                </span>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>
                    Dosya(lar) yüklemek için tıklayın veya sürükleyin
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--dashboard-muted)' }}>
                    Birden fazla dosya seçebilirsiniz; konumlar dosya adından otomatik eşleşir.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--dashboard-surface)', color: 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}>PDF</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--dashboard-surface)', color: 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}>XLSX</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--dashboard-surface)', color: 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}>XLS</span>
                    <span className="text-xs ml-1" style={{ color: 'var(--dashboard-muted)' }}>Maks. 20MB / dosya</span>
                  </div>
                </div>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.xlsx,.xls"
              multiple
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
          {!selectedLocationType && (
            <p className="mt-2 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
              Dosya yüklemek için önce Kategori (Hastane veya Depo) seçin. Dosya adından konum otomatik atanır.
            </p>
          )}
        </div>

        {/* ─── File List ──────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
          <div className="px-6 py-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>
              Yüklenen Dosyalar
              <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--dashboard-muted)' }}>({gorunenDosyalar.length})</span>
              {autoScanQueue.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Kuyrukta {autoScanQueue.length}
                </span>
              )}
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={queueAutoScanForUnscannedMatched}
              disabled={gorunenDosyalar.length === 0 || autoScanQueue.length > 0}
              className="h-7 text-xs"
              title="Eşleşmiş ama henüz taranmamış tüm PDF'leri sırayla tara"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Tümünü Otomatik Tara
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--dashboard-muted)' }} />
            </div>
          ) : gorunenDosyalar.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <span className="dashboard-panel-icon flex items-center justify-center w-12 h-12 rounded-full mb-3">
                <FolderOpen className="w-6 h-6" style={{ color: 'var(--dashboard-muted)', opacity: 0.5 }} />
              </span>
              <p className="text-sm font-medium" style={{ color: 'var(--dashboard-muted)' }}>Henüz dosya yüklenmedi</p>
              <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)', opacity: 0.6 }}>PDF veya Excel yükleyerek başlayın</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {gorunenDosyalar.map((dosya) => {
                const isScanned = pendingScannedDosyaIds.has(dosya.id);
                const hasLocation = !!dosya.locationId;
                const canScan = dosya.fileType === 'pdf' && !!dosya.locationType && hasLocation;
                const isBeingAutoScanned = autoScanningId === dosya.id;
                const isQueued = autoScanQueue.includes(dosya.id) && !isBeingAutoScanned;
                const wasAutoMatched = (dosya as any).autoMatchedLocation === true;
                return (
                  <div
                    key={dosya.id}
                    className="flex items-center justify-between px-6 py-3 transition-colors hover:opacity-80"
                    style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="dashboard-panel-icon flex items-center justify-center w-9 h-9 rounded-full shrink-0">
                        {dosya.fileType === 'pdf' ? (
                          <FileText className="h-4 w-4 text-red-500" />
                        ) : (
                          <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate" style={{ color: 'var(--dashboard-text)' }}>{dosya.fileName}</p>
                          {isScanned && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              {dosya.locationType === 'depot' ? 'Mal kabulde bekliyor' : 'Lab stoğunda bekliyor'}
                            </span>
                          )}
                          {!isScanned && dosya.fileType === 'pdf' && !isBeingAutoScanned && !isQueued && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                              Taranmadı
                            </span>
                          )}
                          {isBeingAutoScanned && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Vision ile taranıyor
                            </span>
                          )}
                          {isQueued && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700">
                              Kuyrukta
                            </span>
                          )}
                          {hasLocation && wasAutoMatched && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700" title="Konum dosya adından otomatik eşleştirildi">
                              <Wand2 className="h-3 w-3" />
                              Otomatik atandı
                            </span>
                          )}
                          {!hasLocation && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
                              <AlertCircle className="h-3 w-3" />
                              Konum bulunamadı
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>
                          <span>{formatFileSize(dosya.fileSize)}</span>
                          <span className="hidden sm:inline">{dosya.uploadedByName}</span>
                          <span className="hidden md:inline">{dosya.locationName || 'Konum belirtilmedi'}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {getRemainingDays(dosya.expiresAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {!hasLocation && selectedLocationType && (
                        <Select
                          value=""
                          onValueChange={(v) => assignLocationToFile(dosya, v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-44">
                            <SelectValue placeholder="Konum ata..." />
                          </SelectTrigger>
                          <SelectContent>
                            {konumSecenekleri.map((loc: any) => (
                              <SelectItem key={loc.id} value={loc.id}>{loc.name || loc.ad}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {dosya.fileType === 'pdf' && (
                        <Button
                          variant={isScanned ? 'outline' : 'default'}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setScanningFile(dosya)}
                          disabled={!canScan || isBeingAutoScanned}
                          title={canScan ? (isScanned ? 'Yeniden Tara' : 'Tara') : 'Önce konum atanmalı'}
                        >
                          <Scan className="h-3.5 w-3.5 mr-1" />
                          {isScanned ? 'Yeniden Tara' : 'Tara'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        onClick={() => window.open(dosya.downloadURL, '_blank')}
                        title="İndir"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-500/10"
                        onClick={() => handleDelete(dosya)}
                        disabled={deleting === dosya.id}
                        title="Sil"
                      >
                        {deleting === dosya.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-6 py-3" style={{ borderTop: '1px solid var(--dashboard-stroke)', background: 'var(--dashboard-surface-2)' }}>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Yüklenen dosyalar 1 hafta sonra otomatik olarak sistemden ve veritabanından silinir.</span>
          </div>
        </div>
      </div>

      {/* ─── Ceomed İrsaliyeleri ─────────────────────────────── */}
      <div className="mt-6">
        <CeomedIrsaliyePanel />
      </div>

      <IrsaliyeScanModal
        isOpen={!!scanningFile}
        file={scanningFile}
        onClose={() => setScanningFile(null)}
        productCodes={productCodes}
      />
    </div>
  );
}
