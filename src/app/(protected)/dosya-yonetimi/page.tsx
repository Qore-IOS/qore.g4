'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { db } from '../../../lib/data/client';
import { useDepots, useHospitals } from '@/hooks/useDatabaseQueries';
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
} from '../../../lib/data/client';
import { useToast } from '@/hooks/use-toast';
import {
  FileText,
  Trash2,
  Loader2,
  FileSpreadsheet,
  FolderOpen,
  Clock,
  Download,
  AlertCircle,
  Scan,
  CheckCircle2,
  Wand2,
  Pencil,
  Info,
} from 'lucide-react';
import CeomedIrsaliyePanel from '@/components/ceomed/CeomedIrsaliyePanel';
import CeomedIrsaliyeGirisKuyrugu from '@/components/ceomed/CeomedIrsaliyeGirisKuyrugu';
import IrsaliyeScanModal from '@/components/dosya-yonetimi/IrsaliyeScanModal';
import { useProductCodes } from '@/hooks/useDatabaseQueries';
import { matchLocationFromFileName, type LocationCandidate } from '@/lib/match-location-from-filename';
import { autoScanIrsaliyeFile } from '@/lib/irsaliye-auto-scan';
import {
  C, AC, ClayPage, useMode, Card, RaporHead, SoftBtn, FieldLabel,
  Dropdown, Toggle, UploadZone, EmptyBlock,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

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
  const mode = useMode();
  const mobile = mode === 'mobile';
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
  /** Otomatik eşleşen bir dosyada inline konum değiştirme kontrolü açık mı. */
  const [changingLocationFileId, setChangingLocationFileId] = useState<string | null>(null);
  const { data: productCodes = [] } = useProductCodes();
  const isScanningRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  queueRef.current = autoScanQueue;

  // Listen to irsaliye files in real-time
  useEffect(() => {
    const q = scopedQuery(
      'irsaliyeDosyalari',
      currentCompanyId,
      isSuperAdmin,
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
    const q = scopedQuery('bekleyenIrsaliyeler', currentCompanyId, isSuperAdmin);
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
    if (isScanningRef.current || autoScanQueue.length === 0) return;
    if (productCodes.length === 0) return;

    const runQueue = async () => {
      isScanningRef.current = true;
      while (queueRef.current.length > 0) {
        const fileId = queueRef.current[0];
        const file = dosyalar.find(d => d.id === fileId);
        if (!file) {
          setAutoScanQueue(q => q.slice(1));
          continue;
        }
        if (file.fileType !== 'pdf' || !file.locationType || !file.locationId) {
          setAutoScanQueue(q => q.slice(1));
          continue;
        }
        if (pendingScannedDosyaIds.has(fileId)) {
          setAutoScanQueue(q => q.slice(1));
          continue;
        }

        setAutoScanningId(fileId);
        try {
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
        } catch (err: any) {
          console.error('[auto-scan] error in queue loop:', err);
        } finally {
          setAutoScanningId(null);
          setAutoScanQueue(q => q.slice(1));
        }
      }
      isScanningRef.current = false;
    };

    void runQueue();
  }, [autoScanQueue, dosyalar, productCodes, currentCompanyId, currentUser, currentUserProfile, pendingScannedDosyaIds, toast]);

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
        const expiredQuery = scopedQuery(
          'irsaliyeDosyalari',
          currentCompanyId,
          isSuperAdmin,
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

  const getLocationOptions = useCallback((type: 'hospital' | 'depot' | '') => {
    if (type === 'hospital') return hospitals;
    if (type === 'depot') return depots;
    return [];
  }, [hospitals, depots]);

  const locationCandidates: LocationCandidate[] = useMemo(() => {
    return getLocationOptions(selectedLocationType).map((loc: any) => ({
      id: loc.id,
      name: loc.name || loc.ad || '',
      kod: loc.kod,
    }));
  }, [selectedLocationType, getLocationOptions]);

  const findLocationName = useCallback((locId: string, type: 'hospital' | 'depot' | '' = selectedLocationType): string => {
    const loc = getLocationOptions(type).find((x: any) => x.id === locId);
    return (loc?.name || loc?.ad || '') as string;
  }, [selectedLocationType, getLocationOptions]);

  /** Konum atanmamış veya otomatik eşleşmiş bir dosyayı manuel olarak konumla eşleştir. */
  const assignLocationToFile = useCallback(async (dosya: IrsaliyeDosya, locId: string) => {
    const locationType = dosya.locationType || selectedLocationType;
    const name = findLocationName(locId, locationType);
    if (!locationType || !name) return;
    try {
      await updateDoc(doc(db, 'irsaliyeDosyalari', dosya.id), {
        locationType,
        locationId: locId,
        locationName: name,
        autoMatchedLocation: false,
        autoMatchConfidence: null,
        autoMatchReason: 'manuel_degistirildi',
      });

      const pendingSnapshot = await getDocs(scopedQuery(
        'bekleyenIrsaliyeler',
        currentCompanyId,
        isSuperAdmin,
        where('dosyaId', '==', dosya.id)
      ));
      const pendingDocs = pendingSnapshot.docs.filter((docSnap) => docSnap.data()?.status === 'pending');
      await Promise.all(pendingDocs.map((docSnap) => updateDoc(doc(db, 'bekleyenIrsaliyeler', docSnap.id), {
        locationType,
        locationId: locId,
        locationName: name,
      })));

      setChangingLocationFileId(null);
      toast({
        title: 'Konum güncellendi',
        description: pendingDocs.length === 0
          ? `${dosya.fileName} → ${name}`
          : `${dosya.fileName} ve bekleyen irsaliye kaydı → ${name}`,
      });
      if (autoScanEnabled && dosya.fileType === 'pdf' && pendingDocs.length === 0) {
        setAutoScanQueue(prev => prev.includes(dosya.id) ? prev : [...prev, dosya.id]);
      }
    } catch (err: any) {
      toast({ title: 'Hata', description: err?.message || 'Konum atanamadı.', variant: 'destructive' });
    }
  }, [findLocationName, selectedLocationType, autoScanEnabled, toast, currentCompanyId, isSuperAdmin]);

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

  /** UploadZone'dan gelen gerçek FileList'i mevcut yükleyiciye bağlar. */
  const handleZoneFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList || []);
    if (files.length > 0) await processManyFiles(files);
  }, [processManyFiles]);

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

  const konumSecenekleri = getLocationOptions(selectedLocationType);
  /**
   * Liste filtresi: yalnızca seçili kategori türüne ait dosyalar gösterilir.
   * Konum-ID bazlı filtre artık yok — listeye seçili kategorideki tüm dosyalar
   * gelir (her satırda zaten kendi konum etiketi var).
   */
  const gorunenDosyalar = selectedLocationType
    ? dosyalar.filter((d) => d.locationType === selectedLocationType)
    : dosyalar;

  // ── small clay status pill helper (matches demo FileRow pills) ──────────────
  const Pill = ({ children, bg, color, icon }: { children: React.ReactNode; bg: string; color: string; icon?: React.ReactNode }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: C.radiusPill,
      background: bg, color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {icon}{children}
    </span>
  );

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        {/* ─── Header ───────────────────────────────────────── */}
        <RaporHead
          icon={FolderOpen}
          title="Dosya Yönetimi"
          desc="Dosyalarınızı yükleyin ve yönetin. Yüklenen dosyalar 1 hafta sonra otomatik olarak silinir."
          onBack={() => window.history.back()}
          mobile={mobile}
        />

        {/* ─── İrsaliye Yönetimi ─────────────────────────────── */}
        <Card style={{ marginBottom: 16 }}>
          {/* Section head */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, marginBottom: 20 }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: AC.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
              <FileText size={22} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink1, letterSpacing: '-0.01em' }}>İrsaliye Yönetimi</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: C.ink2, fontWeight: 500, lineHeight: 1.5 }}>
                İrsaliye PDF veya Excel dosyalarını yükleyin. Bu dosyalar Mal Kabul &gt; İrsaliye OCR panelinden &quot;Dosyalardan Seç&quot; seçeneği ile kullanılabilir.
              </p>
            </div>
          </div>

          {/* Kategori + varsayılan + otomatik tarama */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginBottom: 20, alignItems: 'start' }}>
            <div>
              <FieldLabel>Kategori</FieldLabel>
              <Dropdown
                value={selectedLocationType}
                onChange={(v) => {
                  setSelectedLocationType(v as 'hospital' | 'depot');
                  setDefaultLocationId('');
                }}
                placeholder="Hastane veya Depo havuzu seçin"
                options={[
                  { value: 'hospital', label: 'Hastaneler / Laboratuvarlar' },
                  { value: 'depot', label: 'Depolar' },
                ]}
              />
            </div>
            <div>
              <FieldLabel hint>Eşleşmeyenler için varsayılan</FieldLabel>
              <Dropdown
                value={defaultLocationId}
                onChange={setDefaultLocationId}
                disabled={!selectedLocationType}
                placeholder={selectedLocationType ? 'Otomatik eşleşmeyenler için (opsiyonel)' : 'Önce kategori seçin'}
                options={konumSecenekleri.map((loc: any) => ({ value: loc.id, label: loc.name || loc.ad }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 13, padding: '12px 14px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, color: C.ink1 }}>
                  <Wand2 size={15} style={{ color: AC.primary }} /> Otomatik Tarama
                </div>
                <div style={{ fontSize: 12, color: C.ink2, marginTop: 4, lineHeight: 1.45 }}>
                  Yüklenen PDF irsaliyeler Vision ile arka planda taranıp Bekleyen İrsaliyelere düşer.
                </div>
              </div>
              <Toggle on={autoScanEnabled} onChange={setAutoScanEnabled} />
            </div>
          </div>

          {/* Upload zone */}
          <UploadZone
            accept={['PDF', 'XLSX', 'XLS', 'Maks. 20MB / dosya']}
            hint="Birden fazla dosya seçebilirsiniz; konumlar dosya adından otomatik eşleşir."
            onFiles={handleZoneFiles}
            acceptAttr=".pdf,.xlsx,.xls"
            multiple
          />

          {/* Upload progress (clay inset bar) */}
          {uploading && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, color: C.ink2, marginBottom: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Loader2 size={14} style={{ color: AC.primary, animation: 'cySpin 1s linear infinite' }} /> Yükleniyor...
                </span>
                <span>%{Math.round(uploadProgress)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${uploadProgress}%`, borderRadius: 99,
                  background: `linear-gradient(90deg, ${AC.accent}, ${AC.primary})`,
                  transition: `width 240ms ${EASE}`,
                }} />
              </div>
            </div>
          )}

          {!selectedLocationType && (
            <div style={{ fontSize: 13, color: C.ink3, marginTop: 12, fontWeight: 500 }}>
              Dosya yüklemek için önce Kategori (Hastane veya Depo) seçin. Dosya adından konum otomatik atanır.
            </div>
          )}
        </Card>

        {/* ─── Yüklenen Dosyalar ─────────────────────────────── */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.ink1 }}>
              Yüklenen Dosyalar <span style={{ color: C.ink3, fontWeight: 700 }}>({gorunenDosyalar.length})</span>
            </h2>
            {autoScanQueue.length > 0 && (
              <Pill bg={C.surface2} color={C.ink2} icon={<Loader2 size={12} style={{ animation: 'cySpin 1s linear infinite' }} />}>
                Kuyrukta {autoScanQueue.length}
              </Pill>
            )}
            <div style={{ flex: 1 }} />
            <SoftBtn
              tone={AC.primary}
              onClick={queueAutoScanForUnscannedMatched}
              disabled={gorunenDosyalar.length === 0 || autoScanQueue.length > 0}
              style={{ height: 42, padding: '0 16px', fontSize: 13.5 }}
            >
              <Wand2 size={16} /> Tümünü Otomatik Tara
            </SoftBtn>
          </div>

          {loading ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '48px 0' }}>
              <Loader2 size={26} style={{ color: C.ink3, animation: 'cySpin 1s linear infinite' }} />
            </div>
          ) : gorunenDosyalar.length === 0 ? (
            <EmptyBlock icon={<FileText size={28} />} text="Henüz dosya yüklenmedi." sub="PDF veya Excel yükleyerek başlayın." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {gorunenDosyalar.map((dosya) => {
                const isScanned = pendingScannedDosyaIds.has(dosya.id);
                const hasLocation = !!dosya.locationId;
                const canScan = dosya.fileType === 'pdf' && !!dosya.locationType && hasLocation;
                const isBeingAutoScanned = autoScanningId === dosya.id;
                const isQueued = autoScanQueue.includes(dosya.id) && !isBeingAutoScanned;
                const wasAutoMatched = (dosya as any).autoMatchedLocation === true;
                const rowLocationOptions = getLocationOptions(dosya.locationType || selectedLocationType);
                return (
                  <div
                    key={dosya.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap',
                      padding: '13px 14px', borderRadius: C.radius,
                      background: C.surfaceHi, boxShadow: C.clayFlat,
                    }}
                  >
                    {/* File type icon tile */}
                    <span style={{
                      width: 40, height: 40, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center',
                      background: C.surface2, boxShadow: C.clayInset,
                      color: dosya.fileType === 'pdf' ? C.danger : C.waterDeep,
                    }}>
                      {dosya.fileType === 'pdf' ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
                    </span>

                    {/* Name + meta + badges */}
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{dosya.fileName}</span>

                        {isScanned && (
                          <Pill bg="rgba(111,181,133,0.14)" color={C.waterDeep} icon={<CheckCircle2 size={12} />}>
                            {dosya.locationType === 'depot' ? 'Mal kabulde bekliyor' : 'Lab stoğunda bekliyor'}
                          </Pill>
                        )}
                        {!isScanned && dosya.fileType === 'pdf' && !isBeingAutoScanned && !isQueued && (
                          <Pill bg={C.amberSoft} color="#9A6F1E">Taranmadı</Pill>
                        )}
                        {isBeingAutoScanned && (
                          <Pill bg={C.amberSoft} color="#9A6F1E" icon={<Loader2 size={12} style={{ animation: 'cySpin 1s linear infinite' }} />}>
                            Vision ile taranıyor
                          </Pill>
                        )}
                        {isQueued && (
                          <Pill bg={C.surface2} color={C.ink2}>Kuyrukta</Pill>
                        )}
                        {hasLocation && wasAutoMatched && (
                          <>
                            <Pill bg="rgba(155,134,214,0.16)" color="#7C66C2" icon={<Wand2 size={12} />}>
                              Otomatik atandı{(dosya as any).autoMatchReason === 'akronim' ? ' · kısaltma' : (dosya as any).autoMatchReason === 'ilk_kelime' ? ' · ilk kelime' : (dosya as any).autoMatchReason === 'kod' ? ' · kod' : ''}
                            </Pill>
                            <SoftBtn
                              tone="#7C66C2"
                              onClick={() => setChangingLocationFileId(prev => prev === dosya.id ? null : dosya.id)}
                              style={{ height: 30, padding: '0 11px', fontSize: 12, gap: 5 }}
                            >
                              <Pencil size={12} /> Değiştir
                            </SoftBtn>
                            {changingLocationFileId === dosya.id && (
                              <div style={{ width: 220, maxWidth: '100%' }}>
                                <Dropdown
                                  value={dosya.locationId || ''}
                                  onChange={(v) => assignLocationToFile(dosya, v)}
                                  placeholder="Yeni konum seç..."
                                  options={rowLocationOptions.map((loc: any) => ({ value: loc.id, label: loc.name || loc.ad }))}
                                />
                              </div>
                            )}
                          </>
                        )}
                        {!hasLocation && (
                          <Pill bg="rgba(192,121,106,0.14)" color={C.danger} icon={<AlertCircle size={12} />}>Konum bulunamadı</Pill>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.ink3, marginTop: 4, flexWrap: 'wrap' }}>
                        <span>{formatFileSize(dosya.fileSize)}</span>
                        <span>{dosya.uploadedByName}</span>
                        <span>{dosya.locationName || 'Konum belirtilmedi'}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} /> {getRemainingDays(dosya.expiresAt)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                      {!hasLocation && selectedLocationType && (
                        <div style={{ width: 180, maxWidth: '100%' }}>
                          <Dropdown
                            value=""
                            onChange={(v) => assignLocationToFile(dosya, v)}
                            placeholder="Konum ata..."
                            options={konumSecenekleri.map((loc: any) => ({ value: loc.id, label: loc.name || loc.ad }))}
                          />
                        </div>
                      )}
                      {dosya.fileType === 'pdf' && (
                        <SoftBtn
                          tone={isScanned ? C.ink2 : '#fff'}
                          onClick={() => setScanningFile(dosya)}
                          disabled={!canScan || isBeingAutoScanned}
                          style={isScanned ? { height: 38, padding: '0 14px', fontSize: 13 } : {
                            height: 38, padding: '0 14px', fontSize: 13,
                            background: `linear-gradient(180deg, ${AC.accent}, ${AC.primary})`,
                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${AC.glow}`,
                          }}
                        >
                          <Scan size={14} /> {isScanned ? 'Yeniden Tara' : 'Tara'}
                        </SoftBtn>
                      )}
                      <button
                        type="button"
                        onClick={() => window.open(dosya.downloadURL, '_blank')}
                        title="İndir"
                        style={{
                          all: 'unset', cursor: 'pointer', width: 36, height: 36, flexShrink: 0, borderRadius: '50%',
                          display: 'grid', placeItems: 'center', color: C.ink2, background: C.surface2, boxShadow: C.clayFlat,
                        }}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(dosya)}
                        disabled={deleting === dosya.id}
                        title="Sil"
                        style={{
                          all: 'unset', cursor: deleting === dosya.id ? 'not-allowed' : 'pointer', width: 36, height: 36, flexShrink: 0, borderRadius: '50%',
                          display: 'grid', placeItems: 'center', color: C.danger, background: C.surface2, boxShadow: C.clayFlat,
                          opacity: deleting === dosya.id ? 0.6 : 1,
                        }}
                      >
                        {deleting === dosya.id ? <Loader2 size={16} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer note */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 13, color: C.ink3 }}>
            <Info size={15} style={{ flexShrink: 0 }} />
            <span>Yüklenen dosyalar 1 hafta sonra otomatik olarak sistemden ve veritabanından silinir.</span>
          </div>
        </Card>

        {/* ─── Ceomed İrsaliyeleri ─────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <CeomedIrsaliyePanel />
        </div>

        {/* ─── Ceomed muhasebe irsaliyesi giriş kuyruğu (Qore → Ceomed) ── */}
        <div style={{ marginBottom: 16 }}>
          <CeomedIrsaliyeGirisKuyrugu />
        </div>
      </div>

      <IrsaliyeScanModal
        isOpen={!!scanningFile}
        file={scanningFile}
        onClose={() => setScanningFile(null)}
        productCodes={productCodes}
      />

      {/* Hidden native input kept for compatibility with existing handlers. */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".pdf,.xlsx,.xls"
        multiple
        onChange={handleFileUpload}
        disabled={uploading}
      />
    </ClayPage>
  );
}
