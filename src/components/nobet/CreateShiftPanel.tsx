'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LabSelector } from '@/components/common/LabSelector';
import { ArrowLeft, Plus, Trash2, Wrench, FlaskConical, User, Building2, CalendarDays, Save, Loader2, Check, ChevronDown, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { collection, addDoc, serverTimestamp } from '../../lib/data/client';
import { db } from '../../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { useToast } from '@/hooks/use-toast';
import MultiDateRangePicker from './MultiDateRangePicker';
import type { Hospital, User as UserType, ShiftScheduleRow, ShiftDateRange, ShiftPersonnelType } from '@/lib/types';

interface CreateShiftPanelProps {
  hospitals: Hospital[];
  users: UserType[];
  onBack: () => void;
  onSuccess: () => void;
}

interface CompanionPersonnel {
  uid: string;
  name: string;
  type: ShiftPersonnelType;
}

interface ShiftRow {
  id: string;
  personnelUid: string;
  personnelName: string;
  laboratoryIds: string[];
  laboratoryNames: string[];
  dateRanges: ShiftDateRange[];
  companions: CompanionPersonnel[];
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export default function CreateShiftPanel({
  hospitals,
  users,
  onBack,
  onSuccess
}: CreateShiftPanelProps) {
  const { currentUserProfile, currentCompanyId } = useAuth();
  const { toast } = useToast();

  // Separate rows for each type
  const [teknikRows, setTeknikRows] = useState<ShiftRow[]>([]);
  const [aplikasyonRows, setAplikasyonRows] = useState<ShiftRow[]>([]);

  // Active row for editing
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ShiftPersonnelType | null>(null);

  // Modal states
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isCompanionSelectorOpen, setIsCompanionSelectorOpen] = useState(false);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Filter users by role
  const teknikUsers = useMemo(() =>
    users.filter(u => u.role === 'teknik_servis' || u.role === 'admin'),
    [users]
  );

  const aplikasyonUsers = useMemo(() =>
    users.filter(u => u.role === 'aplikasyon' || u.role === 'admin'),
    [users]
  );

  // Add new row
  const addRow = (type: ShiftPersonnelType) => {
    const newRow: ShiftRow = {
      id: generateId(),
      personnelUid: '',
      personnelName: '',
      laboratoryIds: [],
      laboratoryNames: [],
      dateRanges: [],
      companions: []
    };

    if (type === 'teknik_servis') {
      setTeknikRows(prev => [...prev, newRow]);
    } else {
      setAplikasyonRows(prev => [...prev, newRow]);
    }
  };

  // Remove row
  const removeRow = (type: ShiftPersonnelType, rowId: string) => {
    if (type === 'teknik_servis') {
      setTeknikRows(prev => prev.filter(r => r.id !== rowId));
    } else {
      setAplikasyonRows(prev => prev.filter(r => r.id !== rowId));
    }
  };

  // Update row personnel
  const updateRowPersonnel = (type: ShiftPersonnelType, rowId: string, uid: string) => {
    const userList = type === 'teknik_servis' ? teknikUsers : aplikasyonUsers;
    const user = userList.find(u => u.uid === uid);
    if (!user) return;

    const updateFn = (prev: ShiftRow[]) =>
      prev.map(row =>
        row.id === rowId
          ? { ...row, personnelUid: uid, personnelName: user.name || user.email || 'Bilinmeyen' }
          : row
      );

    if (type === 'teknik_servis') {
      setTeknikRows(updateFn);
    } else {
      setAplikasyonRows(updateFn);
    }
  };

  // Get active row
  const getActiveRow = (): ShiftRow | undefined => {
    if (!activeRowId || !activeType) return undefined;
    const rows = activeType === 'teknik_servis' ? teknikRows : aplikasyonRows;
    return rows.find(r => r.id === activeRowId);
  };

  // Update active row laboratories
  const updateRowLabs = (type: ShiftPersonnelType, rowId: string, labIds: string[]) => {
    const labNames = labIds.map(id => {
      const hospital = hospitals.find(h => h.id === id);
      return hospital?.name || 'Bilinmeyen';
    });

    const updateFn = (prev: ShiftRow[]) =>
      prev.map(row =>
        row.id === rowId
          ? { ...row, laboratoryIds: labIds, laboratoryNames: labNames }
          : row
      );

    if (type === 'teknik_servis') {
      setTeknikRows(updateFn);
    } else {
      setAplikasyonRows(updateFn);
    }
  };

  // Update active row date ranges
  const updateActiveRowDateRanges = (ranges: ShiftDateRange[]) => {
    if (!activeRowId || !activeType) return;

    const updateFn = (prev: ShiftRow[]) =>
      prev.map(row =>
        row.id === activeRowId
          ? { ...row, dateRanges: ranges }
          : row
      );

    if (activeType === 'teknik_servis') {
      setTeknikRows(updateFn);
    } else {
      setAplikasyonRows(updateFn);
    }
  };

  // Open calendar for a row
  const openCalendar = (type: ShiftPersonnelType, rowId: string) => {
    setActiveType(type);
    setActiveRowId(rowId);
    setIsCalendarOpen(true);
  };

  // Open companion selector for a row
  const openCompanionSelector = (type: ShiftPersonnelType, rowId: string) => {
    setActiveType(type);
    setActiveRowId(rowId);
    setIsCompanionSelectorOpen(true);
  };

  // Update active row companions
  const updateActiveRowCompanions = (companions: CompanionPersonnel[]) => {
    if (!activeRowId || !activeType) return;

    const updateFn = (prev: ShiftRow[]) =>
      prev.map(row =>
        row.id === activeRowId
          ? { ...row, companions }
          : row
      );

    if (activeType === 'teknik_servis') {
      setTeknikRows(updateFn);
    } else {
      setAplikasyonRows(updateFn);
    }
  };

  // Toggle companion selection
  const toggleCompanion = (uid: string, name: string, type: ShiftPersonnelType) => {
    if (!activeRow) return;

    const isSelected = activeRow.companions.some(c => c.uid === uid);
    let newCompanions: CompanionPersonnel[];

    if (isSelected) {
      newCompanions = activeRow.companions.filter(c => c.uid !== uid);
    } else {
      newCompanions = [...activeRow.companions, { uid, name, type }];
    }

    updateActiveRowCompanions(newCompanions);
  };

  // Validate rows
  const isRowValid = (row: ShiftRow): boolean => {
    return (
      row.personnelUid !== '' &&
      row.laboratoryIds.length > 0 &&
      row.dateRanges.length > 0
    );
  };

  // Check if there are any valid rows
  const hasValidRows = useMemo(() => {
    return [...teknikRows, ...aplikasyonRows].some(isRowValid);
  }, [teknikRows, aplikasyonRows]);

  // Save all shifts
  const handleSave = async () => {
    if (!currentUserProfile) {
      toast({
        title: 'Hata',
        description: 'Oturum bilgisi bulunamadı.',
        variant: 'destructive'
      });
      return;
    }

    const allRows = [
      ...teknikRows.filter(isRowValid).map(r => ({ ...r, type: 'teknik_servis' as ShiftPersonnelType })),
      ...aplikasyonRows.filter(isRowValid).map(r => ({ ...r, type: 'aplikasyon' as ShiftPersonnelType }))
    ];

    if (allRows.length === 0) {
      toast({
        title: 'Uyarı',
        description: 'Kaydedilecek geçerli bir vardiya bulunamadı.',
        variant: 'destructive'
      });
      return;
    }

    setIsSaving(true);
    try {
      const shiftsCollection = collection(db, 'shiftSchedules');
      let totalCreated = 0;

      for (const row of allRows) {
        // Ana personel için vardiya oluştur
        await addDoc(shiftsCollection, withCompanyScope({
          personnelUid: row.personnelUid,
          personnelName: row.personnelName,
          personnelType: row.type,
          laboratoryIds: row.laboratoryIds,
          laboratoryNames: row.laboratoryNames,
          dateRanges: row.dateRanges,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen',
          isActive: true
        }, currentCompanyId));
        totalCreated++;

        // Eşlik eden personeller için vardiya oluştur
        for (const companion of row.companions) {
          await addDoc(shiftsCollection, withCompanyScope({
            personnelUid: companion.uid,
            personnelName: companion.name,
            personnelType: companion.type,
            laboratoryIds: row.laboratoryIds,
            laboratoryNames: row.laboratoryNames,
            dateRanges: row.dateRanges,
            createdAt: serverTimestamp(),
            createdByUid: currentUserProfile.uid,
            createdByName: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen',
            isActive: true
          }, currentCompanyId));
          totalCreated++;
        }
      }

      toast({
        title: 'Başarılı',
        description: `${totalCreated} vardiya kaydı oluşturuldu.`
      });

      onSuccess();
    } catch (error) {
      console.error('Shift save error:', error);
      toast({
        title: 'Hata',
        description: 'Vardiyalar kaydedilirken bir hata oluştu.',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Render a shift row
  const renderRow = (row: ShiftRow, type: ShiftPersonnelType) => {
    const userList = type === 'teknik_servis' ? teknikUsers : aplikasyonUsers;
    const isValid = isRowValid(row);

    return (
      <Card key={row.id} className={cn(
        "border transition-colors",
        isValid ? "border-green-500/50 bg-green-500/5" : "border-border"
      )}>
        <CardContent className="p-4 space-y-3">
          {/* Row Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Personel Seçimi</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => removeRow(type, row.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Personnel Select */}
          <Select
            value={row.personnelUid}
            onValueChange={(value) => updateRowPersonnel(type, row.id, value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Personel seçin..." />
            </SelectTrigger>
            <SelectContent>
              {userList.map(user => (
                <SelectItem key={user.uid} value={user.uid}>
                  {user.name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Laboratory Selection */}
          {row.personnelUid && (
            <LabSelector
              mode="multi"
              label="Laboratuvarlar"
              labs={hospitals.map(h => ({ id: h.id, name: h.name, kod: h.kod }))}
              values={row.laboratoryIds}
              onValuesChange={(ids) => updateRowLabs(type, row.id, ids)}
              placeholder="Laboratuvar seçin..."
              showChips
              icon={<Building2 className="h-4 w-4" />}
            />
          )}

          {/* Date Range Selection */}
          {row.personnelUid && row.laboratoryIds.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Nöbet Tarihleri</span>
              </div>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => openCalendar(type, row.id)}
              >
                <span className="truncate">
                  {row.dateRanges.length > 0
                    ? `${row.dateRanges.length} tarih aralığı`
                    : 'Tarih aralığı seçin...'}
                </span>
                <CalendarDays className="h-4 w-4 ml-2 shrink-0" />
              </Button>
              {row.dateRanges.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {row.dateRanges.map((range, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {format(new Date(range.startDate), 'd MMM', { locale: tr })} -
                      {format(new Date(range.endDate), 'd MMM', { locale: tr })}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Companion Personnel Selection - shown after dates are selected */}
          {row.personnelUid && row.laboratoryIds.length > 0 && row.dateRanges.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Eşlik Eden Personel</span>
                <span className="text-xs text-muted-foreground">(Opsiyonel)</span>
              </div>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => openCompanionSelector(type, row.id)}
              >
                <span className="truncate">
                  {row.companions.length > 0
                    ? `${row.companions.length} personel seçildi`
                    : 'Eşlik eden personel seçin...'}
                </span>
                <Users className="h-4 w-4 ml-2 shrink-0" />
              </Button>
              {row.companions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {row.companions.map((companion, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className={cn(
                        "text-xs",
                        companion.type === 'teknik_servis'
                          ? "bg-orange-500/10 text-orange-600 border-orange-500/30"
                          : "bg-blue-500/10 text-blue-600 border-blue-500/30"
                      )}
                    >
                      {companion.type === 'teknik_servis' ? (
                        <Wrench className="h-3 w-3 mr-1" />
                      ) : (
                        <FlaskConical className="h-3 w-3 mr-1" />
                      )}
                      {companion.name.length > 15 ? companion.name.slice(0, 15) + '...' : companion.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Validity indicator */}
          {isValid && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <Check className="h-4 w-4" />
              <span>Kayda hazır{row.companions.length > 0 && ` (+${row.companions.length} eşlik eden)`}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Render panel section
  const renderSection = (
    type: ShiftPersonnelType,
    rows: ShiftRow[],
    icon: React.ElementType,
    title: string,
    color: string
  ) => {
    const Icon = icon;

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className={cn(
          "flex items-center gap-3 p-4 border-b",
          color
        )}>
          <Icon className="h-6 w-6" />
          <h2 className="text-xl font-semibold">{title}</h2>
          <Badge variant="outline" className="ml-auto">
            {rows.length} satır
          </Badge>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Henüz vardiya satırı eklenmedi.</p>
                <p className="text-sm mt-1">Aşağıdaki butona tıklayarak satır ekleyin.</p>
              </div>
            ) : (
              rows.map(row => renderRow(row, type))
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => addRow(type)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Satır Ekle
          </Button>
        </div>
      </div>
    );
  };

  const activeRow = getActiveRow();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
          <h1 className="text-2xl font-bold">Vardiya Oluştur</h1>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasValidRows || isSaving}
          className="gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Kaydediliyor...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Kaydet
            </>
          )}
        </Button>
      </div>

      {/* Split Panels */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 divide-y md:divide-y-0 md:divide-x">
        {renderSection(
          'teknik_servis',
          teknikRows,
          Wrench,
          'Teknik Servis',
          'text-orange-600'
        )}
        {renderSection(
          'aplikasyon',
          aplikasyonRows,
          FlaskConical,
          'Aplikasyon',
          'text-blue-600'
        )}
      </div>

      {/* Calendar Dialog */}
      <Dialog open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Nöbet Tarih Aralıkları
            </DialogTitle>
            <DialogDescription>
              Birden fazla tarih aralığı seçebilirsiniz. Başlangıç tarihine tıklayıp bitiş tarihini seçin.
            </DialogDescription>
          </DialogHeader>
          <MultiDateRangePicker
            selectedRanges={activeRow?.dateRanges || []}
            onRangesChange={updateActiveRowDateRanges}
          />
          <DialogFooter>
            <Button onClick={() => setIsCalendarOpen(false)}>
              Tamam ({activeRow?.dateRanges.length || 0} aralık)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Companion Personnel Selector Dialog */}
      <Dialog open={isCompanionSelectorOpen} onOpenChange={setIsCompanionSelectorOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Eşlik Eden Personel Seçimi
            </DialogTitle>
            <DialogDescription>
              Bu vardiyada eşlik edecek teknik servis veya aplikasyon personelini seçin. Seçilen personeller için aynı laboratuvar ve tarih aralıklarında otomatik vardiya oluşturulacaktır.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-4">
              {/* Teknik Servis Personelleri */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-orange-600 font-medium">
                  <Wrench className="h-4 w-4" />
                  <span>Teknik Servis</span>
                </div>
                <div className="space-y-1">
                  {teknikUsers
                    .filter(u => u.uid !== activeRow?.personnelUid) // Kendisi hariç
                    .map(user => {
                      const isSelected = activeRow?.companions.some(c => c.uid === user.uid) || false;
                      return (
                        <label
                          key={user.uid}
                          className={cn(
                            "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                            isSelected
                              ? "border-orange-500 bg-orange-500/10"
                              : "border-border hover:bg-accent/50"
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleCompanion(
                              user.uid,
                              user.name || user.email || 'Bilinmeyen',
                              'teknik_servis'
                            )}
                          />
                          <span className="flex-1">{user.name || user.email}</span>
                        </label>
                      );
                    })}
                  {teknikUsers.filter(u => u.uid !== activeRow?.personnelUid).length === 0 && (
                    <p className="text-sm text-muted-foreground p-2">Seçilebilecek personel yok</p>
                  )}
                </div>
              </div>

              {/* Aplikasyon Personelleri */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-blue-600 font-medium">
                  <FlaskConical className="h-4 w-4" />
                  <span>Aplikasyon</span>
                </div>
                <div className="space-y-1">
                  {aplikasyonUsers
                    .filter(u => u.uid !== activeRow?.personnelUid) // Kendisi hariç
                    .map(user => {
                      const isSelected = activeRow?.companions.some(c => c.uid === user.uid) || false;
                      return (
                        <label
                          key={user.uid}
                          className={cn(
                            "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                            isSelected
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-border hover:bg-accent/50"
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleCompanion(
                              user.uid,
                              user.name || user.email || 'Bilinmeyen',
                              'aplikasyon'
                            )}
                          />
                          <span className="flex-1">{user.name || user.email}</span>
                        </label>
                      );
                    })}
                  {aplikasyonUsers.filter(u => u.uid !== activeRow?.personnelUid).length === 0 && (
                    <p className="text-sm text-muted-foreground p-2">Seçilebilecek personel yok</p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setIsCompanionSelectorOpen(false)}>
              Tamam ({activeRow?.companions.length || 0} seçili)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
