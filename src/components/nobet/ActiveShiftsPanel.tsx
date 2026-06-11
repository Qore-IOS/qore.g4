'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  ArrowLeft, Wrench, FlaskConical, User, Building2,
  CalendarDays, Trash2, Loader2, Calendar,
  Eye, Clock, CheckCircle2, ChevronLeft, ChevronRight, ListFilter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isWithinInterval, isBefore, isAfter, parseISO, eachDayOfInterval, differenceInDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { collection, query, getDocs, doc, updateDoc, where } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { toDateFromAny } from '@/lib/time';
import type { Hospital, User as UserType, ShiftSchedule, ShiftDateRange } from '@/lib/types';

interface ActiveShiftsPanelProps {
  hospitals: Hospital[];
  users: UserType[];
  onBack: () => void;
}

type PersonnelFilter = 'all' | 'teknik_servis' | 'aplikasyon';

// Flattened shift row - her tarih araligi icin ayri satir
interface FlattenedShiftRow {
  shiftId: string;
  personnelUid: string;
  personnelName: string;
  personnelType: 'teknik_servis' | 'aplikasyon';
  laboratoryIds: string[];
  laboratoryNames: string[];
  dateRange: ShiftDateRange;
  rangeIndex: number;
  status: 'active' | 'future';
  daysRemaining: number;
  totalDays: number;
  createdAt: any;
}

const ITEMS_PER_PAGE = 10;

