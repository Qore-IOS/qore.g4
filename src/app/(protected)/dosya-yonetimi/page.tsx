'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
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
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  FileSpreadsheet,
  FolderOpen,
  Clock,
  Download,
  ArrowLeft,
  FileUp,
  AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import BackButton from '@/components/BackButton';

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
}

export default function DosyaYonetimiPage() {
  const { currentUser, currentUserProfile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dosyalar, setDosyalar] = useState<IrsaliyeDosya[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Listen to irsaliye files in real-time
  useEffect(() => {
    const q = query(
      collection(db, 'irsaliyeDosyalari'),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const files: IrsaliyeDosya[] = [];
      snapshot.forEach((docSnap) => {
        files.push({ id: docSnap.id, ...docSnap.data() } as IrsaliyeDosya);
      });
      setDosyalar(files);
      setLoading(false);
    }, (error) => {
      console.error('Dosya listesi yüklenirken hata:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

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

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
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
        }

        if (snapshot.docs.length > 0) {
          toast({
            title: 'Temizlik',
            description: `${snapshot.docs.length} süresi dolmuş dosya silindi.`,
          });
        }
      } catch (error) {
        console.error('Süresi dolmuş dosyalar temizlenirken hata:', error);
      }
    };

    cleanupExpired();
  }, [toast]);

  const processFile = useCallback(async (file: File) => {
    if (!currentUser) return;

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Geçersiz Dosya',
        description: 'Sadece PDF ve Excel (.xlsx, .xls) dosyaları yüklenebilir.',
        variant: 'destructive',
      });
      return;
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        title: 'Dosya Çok Büyük',
        description: 'Maksimum dosya boyutu 20 MB olabilir.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      setUploadProgress(25);

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

      setUploadProgress(80);

      const fileType = file.name.endsWith('.pdf')
        ? 'pdf'
        : file.name.endsWith('.xlsx')
        ? 'xlsx'
        : 'xls';

      const now = Timestamp.now();
      const oneWeekLater = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);

      await addDoc(collection(db, 'irsaliyeDosyalari'), {
        fileName: file.name,
        fileType,
        fileSize: file.size,
        storagePath: uploadPayload.path,
        downloadURL: uploadPayload.url,
        uploadedBy: currentUser.uid,
        uploadedByName: currentUserProfile?.displayName || currentUserProfile?.email || 'Bilinmeyen',
        uploadedAt: now,
        expiresAt: oneWeekLater,
      });

      setUploadProgress(100);
      toast({
        title: 'Başarılı',
        description: `${file.name} başarıyla yüklendi.`,
      });
      setUploading(false);
      setUploadProgress(0);
    } catch (error: any) {
      console.error('Dosya yükleme hatası:', error);
      toast({
        title: 'Hata',
        description: error.message || 'Dosya yüklenirken bir sorun oluştu.',
        variant: 'destructive',
      });
      setUploading(false);
    }
  }, [currentUser, currentUserProfile, toast]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  }, [processFile]);

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
  }, [currentUser, toast]);

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

  return (
    <div className="space-y-6 pb-8">
      {/* ─── Header ───────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <BackButton />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10">
            <FolderOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Dosya Yönetimi
            </h1>
            <p className="text-sm text-muted-foreground">
              Dosyalarınızı yükleyin ve yönetin. Yüklenen dosyalar 1 hafta sonra otomatik olarak silinir.
            </p>
          </div>
        </div>
      </div>

      {/* ─── İrsaliye Yönetimi Section ──────────────────────── */}
      <div className="rounded-2xl border border-border/60 bg-card/40 dark:bg-card/20 backdrop-blur-sm overflow-hidden">
        {/* Section Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-500/10">
              <FileText className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">İrsaliye Yönetimi</h2>
              <p className="text-sm text-muted-foreground">
                İrsaliye PDF veya Excel dosyalarını yükleyin. Bu dosyalar Mal Kabul &gt; İrsaliye OCR panelinden &quot;Dosyalardan Seç&quot; seçeneği ile kullanılabilir.
              </p>
            </div>
          </div>
        </div>

        {/* ─── Upload Area ────────────────────────────────── */}
        <div className="px-6 pb-4">
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`flex flex-col items-center justify-center w-full py-10 px-6 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ${
              isDragging
                ? 'border-primary bg-primary/5 dark:bg-primary/10 scale-[1.01]'
                : 'border-border/60 hover:border-primary/40 hover:bg-muted/20 dark:hover:bg-muted/10'
            } ${uploading ? 'pointer-events-none' : ''}`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Yükleniyor... %{Math.round(uploadProgress)}</p>
                  <Progress value={uploadProgress} className="w-48 mt-2" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className={`flex items-center justify-center w-12 h-12 rounded-xl transition-colors duration-200 ${
                  isDragging ? 'bg-primary/10' : 'bg-muted/30 dark:bg-muted/10'
                }`}>
                  <FileUp className={`w-6 h-6 transition-colors duration-200 ${
                    isDragging ? 'text-primary' : 'text-muted-foreground/60'
                  }`} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    Dosya yüklemek için tıklayın veya sürükleyin
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium">PDF</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-medium">XLSX</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-medium">XLS</span>
                    <span className="text-xs text-muted-foreground ml-1">Maks. 20MB</span>
                  </div>
                </div>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.xlsx,.xls"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {/* ─── File List ──────────────────────────────────── */}
        <div className="border-t border-border/40">
          <div className="px-6 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Yüklenen Dosyalar
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">({dosyalar.length})</span>
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dosyalar.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted/30 dark:bg-muted/10 mb-3">
                <FolderOpen className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Henüz dosya yüklenmedi</p>
              <p className="text-xs text-muted-foreground/60 mt-1">PDF veya Excel yükleyerek başlayın</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30 max-h-[400px] overflow-y-auto">
              {dosyalar.map((dosya) => (
                <div
                  key={dosya.id}
                  className="flex items-center justify-between px-6 py-3 hover:bg-muted/10 dark:hover:bg-muted/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
                      dosya.fileType === 'pdf' ? 'bg-red-500/10' : 'bg-green-500/10'
                    }`}>
                      {dosya.fileType === 'pdf' ? (
                        <FileText className="h-4 w-4 text-red-500" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate text-foreground">{dosya.fileName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{formatFileSize(dosya.fileSize)}</span>
                        <span className="hidden sm:inline">{dosya.uploadedByName}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {getRemainingDays(dosya.expiresAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
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
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 border-t border-border/30 bg-muted/5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Yüklenen dosyalar 1 hafta sonra otomatik olarak sistemden ve veritabanından silinir.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
