
'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, getDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import { Loader2 } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { savePendingCalculationFiles, periodToMonthYear, type PendingCalculationKind } from '@/lib/qore-hesaplama/pending-calculation-files';

export default function HistoryListPage() {
  const params = useParams();
  const labId = Array.isArray(params?.labId) ? params.labId[0] : params?.labId;
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, currentUserProfile } = useAuth();

  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [labName, setLabName] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadTarget, setUploadTarget] = useState<{ session: any; kind: PendingCalculationKind } | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const fetchHistoryAndLabName = useCallback(async () => {
    if (!labId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Fetch lab name first
      const labDocRef = doc(db, 'hospitals', labId);
      const labDocSnap = await getDoc(labDocRef);
      if (labDocSnap.exists()) {
        setLabName(labDocSnap.data()?.name || labId);
      } else {
        toast({ title: 'Hata', description: 'Laboratuvar bilgisi bulunamadı.', variant: 'destructive' });
      }

      // Fetch all sessions for the lab from the correct subcollection
      const q = query(
        collection(db, 'hospitals', labId, 'stockCounts'),
        orderBy('finishedAt', 'desc')
      );
      const snap = await getDocs(q);
      const sessionsData = snap.docs.map(d => {
        const data = d.data();
        // Ensure timestamp is a Date object
        const finishedAt = data.finishedAt?.toDate ? data.finishedAt.toDate() : new Date();
        return { id: d.id, ...data, finishedAt };
      });
      setAllSessions(sessionsData);
      setCurrentPage(1); // Reset to first page on new data
    } catch (e) {
      console.error('Error loading history:', e);
      toast({ title: 'Hata', description: 'Geçmiş sayımlar yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [labId, toast]);

  useEffect(() => {
    fetchHistoryAndLabName();
  }, [fetchHistoryAndLabName]);

  const handleUploadMissing = useCallback(async () => {
    if (!uploadTarget || !labId || uploadFiles.length === 0) return;
    const periodInfo = periodToMonthYear(uploadTarget.session.period);
    if (!periodInfo) {
      toast({ title: 'Dönem eksik', description: 'Bu sayımda dönem bilgisi olmadığı için dosya beklemeye alınamadı.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    try {
      await savePendingCalculationFiles({
        kind: uploadTarget.kind,
        hospitalId: labId,
        hospitalName: labName || uploadTarget.session.laboratoryName || labId,
        month: periodInfo.month,
        year: periodInfo.year,
        stockCountSessionId: uploadTarget.session.id,
        files: uploadFiles,
        currentCompanyId,
        user: { id: currentUserProfile?.uid, name: currentUserProfile?.name, email: currentUserProfile?.email },
      });
      await updateDoc(doc(db, 'hospitals', labId, 'stockCounts', uploadTarget.session.id), {
        [uploadTarget.kind === 'cihazUstu' ? 'cihazUstuUploaded' : 'kumulatifUploaded']: true,
        [uploadTarget.kind === 'cihazUstu' ? 'cihazUstuUploadedAt' : 'kumulatifUploadedAt']: Timestamp.now(),
      });
      toast({ title: 'Dosya yüklendi', description: `${uploadTarget.kind === 'cihazUstu' ? 'Cihaz üstü' : 'Kümülatif'} dosyaları beklemeye alındı.` });
      setUploadTarget(null);
      setUploadFiles([]);
      fetchHistoryAndLabName();
    } catch (err: any) {
      toast({ title: 'Dosya yüklenemedi', description: err?.message || 'Beklenmeyen hata oluştu.', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  }, [uploadTarget, labId, uploadFiles, labName, currentCompanyId, currentUserProfile, toast, fetchHistoryAndLabName]);


  // Client-side pagination logic
  const paginatedSessions = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return allSessions.slice(startIndex, startIndex + rowsPerPage);
  }, [allSessions, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(allSessions.length / rowsPerPage);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback={`/laboratuvar-yonetimi`} />
      <Card>
        <CardHeader>
          <CardTitle>Geçmiş Sayım Oturumları</CardTitle>
          <CardDescription>Laboratuvar: {labName || labId}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dönem</TableHead>
                <TableHead>Tarih</TableHead>
                <TableHead>Operatör</TableHead>
                <TableHead>Cihaz Üstü</TableHead>
                <TableHead>Kümülatif</TableHead>
                <TableHead>Detay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    Tamamlanmış sayım bulunamadı.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>{s.period || '—'}</TableCell>
                    <TableCell>
                      {s.finishedAt
                        ? format(s.finishedAt, 'dd.MM.yyyy HH:mm', { locale: tr })
                        : '—'
                      }
                    </TableCell>
                    <TableCell>{s.createdByName}</TableCell>
                    <TableCell>
                      {s.cihazUstuUploaded ? (
                        <span className="text-emerald-600 font-medium">Yüklendi</span>
                      ) : (
                        <Button variant="outline" size="sm" disabled={!s.period} onClick={() => setUploadTarget({ session: s, kind: 'cihazUstu' })}>Yükle</Button>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.kumulatifUploaded ? (
                        <span className="text-emerald-600 font-medium">Yüklendi</span>
                      ) : (
                        <Button variant="outline" size="sm" disabled={!s.period} onClick={() => setUploadTarget({ session: s, kind: 'kumulatif' })}>Yükle</Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          router.push(`/laboratuvar/sayim/${labId}/history/${s.id}`)
                        }
                      >
                        Görüntüle
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {totalPages > 1 && (
          <CardFooter className="flex items-center justify-between mt-4 pt-4 border-t">
            <div className="flex items-center space-x-2 text-sm">
                <span>Satır/sayfa:</span>
                <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setCurrentPage(1); }}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                    {[20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
                </Select>
            </div>
            <div className="flex items-center space-x-2">
                <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>Önceki</Button>
                <span className="text-sm">Sayfa {currentPage} / {totalPages}</span>
                <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>Sonraki</Button>
            </div>
          </CardFooter>
        )}
      </Card>

      <Dialog open={!!uploadTarget} onOpenChange={(open) => { if (!open) { setUploadTarget(null); setUploadFiles([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{uploadTarget?.kind === 'cihazUstu' ? 'Cihaz üstü dosyası yükle' : 'Kümülatif dosyası yükle'}</DialogTitle>
            <DialogDescription>
              {uploadTarget?.session?.period || '—'} dönemi için eksik dosyaları beklemeye alın. Bu dosyalar hesaplama panelinde hazır olarak görünecek.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="file"
            multiple
            accept=".pdf,.txt,.csv,application/pdf,text/*"
            onChange={(event) => setUploadFiles(Array.from(event.target.files || []))}
          />
          {uploadFiles.length > 0 && (
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              {uploadFiles.map((file) => <div key={`${file.name}-${file.size}`}>{file.name}</div>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadTarget(null); setUploadFiles([]); }} disabled={isUploading}>Vazgeç</Button>
            <Button onClick={handleUploadMissing} disabled={isUploading || uploadFiles.length === 0}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Beklemeye Al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
