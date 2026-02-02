'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Calendar, Eye, Trash2, Loader2, Wrench, FlaskConical, Building2, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useDutyShiftsByStatus, useHospitals } from '@/hooks/useFirebaseQueries';
import { db } from '@/lib/firebase';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
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

  // Filter shifts by selected lab
  const filteredShifts = useMemo(() => {
    if (filterLab === 'all') return shifts;
    return shifts.filter(s => s.laboratoryIds.includes(filterLab));
  }, [shifts, filterLab]);

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

  const formatDate = (date: any) => {
    const d = date instanceof Date ? date : new Date(date);
    return format(d, 'd MMMM yyyy', { locale: tr });
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

              return (
                <Card key={shift.id} className={active ? 'border-l-4 border-l-green-500' : ''}>
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

                        {/* Date Range */}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDate(shift.startDate)} - {formatDate(shift.endDate)}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
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
                  <p>{formatDate(detailShift.startDate)} - {formatDate(detailShift.endDate)}</p>
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
      </div>
    </div>
  );
}
