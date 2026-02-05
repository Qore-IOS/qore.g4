'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Calendar, Eye, Trash2, Loader2, Wrench, FlaskConical, Building2, Clock, ArrowLeftRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useDutyShiftsByStatus, useHospitals } from '@/hooks/useFirebaseQueries';
import { db } from '@/lib/firebase';
import { doc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { format, differenceInDays, isWithinInterval } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DutyShift } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';

export default function AktifVardiyalarPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();
  const queryClient = useQueryClient();
  const { data: shifts = [], isLoading } = useDutyShiftsByStatus('active');
  const { data: hospitals = [] } = useHospitals();

  const [filterLab, setFilterLab] = useState<string>('all');
  const [detailShift, setDetailShift] = useState<DutyShift | null>(null);
  const [deleteShift, setDeleteShift] = useState<DutyShift | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Swap states
  const [swapTargetShift, setSwapTargetShift] = useState<DutyShift | null>(null);
  const [selectedOwnShiftId, setSelectedOwnShiftId] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);

  const userRole = currentUserProfile?.role;
  const userId = currentUser?.uid;

  // Filter shifts by selected lab
  const filteredShifts = useMemo(() => {
    if (filterLab === 'all') return shifts;
    return shifts.filter(s => s.laboratoryIds.includes(filterLab));
  }, [shifts, filterLab]);

  // Get current user's own shifts (same role as swap target)
  const mySwappableShifts = useMemo(() => {
    if (!swapTargetShift || !userId) return [];
    return shifts.filter(s =>
      s.userId === userId &&
      s.role === swapTargetShift.role &&
      s.id !== swapTargetShift.id
    );
  }, [shifts, swapTargetShift, userId]);

  // Can the current user initiate a swap on this shift?
  const canSwap = (shift: DutyShift) => {
    if (!userId || !userRole) return false;
    // Can't swap own shift
    if (shift.userId === userId) return false;
    // Role must match: teknik_servis users can only swap teknik_servis shifts, etc.
    if (userRole === 'teknik_servis' && shift.role === 'teknik_servis') return true;
    if (userRole === 'aplikasyon' && shift.role === 'aplikasyon') return true;
    // Admin can swap any shift
    if (userRole === 'admin') return true;
    return false;
  };

  // Calculate remaining days
  const getRemainingDays = (endDate: any) => {
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    const now = new Date();
    return Math.max(0, differenceInDays(end, now));
  };

  // Check if shift is currently active (within date range)
  const isCurrentlyActive = (shift: DutyShift) => {
    const now = new Date();
    const start = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
    const end = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);
    return isWithinInterval(now, { start, end });
  };

  const handleDelete = async () => {
    if (!deleteShift) return;

    setIsDeleting(true);
    try {
      await updateDoc(doc(db, 'dutyShifts', deleteShift.id), {
        status: 'cancelled',
        updatedAt: Timestamp.now(),
        updatedByUid: currentUser?.uid || '',
        updatedByName: currentUserProfile?.name || '',
      });

      toast({ title: 'Başarılı', description: 'Vardiya iptal edildi.' });
      queryClient.invalidateQueries({ queryKey: ['dutyShifts'] });
      setDeleteShift(null);
    } catch (error) {
      console.error('Vardiya silme hatası:', error);
      toast({ title: 'Hata', description: 'Vardiya iptal edilirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSwap = async () => {
    if (!swapTargetShift || !selectedOwnShiftId || !userId) return;

    const ownShift = shifts.find(s => s.id === selectedOwnShiftId);
    if (!ownShift) return;

    setIsSwapping(true);
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();

      // Swap the userId and userName between the two shifts
      batch.update(doc(db, 'dutyShifts', swapTargetShift.id), {
        userId: ownShift.userId,
        userName: ownShift.userName,
        updatedAt: now,
        updatedByUid: userId,
        updatedByName: currentUserProfile?.name || '',
      });

      batch.update(doc(db, 'dutyShifts', ownShift.id), {
        userId: swapTargetShift.userId,
        userName: swapTargetShift.userName,
        updatedAt: now,
        updatedByUid: userId,
        updatedByName: currentUserProfile?.name || '',
      });

      await batch.commit();

      toast({ title: 'Başarılı', description: 'Vardiyalar başarıyla değiştirildi.' });
      queryClient.invalidateQueries({ queryKey: ['dutyShifts'] });
      setSwapTargetShift(null);
      setSelectedOwnShiftId('');
    } catch (error) {
      console.error('Vardiya değiştirme hatası:', error);
      toast({ title: 'Hata', description: 'Vardiyalar değiştirilirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSwapping(false);
    }
  };

  const formatDateTime = (date: any, time?: string) => {
    const d = date instanceof Date ? date : new Date(date);
    const dateStr = format(d, 'd MMMM yyyy', { locale: tr });
    return time ? `${dateStr} ${time}` : dateStr;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.push('/nobet-yonetimi')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="h-6 w-6 text-orange-500" />
              <h1 className="text-xl font-bold">Aktif Vardiyalar</h1>
              <Badge variant="secondary">{filteredShifts.length} kayıt</Badge>
            </div>
            <Select value={filterLab} onValueChange={setFilterLab}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Laboratuvar filtrele" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                {hospitals.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredShifts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mb-4 opacity-30" />
              <p>Aktif vardiya bulunamadı.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredShifts.map(shift => {
              const remainingDays = getRemainingDays(shift.endDate);
              const active = isCurrentlyActive(shift);
              const isOwnShift = shift.userId === userId;

              return (
                <Card key={shift.id} className={`${active ? 'border-l-4 border-l-green-500' : ''} ${isOwnShift ? 'ring-1 ring-primary/30' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        {/* Role Badge and Status */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={shift.role === 'teknik_servis' ? 'default' : 'secondary'}>
                            {shift.role === 'teknik_servis' ? (
                              <><Wrench className="h-3 w-3 mr-1" /> Teknik</>
                            ) : (
                              <><FlaskConical className="h-3 w-3 mr-1" /> Aplikasyon</>
                            )}
                          </Badge>
                          {active && (
                            <Badge className="bg-green-500">
                              <Clock className="h-3 w-3 mr-1" />
                              Aktif ({remainingDays} gün kaldı)
                            </Badge>
                          )}
                          {isOwnShift && (
                            <Badge variant="outline" className="border-primary text-primary">
                              Benim Vardiyam
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground">
                            {differenceInDays(
                              shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any),
                              shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any)
                            ) + 1} gün
                          </span>
                        </div>

                        {/* User Name */}
                        <h3 className="text-lg font-semibold">{shift.userName}</h3>

                        {/* Laboratories */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {shift.laboratoryNames.slice(0, 3).map((name, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                          ))}
                          {shift.laboratoryNames.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{shift.laboratoryNames.length - 3}
                            </Badge>
                          )}
                        </div>

                        {/* Date Range with Time */}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDateTime(shift.startDate, shift.startTime)} - {formatDateTime(shift.endDate, shift.endTime)}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {canSwap(shift) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSwapTargetShift(shift);
                              setSelectedOwnShiftId('');
                            }}
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                          >
                            <ArrowLeftRight className="h-4 w-4 mr-1" />
                            Yer Değiştir
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailShift(shift)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Detay
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteShift(shift)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Detail Dialog */}
        <Dialog open={!!detailShift} onOpenChange={() => setDetailShift(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Vardiya Detayı</DialogTitle>
            </DialogHeader>
            {detailShift && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Personel</p>
                  <p className="font-semibold">{detailShift.userName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Rol</p>
                  <Badge>{detailShift.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tarih Aralığı</p>
                  <p>{formatDateTime(detailShift.startDate, detailShift.startTime)} - {formatDateTime(detailShift.endDate, detailShift.endTime)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Laboratuvarlar ({detailShift.laboratoryNames.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailShift.laboratoryNames.map((name, i) => (
                      <Badge key={i} variant="outline">{name}</Badge>
                    ))}
                  </div>
                </div>
                {detailShift.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Notlar</p>
                    <p>{detailShift.notes}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Oluşturan</p>
                  <p>{detailShift.createdByName}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteShift} onOpenChange={() => setDeleteShift(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Vardiyayı İptal Et</DialogTitle>
              <DialogDescription>
                {deleteShift?.userName} adlı personelin vardiyasını iptal etmek istediğinize emin misiniz?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteShift(null)}>
                Vazgeç
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'İptal Et'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Swap Shift Dialog */}
        <Dialog open={!!swapTargetShift} onOpenChange={(open) => {
          if (!open) {
            setSwapTargetShift(null);
            setSelectedOwnShiftId('');
          }
        }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-5 w-5 text-orange-500" />
                Vardiya Yer Değiştirme
              </DialogTitle>
              <DialogDescription>
                Aşağıdaki vardiya ile yer değiştirmek istediğiniz kendi vardiyenizi seçin.
              </DialogDescription>
            </DialogHeader>

            {swapTargetShift && (
              <div className="space-y-4">
                {/* Target shift info */}
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">Hedef Vardiya</p>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={swapTargetShift.role === 'teknik_servis' ? 'default' : 'secondary'} className="text-xs">
                      {swapTargetShift.role === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}
                    </Badge>
                    <span className="font-semibold">{swapTargetShift.userName}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDateTime(swapTargetShift.startDate, swapTargetShift.startTime)} - {formatDateTime(swapTargetShift.endDate, swapTargetShift.endTime)}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {swapTargetShift.laboratoryNames.slice(0, 3).map((name, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                    ))}
                    {swapTargetShift.laboratoryNames.length > 3 && (
                      <Badge variant="outline" className="text-xs">+{swapTargetShift.laboratoryNames.length - 3}</Badge>
                    )}
                  </div>
                </div>

                {/* Own shifts selection */}
                <div>
                  <p className="text-sm font-medium mb-2">Kendi vardiyenizi seçin:</p>
                  {mySwappableShifts.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground border rounded-lg">
                      <ArrowLeftRight className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Yer değiştirilebilecek aktif vardiyeniz bulunamadı.</p>
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[250px]">
                      <div className="space-y-2 pr-2">
                        {mySwappableShifts.map(shift => (
                          <button
                            key={shift.id}
                            type="button"
                            onClick={() => setSelectedOwnShiftId(shift.id)}
                            className={`w-full text-left rounded-lg border p-3 transition-colors ${
                              selectedOwnShiftId === shift.id
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{shift.userName}</span>
                              <Badge variant="outline" className="text-xs">
                                {shift.role === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDateTime(shift.startDate, shift.startTime)} - {formatDateTime(shift.endDate, shift.endTime)}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {shift.laboratoryNames.slice(0, 2).map((name, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                              ))}
                              {shift.laboratoryNames.length > 2 && (
                                <Badge variant="outline" className="text-xs">+{shift.laboratoryNames.length - 2}</Badge>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setSwapTargetShift(null); setSelectedOwnShiftId(''); }}>
                Vazgeç
              </Button>
              <Button
                onClick={handleSwap}
                disabled={!selectedOwnShiftId || isSwapping}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {isSwapping ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ArrowLeftRight className="h-4 w-4 mr-1" />
                )}
                Yer Değiştir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