export default function ActiveShiftsPanel({
  hospitals,
  users,
  onBack
}: ActiveShiftsPanelProps) {
  const { isAdmin, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [personnelFilter, setPersonnelFilter] = useState<PersonnelFilter>('all');
  const [selectedShift, setSelectedShift] = useState<ShiftSchedule | null>(null);
  const [deleteConfirmShift, setDeleteConfirmShift] = useState<ShiftSchedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch shifts - only filter by isActive, sort client-side to avoid composite index issues
  useEffect(() => {
    const fetchShifts = async () => {
      setIsLoading(true);
      try {
        const shiftsQuery = scopedQuery(
          'shiftSchedules',
          currentCompanyId,
          isSuperAdmin,
          where('isActive', '==', true)
        );
        const snapshot = await getDocsResilient(shiftsQuery);
        const shiftsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ShiftSchedule[];
        // Sort client-side by createdAt descending
        shiftsData.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.() ? a.createdAt.toDate().getTime() : 0;
          const bTime = b.createdAt?.toDate?.() ? b.createdAt.toDate().getTime() : 0;
          return bTime - aTime;
        });
        setShifts(shiftsData);
      } catch (error) {
        console.error('Fetch shifts error:', error);
        toast({
          title: 'Hata',
          description: 'Nobet kayitlari yuklenirken bir hata olustu.',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchShifts();
  }, [toast]);

  // Get status for a single date range
  const getDateRangeStatus = (range: ShiftDateRange): 'active' | 'past' | 'future' => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = parseISO(range.startDate);
    const end = parseISO(range.endDate);

    if (isWithinInterval(today, { start, end })) {
      return 'active';
    } else if (isAfter(start, today)) {
      return 'future';
    }
    return 'past';
  };

  // Flatten shifts - her tarih araligi icin ayri satir, sadece aktif ve gelecek
  const flattenedShiftRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows: FlattenedShiftRow[] = [];

    for (const shift of shifts) {
      // Personnel filter
      if (personnelFilter !== 'all' && shift.personnelType !== personnelFilter) {
        continue;
      }

      for (let i = 0; i < shift.dateRanges.length; i++) {
        const range = shift.dateRanges[i];
        const status = getDateRangeStatus(range);

        // Sadece aktif ve gelecek tarihleri dahil et
        if (status === 'past') {
          continue;
        }

        const start = parseISO(range.startDate);
        const end = parseISO(range.endDate);
        const totalDays = eachDayOfInterval({ start, end }).length;

        let daysRemaining = 0;
        if (status === 'active') {
          daysRemaining = differenceInDays(end, today) + 1;
        } else {
          daysRemaining = differenceInDays(start, today);
        }

        rows.push({
          shiftId: shift.id,
          personnelUid: shift.personnelUid,
          personnelName: shift.personnelName,
          personnelType: shift.personnelType,
          laboratoryIds: shift.laboratoryIds,
          laboratoryNames: shift.laboratoryNames,
          dateRange: range,
          rangeIndex: i,
          status,
          daysRemaining,
          totalDays,
          createdAt: shift.createdAt
        });
      }
    }

    // Sort: active first, then by start date
    rows.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return parseISO(a.dateRange.startDate).getTime() - parseISO(b.dateRange.startDate).getTime();
    });

    return rows;
  }, [shifts, personnelFilter]);

  // Pagination
  const totalPages = Math.ceil(flattenedShiftRows.length / ITEMS_PER_PAGE);
  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return flattenedShiftRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [flattenedShiftRows, currentPage]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [personnelFilter]);

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
        title: 'Basarili',
        description: 'Nobet kaydi silindi.'
      });
    } catch (error) {
      console.error('Delete shift error:', error);
      toast({
        title: 'Hata',
        description: 'Nobet kaydi silinirken bir hata olustu.',
        variant: 'destructive'
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmShift(null);
    }
  };

  // Find full shift for detail view
  const findShiftById = (shiftId: string): ShiftSchedule | undefined => {
    return shifts.find(s => s.id === shiftId);
  };

  // Status badge
  const StatusBadge = ({ status, daysRemaining }: { status: 'active' | 'future'; daysRemaining: number }) => {
    if (status === 'active') {
      return (
        <Badge className="bg-green-500 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Aktif ({daysRemaining} gun kaldi)
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 border-blue-500/30">
        <Clock className="h-3 w-3 mr-1" />
        {daysRemaining} gun sonra
      </Badge>
    );
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
        <span className="ml-3 text-lg">Nobet kayitlari yukleniyor...</span>
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
            <Calendar className="h-6 w-6" />
            Aktif Vardiyalar
          </h1>
          <Badge variant="outline" className="ml-2">
            {flattenedShiftRows.length} kayit
          </Badge>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <Select value={personnelFilter} onValueChange={(v) => setPersonnelFilter(v as PersonnelFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Personel Tipi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tumu</SelectItem>
              <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
              <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {flattenedShiftRows.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Calendar className="h-12 w-12" />
              <p className="text-lg">Aktif veya yaklasan nobet kaydi bulunamadi.</p>
              <p className="text-sm">Filtreleri degistirmeyi veya yeni bir vardiya olusturmayi deneyin.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {paginatedRows.map((row, index) => (
              <Card key={`${row.shiftId}-${row.rangeIndex}`} className={cn(
                "transition-colors",
                row.status === 'active' && "border-green-500/50 bg-green-500/5"
              )}>
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Left: Main info */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TypeBadge type={row.personnelType} />
                        <StatusBadge status={row.status} daysRemaining={row.daysRemaining} />
                        <Badge variant="outline">
                          {row.totalDays} gun
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-lg font-medium">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {row.personnelName}
                      </div>

                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="flex flex-wrap gap-1">
                          {row.laboratoryNames.slice(0, 3).map((name, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {name.length > 20 ? name.slice(0, 20) + '...' : name}
                            </Badge>
                          ))}
                          {row.laboratoryNames.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{row.laboratoryNames.length - 3}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {format(parseISO(row.dateRange.startDate), 'd MMMM yyyy', { locale: tr })}
                          {' - '}
                          {format(parseISO(row.dateRange.endDate), 'd MMMM yyyy', { locale: tr })}
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedShift(findShiftById(row.shiftId) || null)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Detay
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteConfirmShift(findShiftById(row.shiftId) || null)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 p-4 border-t bg-card">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Sayfa {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

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
                  Nobet vardiyasi detaylari
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
                    Tarih Araliklari ({selectedShift.dateRanges.length})
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
                          <Badge variant="outline">{days} gun</Badge>
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
            <AlertDialogTitle>Nobet Kaydini Sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu nobet kaydini silmek istediginizden emin misiniz?
              {deleteConfirmShift && (
                <span className="block mt-2 font-medium">
                  {deleteConfirmShift.personnelName}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Iptal</AlertDialogCancel>
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
