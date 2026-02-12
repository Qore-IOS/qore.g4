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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
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
} from 'lucide-react';
import { useRouter } from 'next/navigation';

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

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

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
      e.target.value = '';
      return;
    }

    const maxSize = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxSize) {
      toast({
        title: 'Dosya Çok Büyük',
        description: 'Maksimum dosya boyutu 20 MB olabilir.',
        variant: 'destructive',
      });
      e.target.value = '';
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

    e.target.value = '';
  }, [currentUser, currentUserProfile, toast]);

  const handleDelete = useCallback(async (dosya: IrsaliyeDosya) => {
    if (!currentUser) return;

    setDeleting(dosya.id);
    try {
      // Delete from Storage
      try {
        await fetch('/api/storage/delete-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: dosya.storagePath }),
        });
      } catch {
        // File may already be deleted
      }

      // Delete from Firestore
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
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="h-7 w-7 text-primary" />
            Dosya Yönetimi
          </h1>
          <p className="text-muted-foreground text-sm">
            Dosyalarınızı yükleyin ve yönetin. Yüklenen dosyalar 1 hafta sonra otomatik olarak silinir.
          </p>
        </div>
      </div>

      {/* Invoice Management Section */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            İrsaliye Yönetimi
          </CardTitle>
          <CardDescription>
            İrsaliye PDF veya Excel dosyalarını yükleyin. Bu dosyalar Mal Kabul &gt; İrsaliye OCR
            panelinden &quot;Dosyalardan Seç&quot; seçeneği ile kullanılabilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Area */}
          <div className="flex flex-col items-center">
            <label className="flex flex-col items-center justify-center w-full max-w-lg h-40 border-2 border-dashed rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-600 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                {uploading ? (
                  <>
                    <Loader2 className="w-10 h-10 mb-3 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground mb-2">Yükleniyor... %{Math.round(uploadProgress)}</p>
                    <Progress value={uploadProgress} className="w-48" />
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 mb-3 text-slate-400" />
                    <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">PDF veya Excel yüklemek için tıklayın</span>
                    </p>
                    <p className="text-xs text-slate-400">PDF, XLSX, XLS (Maks. 20MB)</p>
                  </>
                )}
              </div>
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

          {/* File List */}
          <div className="border rounded-lg overflow-hidden">
            <div className="p-3 border-b bg-slate-50 dark:bg-slate-800 font-semibold flex justify-between items-center">
              <span>Yüklenen Dosyalar ({dosyalar.length})</span>
            </div>
            <ScrollArea className="max-h-[400px]">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : dosyalar.length === 0 ? (
                <div className="text-center text-muted-foreground py-10">
                  Henüz dosya yüklenmedi.
                </div>
              ) : (
                <div className="divide-y">
                  {dosyalar.map((dosya) => (
                    <div
                      key={dosya.id}
                      className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {dosya.fileType === 'pdf' ? (
                          <FileText className="h-8 w-8 text-red-500 shrink-0" />
                        ) : (
                          <FileSpreadsheet className="h-8 w-8 text-green-600 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{dosya.fileName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{formatFileSize(dosya.fileSize)}</span>
                            <span>{dosya.uploadedByName}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {getRemainingDays(dosya.expiresAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => window.open(dosya.downloadURL, '_blank')}
                          title="İndir"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
            </ScrollArea>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Yüklenen dosyalar 1 hafta sonra otomatik olarak sistemden ve veritabanından silinir.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
