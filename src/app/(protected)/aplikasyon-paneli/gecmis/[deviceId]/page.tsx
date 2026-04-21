'use client';
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, orderBy, getDocs, limit, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import type { Device, Hospital } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ImageIcon, FileText } from 'lucide-react';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';
import { cn } from '@/lib/utils';
import PostClosurePartChangeButton from '@/components/PostClosurePartChangeButton';

// Operation types
type OperationType =
  | 'aplikasyon_kontrol'
  | 'kalibrasyon_kontrol'
  | 'qc_materyal_kontrol'
  | 'ornek_sonucu_karsilastirma'
  | 'reaktif_yenileme'
  | 'kalibrator_yenileme'
  | 'qc_yenileme'
  | 'cv_calismasi'
  | 'diger';

type IslemTuru = 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'alis' | 'roche_bilgisayar_arizasi' | '';
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  personalStockId?: string;
  poolStockId?: string;
  poolWarehouseId?: string;
  poolWarehouseName?: string;
  serialNumber?: string;
  removedPartStokKodu?: string;
  removedPartStokAdi?: string;
  removedPartSerialNumber?: string;
  removedPartImageUrl?: string;
  usedPartImageUrl?: string;
  isPostClosure?: boolean;
  addedAt?: string;
  addedByName?: string;
};

type ActionFormRecord = {
  id: string;
  createdAt: { toDate: () => Date };
  createdByName: string;
  createdByUid?: string;
  formNo?: string;
  actions: ActionItem[];
  islemTuru?: IslemTuru;
  cihazDurumu?: CihazDurumu;
  cihazDurumuAciklama?: string;
  aciklama?: string;
  hospitalId?: string;
  eslikEdenPersonel?: { uid: string; name: string; role: string }[];
  personnelSignature?: string;
  technicianSignature?: string;
  selectedMaintenanceTasks?: { id: string; taskName: string }[];
  baslangicTarihi?: string;
  baslangicSaati?: string;
};

const OPERATION_LABELS: Record<OperationType, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibratör Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Çalışması',
  diger: 'Diğer',
};

const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': '-',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': '-',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

const PAGE_SIZE = 10;

