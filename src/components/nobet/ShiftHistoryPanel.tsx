'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  ArrowLeft, History, Wrench, FlaskConical, User, Building2,
  CalendarDays, Trash2, Loader2, Search, Filter, Calendar,
  ChevronDown, ChevronUp, Eye, Clock, CheckCircle2, XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isWithinInterval, isBefore, isAfter, parseISO, eachDayOfInterval } from 'date-fns';
import { tr } from 'date-fns/locale';
import { collection, query, getDocs, doc, updateDoc, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { toDateFromAny } from '@/lib/time';
import type { Hospital, User as UserType, ShiftSchedule, ShiftDateRange } from '@/lib/types';

interface ShiftHistoryPanelProps {
  hospitals: Hospital[];
  users: UserType[];
  onBack: () => void;
}

type FilterType = 'all' | 'active' | 'past' | 'future';
type PersonnelFilter = 'all' | 'teknik_servis' | 'aplikasyon';

export default function ShiftHistoryPanel({
  hospitals,
  users,
  onBack
}: ShiftHistoryPanelProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [personnelFilter, setPersonnelFilter] = useState<PersonnelFilter>('all');
  const [selectedShift, setSelectedShift] = useState<ShiftSchedule | null>(null);
  const [deleteConfirmShift, setDeleteConfirmShift] = useState<ShiftSchedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch shifts
  useEffect(() => {
    const fetchShifts = async () => {
      setIsLoading(true);
      try {
        const shiftsQuery = query(
          collection(db, 'shiftSchedules'),
          where('isActive', '==', true),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(shiftsQuery);
        const shiftsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ShiftSchedule[];
        setShifts(shiftsData);
      } catch (error) {
        console.error('Fetch shifts error:', error);
        toast({
          title: 'Hata',
          description: 'Nöbet kayıtları yüklenirken bir hata oluştu.',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchShifts();
  }, [toast]);

  // Get shift status
  const getShiftStatus = (shift: ShiftSchedule): 'active' | 'past' | 'future' => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let hasActive = false;
    let hasFuture = false;
    let hasPast = false;

    for (const range of shift.dateRanges) {
      const start = parseISO(range.startDate);
      const end = parseISO(range.endDate);

      if (isWithinInterval(today, { start, end })) {
        hasActive = true;
      } else if (isAfter(start, today)) {
        hasFuture = true;
      } else if (isBefore(end, today)) {
        hasPast = true;
      }
    }

    if (hasActive) return 'active';
    if (hasFuture) return 'future';
    return 'past';
  };

  // Calculate total days for a shift
  const getTotalDays = (ranges: ShiftDateRange[]): number => {
    return ranges.reduce((total, range) => {
      const start = parseISO(range.startDate);
      const end = parseISO(range.endDate);
      return total + eachDayOfInterval({ start, end }).length;
    }, 0);
  };

  // Filter shifts
  const filteredShifts = useMemo(() => {
    return shifts.filter(shift => {
      // Personnel type filter
      if (personnelFilter !== 'all' && shift.personnelType !== personnelFilter) {
        return false;
      }

      // Status filter
      if (filterType !== 'all') {
        const status = getShiftStatus(shift);
        if (status !== filterType) {
          return false;
        }
      }

      return true;
    });
  }, [shifts, filterType, personnelFilter]);

  // Delete (soft delete) a shift
  const handleDelete = async () => {
    if (!deleteConfirmShift) return;

    setIsDeleting(true);
    try {
      await updateDoc(doc(db, 'shiftSchedules', deleteConfirmShift.id), {
        isActive: false
      });

      setShifts(prev => prev.filter(s => s.id !== deleteConfirmShift.id));
      toast({
        title: 'Başarılı',
        description: 'Nöbet kaydı silindi.'
      });
    } catch (error) {
      console.error('Delete shift error:', error);
      toast({
        title: 'Hata',
        description: 'Nöbet kaydı silinirken bir hata oluştu.',
        variant: 'destructive'
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmShift(null);
    }
  };

  // Status badge
  const StatusBadge = ({ status }: { status: 'active' | 'past' | 'future' }) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-500 hover:bg-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Aktif
          </Badge>
        );
      case 'future':
        return (
          <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 border-blue-500/30">
            <Clock className="h-3 w-3 mr-1" />
            Yaklaşan
          </Badge>
        );
      case 'past':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <XCircle className="h-3 w-3 mr-1" />
            Geçmiş
          </Badge>
        );
    }
  };

  // Type badge
  const TypeBadge = ({ type }: { type: 'teknik_servis' | 'aplikasyon' }) => {
    if (type === 'teknik_servis') {
      return (
        <Badge variant="outline" className="text-orange-600 border-orange-500/30 bg-orange-500/10">
          <Wrench className="h-3 w-3 mr-1" />
          Teknik
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-blue-600 border-blue-500/30 bg-blue-500/10">
        <FlaskConical className="h-3 w-3 mr-1" />
        Aplikasyon
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Nöbet kayıtları yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6" />
            Nöbet Geçmişi
          </h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={personnelFilter} onValueChange={(v) => setPersonnelFilter(v as PersonnelFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Personel Tipi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
              <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Durum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="future">Yaklaşan</SelectItem>
              <SelectItem value="past">Geçmiş</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {filteredShifts.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Calendar className="h-12 w-12" />
                <p className="text-lg">Nöbet kaydı bulunamadı.</p>
                <p className="text-sm">Filtreleri değiştirmeyi veya yeni bir vardiya oluşturmayı deneyin.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredShifts.map(shift => {
                const status = getShiftStatus(shift);
                const totalDays = getTotalDays(shift.dateRanges);
                const createdAt = toDateFromAny(shift.createdAt);

                return (
                  <Card key={shift.id} className={cn(
                    "transition-colors",
                    status === 'active' && "border-green-500/50"
                  )}>
                    <CardContent className="p-4">
                      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                        {/* Left: Main info */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <TypeBadge type={shift.personnelType} />
                            <StatusBadge status={status} />
                            <Badge variant="outline">
                              {totalDays} gün
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 text-lg font-medium">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {shift.personnelName}
                          </div>

                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
                            <div className="flex flex-wrap gap-1">
                              {shift.laboratoryNames.slice(0, 3).map((name, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {name.length > 20 ? name.slice(0, 20) + '...' : name}
                                </Badge>
                              ))}
                              {shift.laboratoryNames.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{shift.laboratoryNames.length - 3}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CalendarDays className="h-4 w-4 mt-0.5 shrink-0" />
                            <div className="flex flex-wrap gap-1">
                              {shift.dateRanges.slice(0, 2).map((range, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {format(parseISO(range.startDate), 'd MMM', { locale: tr })} -
                                  {format(parseISO(range.endDate), 'd MMM yyyy', { locale: tr })}
                                </Badge>
                              ))}
                              {shift.dateRanges.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{shift.dateRanges.length - 2} aralık
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Actions and metadata */}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedShift(shift)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Detay
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteConfirmShift(shift)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {createdAt && (
                        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                          Oluşturulma: {format(createdAt, 'd MMMM yyyy HH:mm', { locale: tr })}
                          {shift.createdByName && ` - ${shift.createdByName}`}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Detail Dialog */}
      <Dialog open={!!selectedShift} onOpenChange={() => setSelectedShift(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {selectedShift && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {selectedShift.personnelName}
                </DialogTitle>
                <DialogDescription>
                  Nöbet vardiyası detayları
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Type */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Personel Tipi</h4>
                  <TypeBadge type={selectedShift.personnelType} />
                </div>

                {/* Laboratories */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    Laboratuvarlar ({selectedShift.laboratoryNames.length})
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedShift.laboratoryNames.map((name, i) => (
                      <Badge key={i} variant="secondary">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Date Ranges */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    Tarih Aralıkları ({selectedShift.dateRanges.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedShift.dateRanges.map((range, i) => {
                      const start = parseISO(range.startDate);
                      const end = parseISO(range.endDate);
                      const days = eachDayOfInterval({ start, end }).length;
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const isActive = isWithinInterval(today, { start, end });
                      const isPast = isBefore(end, today);

                      return (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center justify-between p-2 rounded-lg border",
                            isActive && "border-green-500 bg-green-500/10",
                            isPast && "opacity-60"
                          )}
                        >
                          <span>
                            {format(start, 'd MMMM yyyy', { locale: tr })} -
                            {format(end, 'd MMMM yyyy', { locale: tr })}
                          </span>
                          <Badge variant="outline">{days} gün</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={() => setSelectedShift(null)}>Kapat</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmShift} onOpenChange={() => setDeleteConfirmShift(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nöbet Kaydını Sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu nöbet kaydını silmek istediğinizden emin misiniz?
              {deleteConfirmShift && (
                <span className="block mt-2 font-medium">
                  {deleteConfirmShift.personnelName} - {getTotalDays(deleteConfirmShift.dateRanges)} gün
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Siliniyor...
                </>
              ) : (
                'Sil'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
