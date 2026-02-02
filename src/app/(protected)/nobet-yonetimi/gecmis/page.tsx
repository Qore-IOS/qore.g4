'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, History, Eye, Loader2, Wrench, FlaskConical, Building2, Calendar, XCircle, CheckCircle } from 'lucide-react';
import { useDutyShiftsByStatus, useHospitals, useAllDutyShifts } from '@/hooks/useFirebaseQueries';
import { format, differenceInDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DutyShift } from '@/lib/types';

export default function GecmisPage() {
  const router = useRouter();
  const { data: allShifts = [], isLoading } = useAllDutyShifts();
  const { data: hospitals = [] } = useHospitals();

  const [filterLab, setFilterLab] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [detailShift, setDetailShift] = useState<DutyShift | null>(null);

  // Filter to only past/completed/cancelled shifts
  const pastShifts = useMemo(() => {
    const now = new Date();
    return allShifts.filter(s => {
      const endDate = s.endDate instanceof Date ? s.endDate : new Date(s.endDate as any);
      // Include if status is completed/cancelled OR if end date has passed
      return s.status === 'completed' || s.status === 'cancelled' || endDate < now;
    });
  }, [allShifts]);

  // Apply filters
  const filteredShifts = useMemo(() => {
    let result = pastShifts;

    if (filterLab !== 'all') {
      result = result.filter(s => s.laboratoryIds.includes(filterLab));
    }

    if (filterStatus !== 'all') {
      if (filterStatus === 'completed') {
        result = result.filter(s => s.status === 'completed' || (s.status === 'active' && new Date(s.endDate as any) < new Date()));
      } else if (filterStatus === 'cancelled') {
        result = result.filter(s => s.status === 'cancelled');
      }
    }

    return result;
  }, [pastShifts, filterLab, filterStatus]);

  const formatDate = (date: any) => {
    const d = date instanceof Date ? date : new Date(date);
    return format(d, 'd MMMM yyyy', { locale: tr });
  };

  const getStatusBadge = (shift: DutyShift) => {
    if (shift.status === 'cancelled') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          İptal Edildi
        </Badge>
      );
    }
    return (
      <Badge className="bg-gray-500">
        <CheckCircle className="h-3 w-3 mr-1" />
        Tamamlandı
      </Badge>
    );
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
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <History className="h-6 w-6 text-orange-500" />
              <h1 className="text-xl font-bold">Geçmiş Vardiyalar</h1>
              <Badge variant="secondary">{filteredShifts.length} kayıt</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Durum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Durumlar</SelectItem>
                  <SelectItem value="completed">Tamamlandı</SelectItem>
                  <SelectItem value="cancelled">İptal Edildi</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterLab} onValueChange={setFilterLab}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Laboratuvar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Laboratuvarlar</SelectItem>
                  {hospitals.map(h => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredShifts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mb-4 opacity-30" />
              <p>Geçmiş vardiya bulunamadı.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredShifts.map(shift => (
              <Card key={shift.id} className="opacity-80 hover:opacity-100 transition-opacity">
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
                        {getStatusBadge(shift)}
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailShift(shift)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Detay
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
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
                  <p className="text-sm text-muted-foreground">Durum</p>
                  {getStatusBadge(detailShift)}
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
      </div>
    </div>
  );
}