export default function AplikasyonGecmisPage() {
  const params = useParams();
  const deviceId = params ? (Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId as string) : '';
  const router = useRouter();
  const { toast } = useToast();

  const [device, setDevice] = useState<Device | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<ActionFormRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [lastDocs, setLastDocs] = useState<Map<number, QueryDocumentSnapshot<DocumentData>>>(new Map());

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Fetch device and hospital
  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    (async () => {
      try {
        const deviceSnap = await getDoc(doc(db, 'devices', deviceId));
        if (!deviceSnap.exists()) {
          toast({ title: 'Hata', description: 'Cihaz bulunamadı.', variant: 'destructive' });
          router.back();
          return;
        }
        const deviceData = { id: deviceSnap.id, ...deviceSnap.data() } as Device;
        setDevice(deviceData);

        if (deviceData.hospitalId) {
          const hospitalSnap = await getDoc(doc(db, 'hospitals', deviceData.hospitalId));
          if (hospitalSnap.exists()) {
            setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
          }
        }
      } catch (err) {
        console.error("Error fetching device/hospital data:", err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [deviceId, router, toast]);

  // Fetch total count
  useEffect(() => {
    if (!deviceId) return;
    (async () => {
      try {
        const q = query(
          collection(db, 'deviceActionForms'),
          where('deviceId', '==', deviceId),
          where('formType', '==', 'aplikasyon')
        );
        const snap = await getDocs(q);
        setTotalRecords(snap.size);
      } catch (err) {
        console.error("Error fetching count:", err);
      }
    })();
  }, [deviceId]);

  // Fetch history with pagination
  const fetchHistory = async (page: number) => {
    if (!deviceId) return;
    setIsHistoryLoading(true);
    try {
      let q;
      if (page === 1) {
        q = query(
          collection(db, 'deviceActionForms'),
          where('deviceId', '==', deviceId),
          where('formType', '==', 'aplikasyon'),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE)
        );
      } else {
        const lastDoc = lastDocs.get(page - 1);
        if (!lastDoc) {
          // Need to fetch from beginning up to the page
          q = query(
            collection(db, 'deviceActionForms'),
            where('deviceId', '==', deviceId),
            where('formType', '==', 'aplikasyon'),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE * page)
          );
          const snap = await getDocs(q);
          const docs = snap.docs;
          // Get the last PAGE_SIZE docs
          const startIdx = Math.max(0, docs.length - PAGE_SIZE);
          const pageData = docs.slice(startIdx);

          // Store last doc for this page
          if (pageData.length > 0) {
            setLastDocs(prev => new Map(prev).set(page, pageData[pageData.length - 1]));
          }

          const historyItems = pageData.map(d => ({ id: d.id, ...d.data() }) as ActionFormRecord);
          setHistory(historyItems);
          setCurrentPage(page);
          setIsHistoryLoading(false);
          return;
        }
        q = query(
          collection(db, 'deviceActionForms'),
          where('deviceId', '==', deviceId),
          where('formType', '==', 'aplikasyon'),
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const snap = await getDocs(q);
      const historyItems = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ActionFormRecord);

      // Store last doc for pagination
      if (snap.docs.length > 0) {
        setLastDocs(prev => new Map(prev).set(page, snap.docs[snap.docs.length - 1]));
      }

      setHistory(historyItems);
      setCurrentPage(page);
    } catch (err) {
      console.error("Error fetching history:", err);
      toast({ title: 'Hata', description: 'Geçmiş yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsHistoryLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    if (deviceId && !loading) {
      fetchHistory(1);
    }
  }, [deviceId, loading]);

  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getActionLabel = (item: ActionItem): string => {
    if (item.type === 'operation') {
      return OPERATION_LABELS[item.action as OperationType] || item.action;
    }
    return item.stokAdi || item.action;
  };

  if (loading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!device) {
    return <div className="p-6 text-center">Cihaz bilgileri yüklenemedi.</div>;
  }

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback={`/aplikasyon-paneli/islem-formu/${deviceId}`} />
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {device.imageUrl && (
                <div className="w-24 h-24 flex-shrink-0 bg-muted rounded-lg p-2">
                  <Image src={resolveImageSrc(device.imageUrl)} alt={device.cihazAdi || ''} width={96} height={96} className="object-contain w-full h-full" />
                </div>
              )}
              <div>
                <CardTitle className="text-xl font-headline">Aplikasyon İşlem Geçmişi</CardTitle>
                <CardDescription>{device.cihazAdi} - {device.seriNumarasi}</CardDescription>
                <p className="text-sm mt-1 text-muted-foreground">{hospital?.name || '-'}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isHistoryLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div>
            ) : history.length === 0 ? (
              <p className="text-center text-muted-foreground p-8">Bu cihaz için geçmiş işlem formu bulunmuyor.</p>
            ) : (
              <>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Tarih</TableHead>
                        <TableHead>Kullanıcı</TableHead>
                        <TableHead>İşlem Türü</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead className="w-24 text-right">Tutanak</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map(rec => (
                        <React.Fragment key={rec.id}>
                          <TableRow
                            className={cn(
                              "cursor-pointer hover:bg-muted/50 transition-colors",
                              expandedRows.has(rec.id) && "bg-muted/30"
                            )}
                            onClick={() => toggleRow(rec.id)}
                          >
                            <TableCell>
                              {expandedRows.has(rec.id) ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {rec.baslangicTarihi && rec.baslangicSaati
                                ? `${rec.baslangicTarihi.split('-').reverse().join('.')} ${rec.baslangicSaati}`
                                : format(rec.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr })}
                            </TableCell>
                            <TableCell>{rec.createdByName}</TableCell>
                            <TableCell className="text-sm">
                              {rec.islemTuru && <span className="font-medium">{ISLEM_TURU_LABELS[rec.islemTuru]}</span>}
                            </TableCell>
                            <TableCell>
                              {rec.cihazDurumu && (
                                <span className={cn(
                                  "text-xs px-2 py-1 rounded-full",
                                  rec.cihazDurumu === 'calisiyor' && "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
                                  rec.cihazDurumu === 'arizali' && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                                  rec.cihazDurumu === 'denemede' && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                                  rec.cihazDurumu === 'diger' && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                                )}>
                                  {CIHAZ_DURUMU_LABELS[rec.cihazDurumu]}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <AplikasyonTutanakPDFButton
                                device={device}
                                hospital={hospital}
                                actionRecord={rec}
                              />
                            </TableCell>
                          </TableRow>

                          {/* Expanded Details Row */}
                          {expandedRows.has(rec.id) && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={6} className="p-0">
                                <div className="p-4 space-y-4">
                                  {/* Açıklama */}
                                  {rec.aciklama && (
                                    <div className="p-3 bg-background rounded-md border">
                                      <p className="text-xs text-muted-foreground mb-1">Açıklama</p>
                                      <p className="text-sm">{rec.aciklama}</p>
                                    </div>
                                  )}

                                  {/* Actions */}
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-2">Yapılan İşlemler ({rec.actions.length})</p>
                                    <div className="grid gap-2">
                                      {rec.actions.map(act => (
                                        <div
                                          key={act.id}
                                          className={cn(
                                            "p-3 rounded-md border",
                                            act.type === 'part_change'
                                              ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                                              : "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                                          )}
                                        >
                                          <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn(
                                                  "text-xs px-2 py-0.5 rounded",
                                                  act.type === 'part_change'
                                                    ? "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200"
                                                    : "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200"
                                                )}>
                                                  {act.type === 'part_change' ? 'Parça Değişimi' : 'İşlem'}
                                                </span>
                                                {act.isManualEntry && (
                                                  <span className="text-xs text-muted-foreground">(Manuel)</span>
                                                )}
                                                {act.isPostClosure && (
                                                  <span className="text-xs px-2 py-0.5 rounded bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200">
                                                    Sonradan Eklendi
                                                  </span>
                                                )}
                                                {act.poolWarehouseName && (
                                                  <span className="text-xs text-purple-600 dark:text-purple-400">[Havuz: {act.poolWarehouseName}]</span>
                                                )}
                                              </div>
                                              <p className="font-medium mt-1">{getActionLabel(act)}</p>
                                              {act.description && (
                                                <p className="text-sm text-muted-foreground mt-1">{act.description}</p>
                                              )}
                                              {act.type === 'part_change' && (
                                                <div className="mt-2 text-sm space-y-1">
                                                  <p><span className="text-muted-foreground">Stok Kodu:</span> <span className="font-mono">{act.stokKodu}</span></p>
                                                  {act.serialNumber && (
                                                    <p><span className="text-muted-foreground">Takılan Seri No:</span> <span className="font-mono">{act.serialNumber}</span></p>
                                                  )}
                                                  {act.removedPartSerialNumber && (
                                                    <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700">
                                                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Cihazdan Çıkan Parça</p>
                                                      <p><span className="text-muted-foreground">Seri No:</span> <span className="font-mono text-amber-700 dark:text-amber-400">{act.removedPartSerialNumber}</span></p>
                                                      {act.removedPartStokKodu && (
                                                        <p><span className="text-muted-foreground">Stok Kodu:</span> <span className="font-mono">{act.removedPartStokKodu}</span></p>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>

                                            {/* Image preview buttons */}
                                            <div className="flex flex-col gap-1">
                                              {act.removedPartImageUrl && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="flex items-center gap-1"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewImage(act.removedPartImageUrl!);
                                                  }}
                                                >
                                                  <ImageIcon className="h-4 w-4" />
                                                  <span className="hidden sm:inline">Çıkan Parça Fotoğrafı</span>
                                                </Button>
                                              )}
                                              {act.usedPartImageUrl && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="flex items-center gap-1"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewImage(act.usedPartImageUrl!);
                                                  }}
                                                >
                                                  <ImageIcon className="h-4 w-4" />
                                                  <span className="hidden sm:inline">Kullanım Fotoğrafını Göster</span>
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Periyodik Bakım Tasks */}
                                  {rec.selectedMaintenanceTasks && rec.selectedMaintenanceTasks.length > 0 && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-2">Yapılan Periyodik Bakımlar</p>
                                      <div className="flex flex-wrap gap-2">
                                        {rec.selectedMaintenanceTasks.map(task => (
                                          <span
                                            key={task.id}
                                            className="text-xs px-2 py-1 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded"
                                          >
                                            {task.taskName}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Eşlik Eden Personel */}
                                  {rec.eslikEdenPersonel && rec.eslikEdenPersonel.length > 0 && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-2">Eşlik Eden Personel</p>
                                      <div className="flex flex-wrap gap-2">
                                        {rec.eslikEdenPersonel.map(p => (
                                          <span
                                            key={p.uid}
                                            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded"
                                          >
                                            {p.name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Signatures indicator */}
                                  <div className="flex gap-4 text-xs text-muted-foreground">
                                    {rec.personnelSignature && (
                                      <span className="flex items-center gap-1">
                                        <FileText className="h-3 w-3" />
                                        Personel imzası var
                                      </span>
                                    )}
                                    {rec.technicianSignature && (
                                      <span className="flex items-center gap-1">
                                        <FileText className="h-3 w-3" />
                                        Teknisyen imzası var
                                      </span>
                                    )}
                                  </div>

                                  {/* Post-closure part change button */}
                                  <div className="pt-2 border-t">
                                    <PostClosurePartChangeButton
                                      formId={rec.id}
                                      deviceId={deviceId}
                                      deviceName={device?.cihazAdi || device?.model}
                                      hospitalId={rec.hospitalId || device?.hospitalId}
                                      labName={hospital?.name}
                                      formType="aplikasyon"
                                      sourceType="gecmis_accordion"
                                      formCollection="deviceActionForms"
                                      createdByUid={rec.createdByUid}
                                    />
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Toplam {totalRecords} kayıt, Sayfa {currentPage}/{totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchHistory(currentPage - 1)}
                        disabled={currentPage === 1 || isHistoryLoading}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Önceki
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchHistory(currentPage + 1)}
                        disabled={currentPage >= totalPages || isHistoryLoading}
                      >
                        Sonraki
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Cihazdan Çıkan Parça Fotoğrafı
            </DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="relative">
              <img
                src={previewImage}
                alt="Çıkan parça"
                className="w-full h-auto max-h-[70vh] object-contain rounded-md"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
