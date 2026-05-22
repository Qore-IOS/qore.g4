/**
 * @fileoverview Product Usage Panel Component
 * @description Enterprise-grade product usage panel for barcode scanning,
 * stock deduction, manual consumption, and trash bin operations in laboratory environments.
 * @module components/urun-kullanim-panel
 * @version 2.0.0
 */

'use client';
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import type { Laboratory, DepoStokItem, ConsumptionRecord, Device, ProductCode, BarcodeFormat, LabPool, DeviceGroup, TrashBinRecord, FaultDefinition } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Barcode, AlertTriangle, CheckCircle, PackageMinus, TrendingUp, Info, Clock, Camera, Loader2, Wrench, XCircle, ClipboardPlus, ChevronsUpDown, Check, Pencil, Play, Trash2, LogOut, FlaskConical, CalendarDays, X } from 'lucide-react';
import { playFeedback, sanitizeGS1 } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, onSnapshot, addDoc, updateDoc, orderBy, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { compareAsc, parse as parseDate, format as formatDate } from 'date-fns';
import { formatMiad } from '@/lib/date';
import { tr } from 'date-fns/locale';
import { resolveImageSrc } from '@/lib/image-utils';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { useTheme } from 'next-themes';
import { useUsageRouteSync } from '@/hooks/useUsageRouteSync';
import { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } from '@/lib/barcode';
import { TrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import { emitFefoOverride } from '@/lib/notifications';
import { Input } from './ui/input';
import { openDeviceFaultReport } from '@/lib/faults';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LabSelector } from '@/components/common/LabSelector';
import { useLightDashboardData } from './dashboard/useDashboardData';
import { useBarcodeFormatsQuery, useLabStock, useRecentConsumption, useSubPoints, useInvalidateQueries, useMinMaxRules, useLabPools, useDevices, useUsers, useActiveDutyShifts, useUpcomingDutyShifts } from '@/hooks/useFirebaseQueries';
import type { DutyShift } from '@/lib/types';
import { incrementTodayStats } from '@/lib/dailyConsumptionStats';
import { urunKullanimLogger } from '@/lib/logger';

const DynamicCameraBarcodeScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>,
});

/**
 * Formats a DutyShift date (Timestamp or Date) to a readable string
 */
function formatShiftDate(date: unknown): string {
  const d = date instanceof Date ? date : new Date(date as any);
  return formatDate(d, 'd MMM yyyy', { locale: tr });
}

/**
 * DutyScheduleModal - Shows upcoming 30 days duty schedule for the selected lab
 */
function DutyScheduleModal({ open, onOpenChange, selectedLabId }: { open: boolean; onOpenChange: (open: boolean) => void; selectedLabId: string | null }) {
  const { data: upcomingShifts = [], isLoading } = useUpcomingDutyShifts(selectedLabId);

  const teknikServisShifts = useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'teknik_servis'),
    [upcomingShifts]
  );
  const aplikasyonShifts = useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'aplikasyon'),
    [upcomingShifts]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Nöbet Takvimi - Gelecek 30 Gün
          </DialogTitle>
          <DialogDescription>
            Seçili laboratuvara atanmış nöbetçi personel listesi
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Yükleniyor...</span>
            </div>
          ) : upcomingShifts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Gelecek 30 gün için nöbet kaydı bulunamadı.</p>
            </div>
          ) : (
            <div className="space-y-6 pr-3">
              {/* Teknik Servis Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4 text-blue-400" />
                  <h3 className="font-semibold text-sm text-blue-400 uppercase tracking-wider">Teknik Servis</h3>
                </div>
                {teknikServisShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {teknikServisShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-blue-500/5 border-blue-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Aplikasyon Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="h-4 w-4 text-purple-400" />
                  <h3 className="font-semibold text-sm text-purple-400 uppercase tracking-wider">Aplikasyon</h3>
                </div>
                {aplikasyonShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {aplikasyonShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-purple-500/5 border-purple-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PeripheralFaultContactModal - Shows responsible personnel contact info for perifer labs
 * Displays QR codes for phone calls and a 60-second countdown ring
 */
function PeripheralFaultContactModal({ open, onOpenChange, users }: { open: boolean; onOpenChange: (open: boolean) => void; users: any[] }) {
  const [timeLeft, setTimeLeft] = useState(60);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setTimeLeft(60);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onOpenChange(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [open, onOpenChange]);

  useEffect(() => {
    const generateQRs = async () => {
      const codes: Record<string, string> = {};
      for (const user of users) {
        if (user.phoneNumber) {
          try {
            const phone = user.phoneNumber.toString().trim();
            const formattedPhone = phone.startsWith('+') ? phone : '+90' + phone.replace(/^0/, '');
            const url = await QRCode.toDataURL(`tel:${formattedPhone}`);
            codes[user.uid] = url;
          } catch (e) {
            console.error('QR generate error', e);
          }
        }
      }
      setQrCodes(codes);
    };
    if (open && users.length > 0) generateQRs();
  }, [open, users]);

  // SVG for circular progress
  const radius = 140;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (timeLeft / 60) * circumference;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 bg-transparent border-none shadow-none max-w-fit flex items-center justify-center overflow-visible">
        <div className="relative flex items-center justify-center w-[420px] h-[420px]">
           {/* Ring Progress */}
           <svg className="absolute w-full h-full -rotate-90 pointer-events-none">
             <circle
               cx="210"
               cy="210"
               r={radius}
               stroke="currentColor"
               strokeWidth="8"
               fill="transparent"
               className="text-white/10"
             />
             <motion.circle
               cx="210"
               cy="210"
               r={radius}
               stroke="currentColor"
               strokeWidth="8"
               fill="transparent"
               strokeDasharray={circumference}
               initial={{ strokeDashoffset: circumference }}
               animate={{ strokeDashoffset }}
               transition={{ duration: 0.5, ease: "linear" }}
               className="text-primary"
             />
           </svg>

           {/* Circular Modal Content */}
           <div className="bg-background rounded-full w-[340px] h-[340px] flex flex-col items-center justify-center p-6 text-center shadow-2xl border-4 border-primary/20 overflow-hidden relative">
              <button 
                onClick={() => onOpenChange(false)}
                className="absolute top-6 right-6 text-muted-foreground hover:text-foreground z-10"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="mt-4 flex-1 flex flex-col items-center justify-center w-full">
                <h2 className="text-lg font-bold mb-1">Yetkili Personel</h2>
                <p className="text-[10px] text-muted-foreground mb-4 leading-tight px-4">
                  bu QR kodu okutarak yetkili personel ile iletişime geçebilirsiniz
                </p>

                <ScrollArea className="w-full flex-1">
                  <div className="flex flex-col gap-6 items-center py-2">
                    {users.map((user) => (
                      <div key={user.uid} className="flex flex-col items-center">
                        <p className="text-sm font-semibold">{user.name}</p>
                        <p className="text-[9px] uppercase font-bold tracking-widest text-primary mb-2">{user.role?.replace('_', ' ')}</p>
                        {qrCodes[user.uid] ? (
                          <div className="p-2 bg-white rounded-xl shadow-inner">
                            <img src={qrCodes[user.uid]} alt="QR" className="w-24 h-24" />
                          </div>
                        ) : (
                          <div className="w-24 h-24 bg-muted/50 rounded-xl flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                    {users.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">Sorumlu personel bulunamadı.</p>
                    )}
                  </div>
                </ScrollArea>

                <div className="mt-2 mb-4">
                  <div className="text-xl font-mono font-black text-primary bg-primary/10 px-3 py-1 rounded-full">
                    00:{timeLeft.toString().padStart(2, '0')}
                  </div>
                </div>
              </div>
           </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * DutyInfo Component - Shows on-duty technician and application personnel
 * Reads from dutyShifts Firestore collection for active shifts
 * Clickable to open 30-day duty schedule modal
 */
function DutyInfo({ selectedLabId }: { selectedLabId: string | null }) {
  const { data: activeShifts = [] } = useActiveDutyShifts();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Find active duty shifts for this specific lab
  const dutyPersonnel = useMemo(() => {
    if (!selectedLabId || !activeShifts.length) return { teknikServis: null, aplikasyon: null };

    // Filter shifts that include this lab
    const labShifts = activeShifts.filter(shift =>
      shift.laboratoryIds.includes(selectedLabId)
    );

    // Find teknik_servis and aplikasyon shifts
    const teknikServisShift = labShifts.find(s => s.role === 'teknik_servis');
    const aplikasyonShift = labShifts.find(s => s.role === 'aplikasyon');

    return {
      teknikServis: teknikServisShift ? { name: teknikServisShift.userName } : null,
      aplikasyon: aplikasyonShift ? { name: aplikasyonShift.userName } : null,
    };
  }, [selectedLabId, activeShifts]);

  // Don't show duty info if no lab is selected
  if (!selectedLabId) return null;

  const hasDutyPersonnel = dutyPersonnel.teknikServis || dutyPersonnel.aplikasyon;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="hidden md:flex items-center gap-4 text-foreground cursor-pointer hover:opacity-80 transition-opacity rounded-lg px-3 py-1.5 hover:bg-white/5"
      >
        <span className="text-base opacity-70 font-semibold text-foreground">Nöbetçi</span>
        {hasDutyPersonnel ? (
          <>
            {dutyPersonnel.teknikServis && (
              <div className="flex items-center gap-2 duty-glow-text">
                <Wrench className="h-5 w-5 text-blue-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.teknikServis.name}</span>
              </div>
            )}
            {dutyPersonnel.teknikServis && dutyPersonnel.aplikasyon && (
              <span className="opacity-30 text-xl">|</span>
            )}
            {dutyPersonnel.aplikasyon && (
              <div className="flex items-center gap-2 duty-glow-text">
                <FlaskConical className="h-5 w-5 text-purple-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.aplikasyon.name}</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground italic">Atanmış nöbetçi yok</span>
        )}
      </button>
      <DutyScheduleModal open={isModalOpen} onOpenChange={setIsModalOpen} selectedLabId={selectedLabId} />
    </>
  );
}

/**
 * Logs serial number history to Firestore
 * @param seriNo - Serial number to log
 * @param type - Event type (consumption, transfer, etc.)
 * @param details - Event details
 */
const logSerialHistory = async (seriNo: string, type: string, details: Record<string, unknown>) => {
    if (!seriNo) {
        urunKullanimLogger.warn('Boş seri numarası için geçmiş kaydı atlandı', { type });
        return;
    }
    const historyRef = collection(db, `serialHistory/${seriNo}/events`);
    await addDoc(historyRef, {
        type,
        details,
        timestamp: Timestamp.now(),
    });
};

const buildManualDeductionKey = (labId: string, stokKodu: string, lotNumarasi?: string, miadRaw?: string) =>
  `${labId}__${stokKodu}__${lotNumarasi || ''}__${miadRaw || ''}`;

const resolveStockRowUnit = (item: DepoStokItem): number => {
  const raw = Number((item as any).quantity ?? (item as any).adet ?? 1);
  if (!Number.isFinite(raw)) return 1;
  // 0/negatif yazılmış legacy kayıtları listede sıfıra düşürmesin
  return raw > 0 ? Math.max(1, Math.ceil(raw)) : 1;
};

export default function UrunKullanimPanel() {
  const { currentUser, currentUserProfile, logout, wallpaper, currentCompanyId, isSuperAdmin } = useAuth();
  const { theme } = useTheme();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();

  const slug = params.slug as string[] | undefined;
  const labIdFromUrl = slug?.[0] || '';
  const pointIdFromUrl = slug?.[1] || '';

  // State must be defined before using in hooks
  const [selectedLabId, setSelectedLabId] = useState(labIdFromUrl);
  const [selectedSubPointId, setSelectedSubPointId] = useState(pointIdFromUrl);

  // Use lightweight dashboard data (no heavy collections like depoStok, tuketimKayitlari)
  const {
      hospitals: laboratories,
      productCodes: products,
      isLoading,
  } = useLightDashboardData();

  // Fetch lab pools and devices separately
  const { data: labPools = [], isLoading: labPoolsLoading } = useLabPools();
  const { data: devices = [] } = useDevices();

  // Use TanStack Query for barcode formats with caching
  const { data: barcodeFormats = [] } = useBarcodeFormatsQuery();
  const { invalidateConsumption, invalidateDepoStok } = useInvalidateQueries();

  // Fetch min/max rules for selected lab (for trash bin product filtering)
  const { data: minMaxRules = [] } = useMinMaxRules(selectedLabId);

  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);

  // Use TanStack Query for subPoints of selected lab only (not all labs!)
  const { data: selectedLabSubPoints = [] } = useSubPoints(selectedLabId);
  
  const { onHospitalSelect, onPointSelect } = useUsageRouteSync(
    selectedLabId,
    setSelectedLabId,
    selectedSubPointId,
    setSelectedSubPointId
  );

  const [lastScannedProduct, setLastScannedProduct] = useState<ConsumptionRecord | null>(null);
  const [lastScannedDeviceGroupImage, setLastScannedDeviceGroupImage] = useState<string | null>(null);
  const [lastScannedLotRemaining, setLastScannedLotRemaining] = useState<number | null>(null);
  const [lastScannedTotalRemaining, setLastScannedTotalRemaining] = useState<number | null>(null);
  const [stockWarnings, setStockWarnings] = useState<Array<{
    stokKodu: string;
    stokAdi: string;
    lotNumarasi?: string;
    totalRemaining: number;
    minStock: number | null;
    maxStock: number | null;
    reasons: string[];
  }>>([]);
  const [sessionHistory, setSessionHistory] = useState<ConsumptionRecord[]>([]);
  const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  
  const [isExpiryWarningModalOpen, setIsExpiryWarningModalOpen] = useState(false);
  const [lotReplaceTarget, setLotReplaceTarget] = useState<{ scanned: DepoStokItem, recommended: DepoStokItem } | null>(null);
  
  const selectedLab = useMemo(() => laboratories.find(l => l.id === selectedLabId) || null, [laboratories, selectedLabId]);
  
  const [faultModalOpen, setFaultModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [faultTargetMode, setFaultTargetMode] = useState<'single' | 'global'>('single');
  const [faultDescription, setFaultDescription] = useState('');
  const [isSavingFault, setIsSavingFault] = useState(false);
  const [faultDefinitions, setFaultDefinitions] = useState<FaultDefinition[]>([]);

  // Fault confirmation states
  const [confirmFaultOpen, setConfirmFaultOpen] = useState(false);
  const [selectedFaultToConfirm, setSelectedFaultToConfirm] = useState<FaultDefinition | null>(null);

  // Custom "Diğer" fault modal states
  const [customFaultModalOpen, setCustomFaultModalOpen] = useState(false);
  const [customFaultType, setCustomFaultType] = useState<'teknik_servis' | 'aplikasyon'>('teknik_servis');
  const [customFaultTitle, setCustomFaultTitle] = useState('');
  const [customFaultDescription, setCustomFaultDescription] = useState('');
  
  const [isManualDeductionOpen, setIsManualDeductionOpen] = useState(false);
  const [manualProductCode, setManualProductCode] = useState('');
  const [manualLotKey, setManualLotKey] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [mainUnitModels, setMainUnitModels] = useState<Record<string, string>>({});
  const [visualSearchQuery, setVisualSearchQuery] = useState('');
  const [selectedLabGroup, setSelectedLabGroup] = useState<string | null>(null);
  const [visualDeductionQuantities, setVisualDeductionQuantities] = useState<Record<string, number>>({});

  const [isPeripheralModalOpen, setIsPeripheralModalOpen] = useState(false);
  const [peripheralResponsibleUsers, setPeripheralResponsibleUsers] = useState<any[]>([]);

  // Trash bin modal states
  const [isTrashBinModalOpen, setIsTrashBinModalOpen] = useState(false);
  const [selectedTrashDevice, setSelectedTrashDevice] = useState<Device | null>(null);
  const [trashItems, setTrashItems] = useState<Array<{
    id: string;
    productCode: string;
    productName: string;
    remainingTests: number;
  }>>([]);
  const [selectedTrashProduct, setSelectedTrashProduct] = useState('');
  const [trashRemainingTests, setTrashRemainingTests] = useState<number>(0);
  const [trashProductSearch, setTrashProductSearch] = useState('');
  const [isTrashProductPopoverOpen, setIsTrashProductPopoverOpen] = useState(false);

  useEffect(() => {
    const handleOpenFaultModal = (event: CustomEvent<Device>) => {
      setFaultTargetMode('single');
      setSelectedDevice(event.detail);
      setFaultDescription((event.detail as any).arizaAciklamasi || '');
      setFaultModalOpen(true);
    };

    window.addEventListener('openDeviceFaultModal', handleOpenFaultModal as EventListener);
    return () => {
      window.removeEventListener('openDeviceFaultModal', handleOpenFaultModal as EventListener);
    };
  }, []);

  useEffect(() => {
    const fetchMainUnitModels = async () => {
      try {
        const snap = await getDocs(collection(db, 'def_mainUnits'));
        const modelMap: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data?.name && data?.modelSvg) {
            modelMap[String(data.name).trim().toLocaleLowerCase('tr')] = data.modelSvg;
          }
        });
        setMainUnitModels(modelMap);
      } catch (error) {
        urunKullanimLogger.warn('Ana birim 3D modelleri yüklenemedi', { error: (error as any)?.message });
      }
    };
    fetchMainUnitModels();
  }, []);


  // Fetch device groups (small collection, rarely changes)
  useEffect(() => {
    const fetchDeviceGroups = async () => {
      try {
        const dgsnap = await getDocs(collection(db, 'def_deviceGroups'));
        setDeviceGroups(dgsnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup)));
        urunKullanimLogger.debug('Cihaz grupları yüklendi', { count: dgsnap.docs.length });
      } catch (e) {
        urunKullanimLogger.error('Cihaz grupları yüklenemedi', e);
        toast({title: 'Hata', description: 'Cihaz grupları yüklenemedi.', variant: 'destructive'});
      }
    };
    fetchDeviceGroups();
  }, [toast]);

  // Fetch fault definitions for fault modal
  useEffect(() => {
    const fetchFaultDefinitions = async () => {
      try {
        const snap = await getDocs(collection(db, 'faultDefinitions'));
        const definitions = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
        })) as FaultDefinition[];
        setFaultDefinitions(definitions);
        urunKullanimLogger.debug('Arıza tanımlamaları yüklendi', { count: definitions.length });
      } catch (e) {
        urunKullanimLogger.error('Arıza tanımlamaları yüklenemedi', e);
      }
    };
    fetchFaultDefinitions();
  }, []);

  // Compute productTracking and productNames from products (useMemo instead of useEffect+state)
  const { productTracking, productNames } = useMemo(() => {
    const t: Record<string, TrackingMode> = {};
    const names: Record<string, string> = {};
    products.forEach(p => {
      if (p.stokKodu) {
        names[p.stokKodu] = p.stokAdi || p.stokKodu;
        if ((p as any).trackingMode) t[p.stokKodu] = (p as any).trackingMode as TrackingMode;
      }
    });
    return { productTracking: t, productNames: names };
  }, [products]);

  // REMOVED: Listeners for ALL laboratories' subPoints - was causing N listeners!
  // Now using useSubPoints(selectedLabId) which only fetches for selected lab

  const assignedLaboratories = useMemo(() => {
    const allLabs = laboratories.filter(l => !l.isConsumablesHospital); 
    if (currentUserProfile?.role === 'admin') return allLabs;
    if (currentUserProfile?.assignedLaboratories && currentUserProfile.assignedLaboratories.length > 0) {
      return allLabs.filter(h => currentUserProfile?.assignedLaboratories?.includes(h.id));
    }
    return [];
  }, [currentUserProfile, laboratories]);

  // Auto-select lab: for teknisyen use lastSelectedLabId, otherwise use first assigned lab if only one
  useEffect(() => {
    if (selectedLabId) return; // Already selected

    // For teknisyen users, use lastSelectedLabId from profile
    if (currentUserProfile?.role === 'teknisyen' && currentUserProfile.lastSelectedLabId) {
      onHospitalSelect(currentUserProfile.lastSelectedLabId);
      return;
    }

    // For other users, auto-select if only one lab assigned
    if (assignedLaboratories.length === 1) {
      onHospitalSelect(assignedLaboratories[0].id);
    }
  }, [assignedLaboratories, selectedLabId, onHospitalSelect, currentUserProfile]);

  // Save last selected lab to Firestore for teknisyen users
  useEffect(() => {
    if (
      currentUserProfile?.role === 'teknisyen' &&
      currentUser?.uid &&
      selectedLabId &&
      !currentUser.isAnonymous
    ) {
      const userDocRef = doc(db, 'users', currentUser.uid);
      updateDoc(userDocRef, { lastSelectedLabId: selectedLabId }).catch((err) => {
        urunKullanimLogger.warn('lastSelectedLabId kaydedilemedi', { error: err?.message });
      });
    }
  }, [selectedLabId, currentUserProfile?.role, currentUser]);

  const selectedLabName = laboratories.find(h => h.id === selectedLabId)?.name || '';
  const selectedSubPoint = useMemo(
    () => selectedLabSubPoints.find(sp => sp.id === selectedSubPointId),
    [selectedLabSubPoints, selectedSubPointId]
  );

  // Compute pool member IDs and names for lab stock
  const { poolMemberIds, poolMemberNames } = useMemo(() => {
    const pool = labPools.find(p => p.memberIds.includes(selectedLabId));
    const ids = pool?.memberIds || (selectedLabId ? [selectedLabId] : []);
    // Get names for legacy record support
    const names = ids.map(id => laboratories.find(l => l.id === id)?.name).filter((n): n is string => !!n);
    return { poolMemberIds: ids, poolMemberNames: names };
  }, [labPools, selectedLabId, laboratories]);

  // Use TanStack Query for lab stock - much more efficient than full depoStok
  // Now also passes lab names to support legacy records without hedefKurumId
  // Wait for labPools to load before querying to ensure pool members are included
  const { data: labStock = [] } = useLabStock(poolMemberIds, poolMemberNames, {
    enabled: !labPoolsLoading && poolMemberIds.length > 0
  });

  // Use TanStack Query for recent consumption (for duplicate check)
  const { data: tuketimKayitlari = [] } = useRecentConsumption(200);

  const devicesToDisplay = useMemo(() => {
    if (!selectedLabId || !devices) return [];
    return devices
      .filter(d => {
        const deviceLabId = d.hospitalId || (d as any).hastaneId;
        return deviceLabId?.toString() === selectedLabId.toString();
      })
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }, [devices, selectedLabId]);

  const recordConsumption = useCallback(async (itemToConsume: DepoStokItem) => {
    if (!selectedLab) {
      urunKullanimLogger.error('recordConsumption: Lab seçilmemiş');
      return null;
    }

    const ownerId = itemToConsume.hedefKurumId || laboratories.find(l => l.name === itemToConsume.hedefKurum)?.id || selectedLab.id;
    const ownerName = laboratories.find(l => l.id === ownerId)?.name || itemToConsume.hedefKurum || selectedLab.name || '';

    const newTuketimDocRef = doc(collection(db, 'tuketimKayitlari'));

    const newRec: Omit<ConsumptionRecord, 'id'> & {
      usageLabId: string; usageLabName: string;
      deductedFromLabId: string; deductedFromLabName: string;
    } = {
      stokKodu: itemToConsume.stokKodu,
      stokAdi: itemToConsume.stokAdi,
      lotNumarasi: itemToConsume.lotNumarasi || '',
      miad: itemToConsume.miad ?? '',
      seriNumarasi: itemToConsume.seriNumarasi || '',
      laboratoryId: selectedLab.id,
      laboratoryName: selectedLab.name || '',
      usageLabId: selectedLab.id,
      usageLabName: selectedLab.name || '',
      deductedFromLabId: ownerId,
      deductedFromLabName: ownerName,
      consumptionTimestamp: Timestamp.now(),
      userId: currentUserProfile?.uid || '',
      userName: currentUserProfile?.name || currentUserProfile?.email || '—',
      consumptionType: 'normal_kullanim',
      rafAdresi: (itemToConsume as any).rafAdresi || '',
      irsaliyeNumarasi: (itemToConsume as any).irsaliyeNumarasi || '',
      subPointId: selectedSubPoint?.id || '',
      subPointName: selectedSubPoint?.name || '',
    };

    const depoStokDocRef = doc(db, 'depoStok', itemToConsume.id);

    urunKullanimLogger.info('Tüketim kaydı başlatılıyor', {
      stokKodu: itemToConsume.stokKodu,
      seriNumarasi: itemToConsume.seriNumarasi,
      itemId: itemToConsume.id,
      usageLabId: selectedLab.id,
      deductedFromLabId: ownerId
    });

    const batch = writeBatch(db);
    batch.set(newTuketimDocRef, newRec);
    
    const currentAdet = itemToConsume.adet ?? 1;
    if (currentAdet > 1) {
      // OPTIMIZED: If bulk document, just decrement quantity
      batch.update(depoStokDocRef, { adet: currentAdet - 1 });
    } else {
      // Single item or last unit, delete doc
      batch.delete(depoStokDocRef);
    }

    // --- OPTIMISTIC UI START ---
    // 1. Immediately provide visual/audio feedback
    setScanStatus('success');
    playFeedback();
    
    // 2. Update local session history immediately
    const optimisticRecord = { 
      ...newRec, 
      id: newTuketimDocRef.id, 
      consumptionTimestamp: new Date() 
    };
    setLastScannedProduct(optimisticRecord as any);
    setSessionHistory(prev => [optimisticRecord, ...prev].slice(0, 10));

    // 3. Compute and update remaining counts optimistically
    const consumedId = itemToConsume.id;
    const consumedStokKodu = itemToConsume.stokKodu;
    const consumedLot = itemToConsume.lotNumarasi || '';
    
    // Use local labStock to update UI immediately. Lot-tracked items live in a
    // single doc with `adet: N`, so we sum adet rather than counting docs and
    // subtract the 1 unit we just consumed.
    const lotTotalAdet = labStock
      .filter(i => i.stokKodu === consumedStokKodu && (i.lotNumarasi || '') === consumedLot)
      .reduce((sum, i) => sum + (((i as any).adet as number | undefined) ?? 1), 0);
    const codeTotalAdet = labStock
      .filter(i => i.stokKodu === consumedStokKodu)
      .reduce((sum, i) => sum + (((i as any).adet as number | undefined) ?? 1), 0);
    const lotRemaining = Math.max(0, lotTotalAdet - 1);
    const totalRemaining = Math.max(0, codeTotalAdet - 1);
    
    setLastScannedLotRemaining(lotRemaining);
    setLastScannedTotalRemaining(totalRemaining);

    // Update image
    setLastScannedDeviceGroupImage(null);
    const productInfo = products.find(p => p.stokKodu === itemToConsume.stokKodu);
    const imageUrl = productInfo?.cihazGrubu ? deviceGroups.find(dg => dg.name === productInfo.cihazGrubu)?.imageUrl || null : null;
    setLastScannedDeviceGroupImage(imageUrl);

    toast({ 
      title: "Başarılı", 
      description: `${itemToConsume.seriNumarasi || itemToConsume.stokKodu} stoğundan düşüldü.` 
    });

    // Reset status after a delay
    setTimeout(() => setScanStatus('idle'), 3000);

    // --- BACKGROUND PROCESS ---
    (async () => {
      // Capture state for rollback
      const prevHistory = [...sessionHistory];
      const prevProduct = lastScannedProduct;
      const prevLotRem = lastScannedLotRemaining;
      const prevTotalRem = lastScannedTotalRemaining;
      const prevImage = lastScannedDeviceGroupImage;

      try {
        await batch.commit();

        urunKullanimLogger.info('Tüketim kaydı başarıyla yazıldı (Arka Plan)', {
          consumptionId: newTuketimDocRef.id,
          stokKodu: itemToConsume.stokKodu,
        });

        // Invalidate caches in background
        invalidateDepoStok();
        invalidateConsumption();

        // Stats update
        incrementTodayStats(selectedLab.id).catch(() => undefined);
        
        // Serial history
        logSerialHistory(itemToConsume.seriNumarasi || '', 'consumption', {
          stokKodu: itemToConsume.stokKodu,
          usageLabId: selectedLab.id,
          deductedFromLabId: ownerId,
          subPointId: selectedSubPoint?.id || '',
          subPointName: selectedSubPoint?.name || '',
        }).catch(() => undefined);

        // Cleanup snapshots if lot is empty
        if (lotRemaining === 0) {
          const miadRaw = String(itemToConsume.miad || '');
          const snapshotKey = buildManualDeductionKey(selectedLab.id, consumedStokKodu, consumedLot, miadRaw);
          deleteDoc(doc(db, 'labManualSerialSnapshots', snapshotKey)).catch(() => undefined);
        }
      } catch (err: any) {
        urunKullanimLogger.error('Tüketim kaydı yazılamadı (Rollback Uygulanıyor)', err);
        
        // --- ROLLBACK STATE ---
        setSessionHistory(prevHistory);
        setLastScannedProduct(prevProduct);
        setLastScannedLotRemaining(prevLotRem);
        setLastScannedTotalRemaining(prevTotalRem);
        setLastScannedDeviceGroupImage(prevImage);
        
        // Feedback
        setScanStatus('error');
        playFeedback(true); // Distinct error sound

        toast({ 
          title: "Kayıt Başarısız (Geri Alındı)", 
          description: "Stok güncellenirken bir sorun oluştu. Ürün başka bir kullanıcı tarafından düşülmüş olabilir.", 
          variant: 'destructive' 
        });

        setTimeout(() => setScanStatus('idle'), 3000);
      }
    })();

    return newTuketimDocRef.id;
  }, [currentUserProfile, selectedLab, laboratories, toast, selectedSubPoint, products, deviceGroups, invalidateDepoStok, invalidateConsumption, labStock, minMaxRules]);
  
  const pickEarliest = (items: DepoStokItem[]) => {
    return items
      .map(i => ({ item: i, d: parseDate(i.miad ?? '', 'dd.MM.yyyy', new Date()) }))
      .sort((a, b) => compareAsc(a.d, b.d))[0]?.item;
  };

  const findBySerial = (stokKodu: string, seri: string) =>
    labStock.find(i => i.stokKodu === stokKodu && i.seriNumarasi === seri && i.isShipped);

  const findByLot = (stokKodu: string, lot: string) => {
    const pool = labStock.filter(i => i.stokKodu === stokKodu && i.lotNumarasi === lot && i.isShipped);
    return pickEarliest(pool);
  };

  const findByRefOnly = (stokKodu: string) => {
    const pool = labStock.filter(i => i.stokKodu === stokKodu && i.isShipped);
    return pickEarliest(pool);
  };

  /**
   * Firestore'dan direkt stok kontrolü - cache'e güvenilmez durumlar için
   * Cache stale olduğunda real-time verification yapar
   */
  const verifyStockInFirestore = useCallback(async (
    stokKodu: string,
    seri?: string,
    lot?: string
  ): Promise<DepoStokItem | null> => {
    try {
      urunKullanimLogger.debug('Firestore\'dan stok doğrulaması yapılıyor', { stokKodu, seri, lot });

      // Build query based on tracking mode
      let q;
      if (seri) {
        // Serial tracking - exact match
        q = query(
          collection(db, 'depoStok'),
          where('hedefKurumId', 'in', poolMemberIds),
          where('isShipped', '==', true),
          where('stokKodu', '==', stokKodu),
          where('seriNumarasi', '==', seri)
        );
      } else if (lot) {
        // Lot tracking - find earliest expiry
        q = query(
          collection(db, 'depoStok'),
          where('hedefKurumId', 'in', poolMemberIds),
          where('isShipped', '==', true),
          where('stokKodu', '==', stokKodu),
          where('lotNumarasi', '==', lot)
        );
      } else {
        // Ref-only tracking - find earliest expiry
        q = query(
          collection(db, 'depoStok'),
          where('hedefKurumId', 'in', poolMemberIds),
          where('isShipped', '==', true),
          where('stokKodu', '==', stokKodu)
        );
      }

      const snap = await getDocs(q);

      if (snap.empty) {
        // Also check legacy records without hedefKurumId
        const legacyQuery = query(
          collection(db, 'depoStok'),
          where('hedefKurum', 'in', poolMemberNames),
          where('isShipped', '==', true),
          where('stokKodu', '==', stokKodu)
        );
        const legacySnap = await getDocs(legacyQuery);

        if (legacySnap.empty) {
          return null;
        }

        const items = filterByCompanyScope(
          legacySnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        );
        return seri
          ? items.find(i => i.seriNumarasi === seri) || null
          : pickEarliest(items);
      }

      const items = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      );
      return seri ? items[0] : pickEarliest(items);
    } catch (error) {
      urunKullanimLogger.error('Firestore stok doğrulama hatası', error, { stokKodu, seri, lot });
      return null;
    }
  }, [poolMemberIds, poolMemberNames, currentCompanyId, isSuperAdmin]);

  /**
   * Firestore'dan direkt duplicate kontrolü - cache'e güvenilmez durumlar için
   * Son 5 dakikadaki tüketimleri sorgular
   */
  const checkRecentConsumption = useCallback(async (
    stokKodu: string,
    seriNumarasi: string
  ): Promise<boolean> => {
    try {
      if (!seriNumarasi) return false;

      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

      const q = query(
        collection(db, 'tuketimKayitlari'),
        where('stokKodu', '==', stokKodu),
        where('seriNumarasi', '==', seriNumarasi),
        where('consumptionTimestamp', '>=', Timestamp.fromDate(fiveMinutesAgo))
      );

      const snap = await getDocs(q);
      return !snap.empty;
    } catch (error) {
      urunKullanimLogger.error('Duplicate kontrol hatası', error, { stokKodu, seriNumarasi });
      // On error, be conservative - don't block consumption
      return false;
    }
  }, []);

  const consumeByParsed = useCallback(async (rawInput: string) => {
    if (!selectedLabId) {
      toast({ title: 'Hata', description: 'Lütfen kullanım yapılacak laboratuvarı seçin.', variant: 'destructive' });
      return;
    }

    const candidate = sanitizeGS1(rawInput) || rawInput;
    const resolveResult = parseAndResolveBarcode(candidate, barcodeFormats, products);

    if (!resolveResult || !resolveResult.parsed) {
      toast({ title: 'Barkod Ayrıştırma Hatası', description: 'Tanımlı formatlarla eşleşmedi.', variant: 'destructive' });
      return;
    }

    const resolved = resolveResult.parsed;
    if (!resolveResult.product || !resolved.stokKodu) {
      toast({ title: 'Ürün Bulunamadı', description: 'Barkoddan bir ürün çözümlenemedi.', variant: 'destructive' });
      return;
    }

    const stokKodu = resolved.stokKodu!;
    const lot = resolved.lotNumarasi || '';
    const seri = resolved.seriNumarasi || '';

    // Determine tracking mode based on what the barcode contains
    const matchedFormat = resolved.matchedFormatId
      ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
      : undefined;
    const mode = resolveEffectiveTrackingMode(resolved, matchedFormat, resolveResult.product as any);

    let item: DepoStokItem | undefined;

    // STEP 1: Try to find item in cache first (fast path)
    if (mode === 'serial') {
        if (!seri) {
          toast({ title: 'Ayrıştırma Hatası', description: `${stokKodu} seri takipli, ancak barkod seri no içermiyor.`, variant: 'destructive' });
          return;
        }
        item = findBySerial(stokKodu, seri);

        // DEFENSIVE: If not found in cache, verify in Firestore before rejecting
        if (!item) {
          urunKullanimLogger.info('Cache\'de bulunamadı, Firestore\'dan doğrulanıyor', { stokKodu, seri });
          toast({ title: 'Doğrulanıyor...', description: 'Stok durumu kontrol ediliyor.' });

          item = await verifyStockInFirestore(stokKodu, seri);

          if (!item) {
            toast({ title: 'Stokta Yok', description: `Seri No ${seri} bu laboratuvar stoğunda bulunamadı. Lütfen stok transferini kontrol edin.`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            // Force cache refresh for next scan
            invalidateDepoStok();
            return;
          }

          urunKullanimLogger.info('Firestore\'dan bulundu, cache güncellenecek', { itemId: item.id });
          toast({ title: 'Bulundu', description: 'Stok doğrulandı, işlem devam ediyor.' });
        }
    } else if (mode === 'lot_barcode') {
        if (!lot) {
          toast({ title: 'Ayrıştırma Hatası', description: `${stokKodu} lot takipli, ancak barkod lot içermiyor.`, variant: 'destructive' });
          return;
        }
        item = findByLot(stokKodu, lot);

        if (!item) {
          urunKullanimLogger.info('Cache\'de bulunamadı, Firestore\'dan doğrulanıyor', { stokKodu, lot });
          toast({ title: 'Doğrulanıyor...', description: 'Stok durumu kontrol ediliyor.' });

          item = await verifyStockInFirestore(stokKodu, undefined, lot);

          if (!item) {
            toast({ title: 'Stokta Yok', description: `${stokKodu} (Lot: ${lot}) bu laboratuvar stoğunda bulunamadı.`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            invalidateDepoStok();
            return;
          }

          urunKullanimLogger.info('Firestore\'dan bulundu', { itemId: item.id });
          toast({ title: 'Bulundu', description: 'Stok doğrulandı, işlem devam ediyor.' });
        }
    } else {
        item = findByRefOnly(stokKodu);

        if (!item) {
          urunKullanimLogger.info('Cache\'de bulunamadı, Firestore\'dan doğrulanıyor', { stokKodu });
          toast({ title: 'Doğrulanıyor...', description: 'Stok durumu kontrol ediliyor.' });

          item = await verifyStockInFirestore(stokKodu);

          if (!item) {
            toast({ title: 'Stokta Yok', description: `${stokKodu} bu laboratuvar stoğunda bulunamadı.`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            invalidateDepoStok();
            return;
          }

          urunKullanimLogger.info('Firestore\'dan bulundu', { itemId: item.id });
          toast({ title: 'Bulundu', description: 'Stok doğrulandı, işlem devam ediyor.' });
        }
    }

    // STEP 2: Duplicate check - use Firestore for recent consumption (more reliable than cache)
    if (item.irsaliyeNumarasi !== 'İSTİSNA GİRİŞİ' && item.seriNumarasi) {
        // First check cache (fast). NOT: Aynı seri farklı ürünlere tanımlı
        // olabildiği için stokKodu da karşılaştırılıyor. Bu kontrol yanlış
        // pozitif veriyorsa `matched` log'unda mismatch görünecek.
        const matched = tuketimKayitlari.find(c => c.stokKodu === stokKodu && c.seriNumarasi === item!.seriNumarasi);
        const cachedDuplicate = !!matched;

        if (cachedDuplicate) {
            urunKullanimLogger.warn('Cache mükerrer tüketim tespit edildi', {
              stokKodu,
              seriNumarasi: item.seriNumarasi,
              matchedRecord: matched ? {
                id: (matched as any).id,
                stokKodu: matched.stokKodu,
                seriNumarasi: matched.seriNumarasi,
                consumptionTimestamp: (matched as any).consumptionTimestamp?.toString?.() || (matched as any).consumptionTimestamp,
              } : null,
            });
            toast({ title: 'Zaten Tüketilmiş', description: `${stokKodu} - Seri No ${item.seriNumarasi} daha önce stoktan düşülmüş.`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            return;
        }

        // DEFENSIVE: Also check Firestore for recent consumption (last 5 min) to catch race conditions
        urunKullanimLogger.debug('Firestore\'dan duplicate kontrolü yapılıyor', { stokKodu, seri: item.seriNumarasi });
        const recentlyConsumed = await checkRecentConsumption(stokKodu, item.seriNumarasi);

        if (recentlyConsumed) {
            urunKullanimLogger.warn('Firestore duplicate tespit edildi', { stokKodu, seri: item.seriNumarasi });
            toast({ title: 'Zaten Tüketilmiş', description: `${stokKodu} - Seri No ${item.seriNumarasi} daha önce stoktan düşülmüş (son 5 dk).`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            // Refresh cache to reflect recent consumption
            invalidateConsumption();
            return;
        }
    }

    // STEP 3: Record consumption with retry on transient errors
    const MAX_RETRIES = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await recordConsumption(item!);
        if (result) {
          // Success!
          return;
        }
        // If recordConsumption returns null, it already handled the error
        return;
      } catch (error: any) {
        lastError = error;
        urunKullanimLogger.warn(`Tüketim kaydı denemesi ${attempt + 1}/${MAX_RETRIES + 1} başarısız`, error, {
          stokKodu,
          seriNumarasi: item.seriNumarasi,
          attempt: attempt + 1
        });

        // Check if it's a transient error (network, timeout)
        const isTransient = error?.code === 'unavailable' ||
                          error?.code === 'deadline-exceeded' ||
                          error?.message?.includes('network') ||
                          error?.message?.includes('timeout');

        if (!isTransient || attempt === MAX_RETRIES) {
          // Non-transient error or max retries reached
          break;
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }
    }

    // All retries failed
    urunKullanimLogger.error('Tüketim kaydı tüm denemelerden sonra başarısız', lastError, {
      stokKodu,
      seriNumarasi: item.seriNumarasi,
      maxRetries: MAX_RETRIES
    });

    setScanStatus('error');
    toast({
      title: 'Kayıt Hatası',
      description: 'Tüketim kaydedilemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.',
      variant: 'destructive'
    });
    playFeedback(true);
    setTimeout(() => setScanStatus('idle'), 3000);

  }, [selectedLabId, barcodeFormats, products, productTracking, labStock, toast, findBySerial, findByLot, findByRefOnly, recordConsumption, tuketimKayitlari, verifyStockInFirestore, checkRecentConsumption, invalidateDepoStok, invalidateConsumption]);
  
  const onProcess = useCallback((barcode: string) => {
    if (isExpiryWarningModalOpen && lotReplaceTarget) {
        const parsed = parseAnyBarcode(barcode, barcodeFormats);
        if (!parsed || !parsed.seriNumarasi) {
          toast({ title: 'Geçersiz Barkod', description: 'Barkod ayrıştırılamadı.', variant: 'destructive' });
          return;
        }
        if (parsed.lotNumarasi !== lotReplaceTarget.recommended.lotNumarasi) {
          toast({ title: 'Yanlış Lot', description: `Lütfen ${lotReplaceTarget.recommended.lotNumarasi} lotundan bir seri okutun.`, variant: 'destructive' });
          return;
        }
        // Use stokKodu from the recommended item to ensure we find the correct product
        const targetStokKodu = lotReplaceTarget.recommended.stokKodu;
        const newItem = findBySerial(targetStokKodu, parsed.seriNumarasi);
        if (!newItem) {
          toast({ title: 'Depoda Bulunamadı', description: 'Bu seri lotta bulunamadı.', variant: 'destructive' });
          return;
        }
        recordConsumption(newItem);
        setIsExpiryWarningModalOpen(false);
        setLotReplaceTarget(null);
        return;
    }
    consumeByParsed(barcode);
  }, [consumeByParsed, isExpiryWarningModalOpen, lotReplaceTarget, barcodeFormats, toast, findBySerial, recordConsumption]);
  
  useHidScanner({
    enabled: !isCameraScannerOpen && !isExpiryWarningModalOpen && !faultModalOpen && !isManualDeductionOpen,
    onScan: ({ raw }) => onProcess(raw)
  });

  const handleCameraScanSuccess = (rawCode: string) => {
    onProcess(rawCode);
    setIsCameraScannerOpen(false);
  };
  
  const safeName = useCallback(
    (code: string, fallback: string) => productNames[code] || fallback || code,
    [productNames]
  );

  // Separate fault definitions by type
  const teknikServisFaults = useMemo(() =>
    faultDefinitions.filter(f => f.type === 'teknik_servis').sort((a, b) => a.name.localeCompare(b.name)),
    [faultDefinitions]
  );

  const aplikasyonFaults = useMemo(() =>
    faultDefinitions.filter(f => f.type === 'aplikasyon').sort((a, b) => a.name.localeCompare(b.name)),
    [faultDefinitions]
  );

  const handleOpenGlobalStopModal = useCallback(() => {
    setFaultTargetMode('global');
    setSelectedDevice(null);
    setFaultDescription('');
    setFaultModalOpen(true);
  }, []);

  const handleFaultReport = useCallback((faultDefinition: FaultDefinition) => {
    setSelectedFaultToConfirm(faultDefinition);
    setConfirmFaultOpen(true);
  }, []);

  const handleFaultOpened = useCallback(async (faultType: 'teknik_servis' | 'aplikasyon') => {
    if (selectedLab?.perifer && selectedLabId) {
      try {
        const q = query(collection(db, 'users'), where('primaryLaboratories', 'array-contains', selectedLabId));
        const snap = await getDocs(q);
        const allResponsible = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        const filtered = allResponsible.filter((u: any) => u.role === faultType);
        setPeripheralResponsibleUsers(filtered);
        setIsPeripheralModalOpen(true);
      } catch (err) {
        urunKullanimLogger.error('Sorumlu personel getirilemedi', err);
      }
    }
  }, [selectedLab, selectedLabId, selectedLabName]);

  const handleConfirmFaultReport = useCallback(async () => {
    if (!selectedFaultToConfirm || !selectedDevice) return;
    setIsSavingFault(true);
    try {
      await openDeviceFaultReport({
        hospitalId: selectedLabId ?? '',
        labName: selectedLabName ?? '',
        deviceId: selectedDevice.id,
        model: selectedDevice.cihazAdi || selectedDevice.name || '',
        serial: selectedDevice.seriNumarasi || '',
        faultType: selectedFaultToConfirm.type,
        openedByUid: currentUser?.uid || '',
        openedByName: currentUserProfile?.name || '',
        openDescription: faultDescription || selectedFaultToConfirm.name,
        faultDefinitionId: selectedFaultToConfirm.id,
        faultName: selectedFaultToConfirm.name,
        deviceImageUrl: selectedDevice.imageUrl || undefined,
        companyId: currentUserProfile?.companyId ?? null,
      });

      urunKullanimLogger.info('Arıza kaydı oluşturuldu', {
        deviceId: selectedDevice.id,
        deviceName: selectedDevice.cihazAdi,
        faultType: selectedFaultToConfirm.type,
        faultName: selectedFaultToConfirm.name,
      });
      toast({ title: 'Arıza Kaydı Oluşturuldu', description: `${selectedDevice.cihazAdi} için "${selectedFaultToConfirm.name}" arızası bildirildi.` });
      setFaultModalOpen(false);
      setFaultDescription('');
      setSelectedDevice(null);
      setConfirmFaultOpen(false);
      setSelectedFaultToConfirm(null);

      // Peripheral check
      handleFaultOpened(selectedFaultToConfirm.type);
    } catch (err) {
      urunKullanimLogger.error('Arıza kaydı oluşturulamadı', err, {
        deviceId: selectedDevice?.id,
        faultType: selectedFaultToConfirm.type,
        faultName: selectedFaultToConfirm.name,
      });
      toast({ title: 'Hata', description: 'Arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingFault(false);
    }
  }, [selectedFaultToConfirm, selectedDevice, faultDescription, currentUser, currentUserProfile, selectedLabId, selectedLabName, toast]);

  // Handler to open custom fault modal
  const handleOpenCustomFault = useCallback((type: 'teknik_servis' | 'aplikasyon') => {
    setCustomFaultType(type);
    setCustomFaultTitle('');
    setCustomFaultDescription('');
    setCustomFaultModalOpen(true);
  }, []);

  // Handler to submit custom fault
  const handleCustomFaultSubmit = useCallback(async () => {
    if (!selectedDevice || !customFaultTitle.trim() || !customFaultDescription.trim()) return;
    setIsSavingFault(true);
    try {
      await openDeviceFaultReport({
        hospitalId: selectedLabId ?? '',
        labName: selectedLabName ?? '',
        deviceId: selectedDevice.id,
        model: selectedDevice.cihazAdi || selectedDevice.name || '',
        serial: selectedDevice.seriNumarasi || '',
        faultType: customFaultType,
        openedByUid: currentUser?.uid || '',
        openedByName: currentUserProfile?.name || '',
        openDescription: customFaultDescription,
        title: customFaultTitle.trim(),
        faultDefinitionId: undefined,
        faultName: customFaultTitle.trim(),
        deviceImageUrl: selectedDevice.imageUrl || undefined,
        companyId: currentUserProfile?.companyId ?? null,
      });

      urunKullanimLogger.info('Özel arıza kaydı oluşturuldu', {
        deviceId: selectedDevice.id,
        deviceName: selectedDevice.cihazAdi,
        faultType: customFaultType,
        faultName: customFaultTitle,
      });
      toast({ title: 'Arıza Kaydı Oluşturuldu', description: `${selectedDevice.cihazAdi} için "${customFaultTitle}" arızası bildirildi.` });
      setCustomFaultModalOpen(false);
      setFaultModalOpen(false);
      setCustomFaultTitle('');
      setCustomFaultDescription('');
      setSelectedDevice(null);

      // Peripheral check
      handleFaultOpened(customFaultType);
    } catch (err) {
      urunKullanimLogger.error('Özel arıza kaydı oluşturulamadı', err, {
        deviceId: selectedDevice?.id,
        faultType: customFaultType,
        faultName: customFaultTitle,
      });
      toast({ title: 'Hata', description: 'Arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingFault(false);
    }
  }, [selectedDevice, customFaultType, customFaultTitle, customFaultDescription, currentUser, currentUserProfile, selectedLabId, selectedLabName, toast]);

  const handleStopFaultReport = useCallback(async (stopLevel: 'E STOP' | 'S STOP' | 'NORMAL STOP') => {
    if (!selectedLabId || !selectedLabName) return;

    const isGlobalStop = faultTargetMode === 'global';
    const targetDeviceIds = isGlobalStop
      ? devicesToDisplay.map((d) => d.id).filter(Boolean)
      : (selectedDevice?.id ? [selectedDevice.id] : []);

    if (targetDeviceIds.length === 0) {
      toast({ title: 'Cihaz Bulunamadı', description: 'Arıza kaydı açmak için en az bir cihaz gerekli.', variant: 'destructive' });
      return;
    }

    setIsSavingFault(true);
    try {
      await openDeviceFaultReport({
        hospitalId: selectedLabId,
        labName: selectedLabName,
        deviceId: isGlobalStop ? targetDeviceIds[0] : (selectedDevice?.id || ''),
        model: isGlobalStop ? 'KOMPLE STOP' : (selectedDevice?.cihazAdi || selectedDevice?.name || 'Cihaz'),
        serial: isGlobalStop ? '-' : (selectedDevice?.seriNumarasi || ''),
        faultType: 'teknik_servis',
        openedByUid: currentUser?.uid || '',
        openedByName: currentUserProfile?.name || '',
        openDescription: `${stopLevel} - ${isGlobalStop ? 'KOMPLE STOP' : 'Cihaz STOP'} (Tüm personel bilgilendirildi)`,
        title: `${stopLevel} • ${isGlobalStop ? 'KOMPLE STOP' : (selectedDevice?.cihazAdi || 'Cihaz')}`,
        faultName: stopLevel,
        deviceImageUrl: selectedDevice?.imageUrl || undefined,
        companyId: currentUserProfile?.companyId ?? null,
        affectsAllDevices: isGlobalStop,
        affectedDeviceIds: targetDeviceIds,
        stopLevel,
        notifyAllPersonnel: true,
      });

      toast({
        title: 'Arıza Kaydı Oluşturuldu',
        description: isGlobalStop
          ? `${stopLevel} arızası KOMPLE STOP olarak açıldı. Tüm cihazlar etkilendi.`
          : `${selectedDevice?.cihazAdi || 'Cihaz'} için ${stopLevel} arızası açıldı.`,
      });
      setFaultModalOpen(false);
      setSelectedDevice(null);
      setFaultTargetMode('single');

      // Peripheral check
      handleFaultOpened('teknik_servis');
    } catch (err) {
      urunKullanimLogger.error('STOP arıza kaydı oluşturulamadı', err, { stopLevel, mode: faultTargetMode });
      toast({ title: 'Hata', description: 'STOP arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingFault(false);
    }
  }, [selectedLabId, selectedLabName, faultTargetMode, devicesToDisplay, selectedDevice, currentUser, currentUserProfile, toast]);

  const manualDeductionAvailableProducts = useMemo(() => {
    return Array.from(new Set(labStock.map(item => item.stokKodu)))
        .map(code => products.find(p => p.stokKodu === code))
        .filter((p): p is ProductCode => !!p)
        .sort((a,b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));
  }, [labStock, products]);
  
  const manualDeductionLotOptions = useMemo(() => {
    if (!manualProductCode) return [];
    const lots = new Map<string, { miad: string; count: number }>();
    labStock
      .filter(item => item.stokKodu === manualProductCode)
      .forEach(item => {
        const key = `${item.lotNumarasi || 'N/A'}|${item.miad || 'N/A'}`;
        const current = lots.get(key) || { miad: item.miad ?? 'N/A', count: 0 };
        // Sum adet — lot batches transferred from depot live in a single doc.
        current.count += resolveStockRowUnit(item);
        lots.set(key, current);
      });
    return Array.from(lots.entries()).map(([key, data]) => ({ key, label: `${key.split('|')[0]} / ${data.miad}`, count: data.count }));
  }, [labStock, manualProductCode]);

  const listDeductionItems = useMemo(() => {
    if (!selectedLab?.visualDeductionEnabled) return [];
    const grouped = new Map<string, {
      stokKodu: string;
      stokAdi: string;
      lotNumarasi: string;
      miad: string;
      miadRaw: string;
      count: number;
      availableCount: number;
      anaBirim: string;
      laboratuvarGrubu: string;
      groupKey: string;
    }>();

    labStock.forEach((item) => {
      const product = products.find((p) => p.stokKodu === item.stokKodu);
      const anaBirim = String(product?.anaBirim || 'Adet');
      const lotNumarasi = item.lotNumarasi || 'Lotsuz';
      const miadStr = formatMiad(item.miad);
      const miadRaw = String(item.miad || '');
      const key = `${item.stokKodu}__${lotNumarasi}__${miadStr}`;
      const labGrubu = product?.laboratuvarGrubu || 'Diğer';
      const groupKey = buildManualDeductionKey(selectedLabId, item.stokKodu, item.lotNumarasi || '', miadRaw);

      const existing = grouped.get(key) || {
        stokKodu: item.stokKodu,
        stokAdi: product?.stokAdi || item.stokAdi || item.stokKodu,
        lotNumarasi,
        miad: miadStr,
        miadRaw,
        count: 0,
        availableCount: 0,
        anaBirim,
        laboratuvarGrubu: labGrubu,
        groupKey,
      };
      existing.count += resolveStockRowUnit(item);
      grouped.set(key, existing);
    });

    return Array.from(grouped.values())
      .map((row) => {
        // Nihai adet canlı labStock belgelerinin `adet` toplamından türetilsin.
        // Lot dokümanları tek satırda `adet: N` taşır; doküman sayısı yanlış olur.
        const liveCount = labStock
          .filter((it) =>
            it.stokKodu === row.stokKodu &&
            (it.lotNumarasi || 'Lotsuz') === row.lotNumarasi &&
            formatMiad(it.miad) === row.miad
          )
          .reduce((sum, it) => sum + resolveStockRowUnit(it), 0);
        return { ...row, count: liveCount };
      })
      .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || '', 'tr') || (a.lotNumarasi || '').localeCompare(b.lotNumarasi || '', 'tr'));
  }, [labStock, products, selectedLab?.visualDeductionEnabled, selectedLabId]);

  const labGroupCategories = useMemo(() => {
    const cats = new Set(listDeductionItems.map(i => i.laboratuvarGrubu));
    return Array.from(cats).sort((a, b) => {
      if (a === 'Diğer') return 1;
      if (b === 'Diğer') return -1;
      return a.localeCompare(b, 'tr');
    });
  }, [listDeductionItems]);

  const filteredListDeductionItems = useMemo(() => {
    let items = listDeductionItems;
    if (selectedLabGroup) {
      items = items.filter(i => i.laboratuvarGrubu === selectedLabGroup);
    }
    const q = visualSearchQuery.trim().toLocaleLowerCase('tr');
    if (q) {
      items = items.filter((item) =>
        `${item.stokAdi} ${item.stokKodu} ${item.lotNumarasi}`.toLocaleLowerCase('tr').includes(q)
      );
    }
    return items;
  }, [listDeductionItems, selectedLabGroup, visualSearchQuery]);

  const handleVisualDeduction = useCallback(async (
    stokKodu: string,
    lotNumarasi: string,
    miad?: string,
    miadRaw?: string,
    requestedQuantity = 1
  ) => {
    if (!selectedLab) return;
    const normalizedRequestedQty = Math.max(1, Math.floor(requestedQuantity || 1));
    const matchingItems = labStock.filter((stockItem) => {
      const matchCode = stockItem.stokKodu === stokKodu;
      const matchLot = (stockItem.lotNumarasi || 'Lotsuz') === lotNumarasi;
      if (!miad) return matchCode && matchLot;
      return matchCode && matchLot && formatMiad(stockItem.miad) === miad;
    });
    if (!matchingItems.length) {
      toast({ title: 'Stok Bulunamadı', description: 'Bu lot için düşülecek stok kalmamış.', variant: 'destructive' });
      return;
    }

    const groupKey = buildManualDeductionKey(selectedLab.id, stokKodu, lotNumarasi === 'Lotsuz' ? '' : lotNumarasi, miadRaw || '');
    // Lot dokümanları tek satırda `adet: N` tutar — gerçek mevcut adet = adet toplamı.
    const currentlyAvailable = matchingItems.reduce((sum, it) => sum + resolveStockRowUnit(it), 0);
    if (currentlyAvailable <= 0) {
      toast({ title: 'Stok Bulunamadı', description: 'Bu satırın kullanılabilir stoğu tükenmiş görünüyor.', variant: 'destructive' });
      return;
    }
    const quantityToDeduct = Math.min(normalizedRequestedQty, currentlyAvailable);

    const templateItem = matchingItems[0];
    const ownerId = templateItem.hedefKurumId || laboratories.find(l => l.name === templateItem.hedefKurum)?.id || selectedLab.id;
    const ownerName = laboratories.find(l => l.id === ownerId)?.name || templateItem.hedefKurum || selectedLab.name || '';
    // Adet-aware düşüm planı: her doküman için ne kadar düşüleceği. Doküman
    // tamamı düşülürse silinir; kısmi düşümde `adet` decrement edilir. Eski
    // `batch.delete` mantığı `adet: 50` olan bir dokümanı 1 birim için tamamen
    // silerek 49 birim sessiz veri kaybına yol açıyordu.
    let remainingToDeduct = quantityToDeduct;
    const itemsToConsume: Array<{ id: string; take: number; docAdet: number; ref: DepoStokItem }> = [];
    for (const stockItem of matchingItems) {
      if (remainingToDeduct <= 0) break;
      const docAdet = resolveStockRowUnit(stockItem);
      const take = Math.min(docAdet, remainingToDeduct);
      itemsToConsume.push({ id: stockItem.id, take, docAdet, ref: stockItem });
      remainingToDeduct -= take;
    }
    const shouldFullyConsumeLot = quantityToDeduct >= currentlyAvailable;

    try {
      const batch = writeBatch(db);
      for (let i = 0; i < quantityToDeduct; i++) {
        const newTuketimDocRef = doc(collection(db, 'tuketimKayitlari'));
        const newRec = {
          stokKodu,
          stokAdi: templateItem.stokAdi,
          lotNumarasi: templateItem.lotNumarasi || '',
          miad: templateItem.miad ?? '',
          seriNumarasi: '',
          laboratoryId: selectedLab.id,
          laboratoryName: selectedLab.name || '',
          usageLabId: selectedLab.id,
          usageLabName: selectedLab.name || '',
          deductedFromLabId: ownerId,
          deductedFromLabName: ownerName,
          consumptionTimestamp: Timestamp.now(),
          userId: currentUserProfile?.uid || '',
          userName: currentUserProfile?.name || currentUserProfile?.email || '—',
          consumptionType: 'normal_kullanim',
          sourceType: 'manual_visual',
          rafAdresi: (templateItem as any).rafAdresi || '',
          irsaliyeNumarasi: (templateItem as any).irsaliyeNumarasi || '',
          subPointId: selectedSubPoint?.id || '',
          subPointName: selectedSubPoint?.name || '',
          quantity: 1,
        };
        batch.set(newTuketimDocRef, newRec);
      }

      // Adet-aware düşüm: tamamı düşülen doküman silinir; kısmi düşümde
      // `adet` decrement edilir. Böylece bir lot dokümanından 1 birim
      // düşerken kalan birimler kaybolmaz.
      itemsToConsume.forEach((plan) => {
        const stokRef = doc(db, 'depoStok', plan.id);
        if (plan.take >= plan.docAdet) {
          batch.delete(stokRef);
        } else {
          batch.update(stokRef, { adet: plan.docAdet - plan.take });
        }
      });

      // Seri takipli ürünlerde seri numaralarını arka planda sakla (stoktan sayılmasın)
      const trackingMode = resolveEffectiveTrackingMode(stokKodu, productTracking);
      if (trackingMode === 'serial') {
        const snapshotRef = doc(db, 'labManualSerialSnapshots', groupKey);
        const snapshotSnap = await getDoc(snapshotRef);
        const existingSerials = snapshotSnap.exists() ? ((snapshotSnap.data().serials || []) as string[]) : [];
        const allKnownSerials = Array.from(new Set([
          ...existingSerials,
          ...matchingItems.map(i => i.seriNumarasi).filter(Boolean) as string[],
        ]));

        if (shouldFullyConsumeLot) {
          // Lot tamamen bittiyse snapshot da temizlenir
          batch.delete(snapshotRef);
        } else {
          batch.set(snapshotRef, {
            groupKey,
            usageLabId: selectedLab.id,
            stokKodu,
            lotNumarasi: lotNumarasi === 'Lotsuz' ? '' : lotNumarasi,
            miadRaw: miadRaw || '',
            serials: allKnownSerials,
            updatedAt: Timestamp.now(),
          }, { merge: true });
        }
      }

      await batch.commit();

      // "Son Okutulan Ürün" ve "Son 10 Tüketim" kartlarını manuel/listeli düşümde de güncelle
      const remainingInSameLot = Math.max(0, currentlyAvailable - quantityToDeduct);
      // Lot dokümanları `adet: N` formatında — doküman saymak yerine adet topla.
      const totalForCode = labStock
        .filter((i) => i.stokKodu === stokKodu)
        .reduce((sum, i) => sum + resolveStockRowUnit(i), 0);
      const estimatedTotalRemaining = Math.max(0, totalForCode - quantityToDeduct);
      const manualRecordBase: ConsumptionRecord = {
        id: `manual-${Date.now()}`,
        stokKodu,
        stokAdi: templateItem.stokAdi || stokKodu,
        lotNumarasi: templateItem.lotNumarasi || '',
        miad: templateItem.miad ?? '',
        seriNumarasi: '',
        laboratoryId: selectedLab.id,
        laboratoryName: selectedLab.name || '',
        consumptionTimestamp: new Date(),
        userId: currentUserProfile?.uid || '',
        userName: currentUserProfile?.name || currentUserProfile?.email || '—',
        consumptionType: 'normal_kullanim',
        subPointId: selectedSubPoint?.id || '',
        subPointName: selectedSubPoint?.name || '',
      };

      setLastScannedProduct(manualRecordBase as any);
      setLastScannedLotRemaining(remainingInSameLot);
      setLastScannedTotalRemaining(estimatedTotalRemaining);
      setSessionHistory((prev) => {
        const now = Date.now();
        const added = Array.from({ length: quantityToDeduct }, (_, idx) => ({
          ...manualRecordBase,
          id: `manual-${now}-${idx}`,
          consumptionTimestamp: new Date(now + idx),
        }));
        return [...added, ...prev].slice(0, 10);
      });

      setLastScannedDeviceGroupImage(null);
      setTimeout(() => {
        const productInfo = products.find(p => p.stokKodu === stokKodu);
        const imageUrl = productInfo?.cihazGrubu ? deviceGroups.find(dg => dg.name === productInfo.cihazGrubu)?.imageUrl || null : null;
        setLastScannedDeviceGroupImage(imageUrl);
      }, 50);

      setScanStatus('success');
      playFeedback();
      setTimeout(() => setScanStatus('idle'), 3000);
      invalidateDepoStok();
      invalidateConsumption();
      for (let i = 0; i < quantityToDeduct; i++) {
        incrementTodayStats(selectedLab.id).catch(() => undefined);
      }
      toast({
        title: 'Başarılı',
        description: `${quantityToDeduct} adet ürün stoktan düşüldü.`,
      });
    } catch {
      toast({ title: 'Hata', description: 'Listeli düşüm sırasında bir hata oluştu.', variant: 'destructive' });
    }
  }, [selectedLab, labStock, toast, laboratories, currentUserProfile, selectedSubPoint, invalidateDepoStok, invalidateConsumption, products, deviceGroups, productTracking]);

  const handleTrashBinSubmit = useCallback(async () => {
    if (!selectedTrashDevice || trashItems.length === 0 || !selectedLab) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen cihaz seçin ve en az bir ürün ekleyin.', variant: 'destructive' });
      return;
    }

    try {
      const batch = writeBatch(db);

      trashItems.forEach((item) => {
        const trashBinRef = doc(collection(db, 'trashBinRecords'));
        const trashBinRecord: Omit<TrashBinRecord, 'id'> & { id: string } = {
          id: trashBinRef.id,
          laboratoryId: selectedLab.id,
          laboratoryName: selectedLab.name || '',
          deviceId: selectedTrashDevice.id,
          deviceModel: selectedTrashDevice.cihazAdi || selectedTrashDevice.model || '',
          deviceSerialNumber: selectedTrashDevice.seriNumarasi || '',
          stokKodu: item.productCode,
          stokAdi: item.productName,
          remainingTests: item.remainingTests,
          createdAt: Timestamp.now(),
          createdByUid: currentUser?.uid || '',
          createdByName: currentUserProfile?.name || currentUserProfile?.email || '',
          sourceType: 'manual',
        };

        batch.set(trashBinRef, trashBinRecord);
      });

      await batch.commit();

      urunKullanimLogger.info('Çöp kutusu kaydı oluşturuldu', {
        laboratoryId: selectedLab.id,
        deviceId: selectedTrashDevice.id,
        itemCount: trashItems.length,
      });

      toast({
        title: 'Çöpe Gönderildi',
        description: `${trashItems.length} ürün çöp kutusuna eklendi.`,
      });

      // Reset state
      setIsTrashBinModalOpen(false);
      setSelectedTrashDevice(null);
      setTrashItems([]);
      setSelectedTrashProduct('');
      setTrashRemainingTests(0);
    } catch (error) {
      urunKullanimLogger.error('Çöp kutusu kaydı oluşturulamadı', error, {
        laboratoryId: selectedLab?.id,
        deviceId: selectedTrashDevice?.id,
      });
      toast({
        title: 'Hata',
        description: 'Ürünler çöp kutusuna eklenirken bir hata oluştu.',
        variant: 'destructive',
      });
    }
  }, [selectedTrashDevice, trashItems, selectedLab, currentUser, currentUserProfile, toast]);

  const handleManualDeduction = async () => {
    if (!manualProductCode || !manualLotKey || manualQuantity <= 0) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün, lot ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }
    const [lot, miad] = manualLotKey.split('|');
    const itemsToConsume = labStock.filter(item =>
        item.stokKodu === manualProductCode &&
        item.lotNumarasi === (lot === 'N/A' ? '' : lot) &&
        item.miad === (miad === 'N/A' ? '' : miad)
    ).slice(0, manualQuantity);

    if (itemsToConsume.length < manualQuantity) {
        toast({ title: 'Yetersiz Stok', description: `Seçilen lot için sadece ${itemsToConsume.length} adet ürün mevcut.`, variant: 'destructive' });
        return;
    }

    try {
        for (const item of itemsToConsume) {
            await recordConsumption(item);
        }
        toast({ title: 'Başarılı', description: `${manualQuantity} adet ürün manuel olarak düşüldü.` });
        setIsManualDeductionOpen(false);
        setManualProductCode('');
        setManualLotKey('');
        setManualQuantity(1);
    } catch (error) {
        toast({ title: 'Hata', description: 'Manuel düşüm sırasında bir hata oluştu.', variant: 'destructive' });
    }
  };

  const activeWallpaper = theme === 'dark' ? wallpaper.dark : wallpaper.light;

  // Time-based background selection (08:00-15:59: day, 16:00-07:59: night)
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());

  useEffect(() => {
    const updateHour = () => setCurrentHour(new Date().getHours());
    const interval = setInterval(updateHour, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const isDayTime = currentHour >= 8 && currentHour < 16;
  const timeBasedBackground = isDayTime ? '/dayclear.png' : '/night%20clear.png';

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Full-screen time-based background - fixed to viewport */}
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `url(${timeBasedBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {/* Main content layout */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Full-width Header - spans entire screen */}
        <div className="w-full p-4 pb-0">
          <div className="frosted-glass-card">
            <div className="px-4 py-2">
              {/* Use flex layout for natural flow */}
              <div className="flex items-center justify-between min-h-[44px]">
                {/* Left: User info */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div>
                    <h2 className="text-lg font-bold font-headline text-gradient-primary">{currentUserProfile?.name || 'Kullanıcı'}</h2>
                    <p className="text-xs text-foreground/70">Ürün Kullanım Kaydı</p>
                  </div>
                  {currentUserProfile?.role === 'teknisyen' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={logout}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-6 w-6 p-0"
                    >
                      <LogOut className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* Center: Duty info - always centered */}
                <div className="flex items-center flex-1 justify-center">
                  <DutyInfo selectedLabId={selectedLabId} />
                </div>

                {/* Right: Lab selector */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="w-[180px]">
                    <LabSelector
                      labs={assignedLaboratories.map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
                      value={selectedLabId}
                      onChange={onHospitalSelect}
                      placeholder="Lab seçin..."
                      size="sm"
                      disabled={isLoading || (assignedLaboratories.length <= 1 && currentUserProfile?.role !== 'admin')}
                      loading={isLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content area - Right 45% aligned */}
        <div className="flex-1 flex">
          {/* Left spacer/list deduction panel */}
          <div className="hidden lg:block lg:w-[55%] p-4">
            {selectedLab?.visualDeductionEnabled && (
              <div className="h-full frosted-glass-card p-4 overflow-hidden flex flex-col">
                <div className="frosted-header mb-3">
                  <span className="font-semibold text-base">Listeli Düşüm</span>
                </div>
                {/* Category filter buttons */}
                {labGroupCategories.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setSelectedLabGroup(null)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-semibold transition-all border",
                        !selectedLabGroup
                          ? "bg-primary text-primary-foreground border-primary shadow-md"
                          : "bg-white/10 border-white/20 hover:bg-white/20 text-foreground/80"
                      )}
                    >
                      Tümü ({listDeductionItems.length})
                    </button>
                    {labGroupCategories.map((cat) => {
                      const catCount = listDeductionItems.filter(i => i.laboratuvarGrubu === cat).length;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedLabGroup(prev => prev === cat ? null : cat)}
                          className={cn(
                            "px-4 py-2 rounded-lg text-sm font-semibold transition-all border",
                            selectedLabGroup === cat
                              ? "bg-primary text-primary-foreground border-primary shadow-md"
                              : "bg-white/10 border-white/20 hover:bg-white/20 text-foreground/80"
                          )}
                        >
                          {cat} ({catCount})
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mb-3">
                  <Input
                    value={visualSearchQuery}
                    onChange={(e) => setVisualSearchQuery(e.target.value)}
                    placeholder="Ürün ara (ad, kod, lot)..."
                    className="bg-white/20 border-white/20 placeholder:text-foreground/60"
                  />
                </div>
                <ScrollArea className="flex-1 min-h-0 pr-2">
                  <div className="space-y-1">
                    {filteredListDeductionItems.map((item) => (
                      <div
                        key={`${item.stokKodu}-${item.lotNumarasi}-${item.miadRaw}`}
                        className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 transition-all px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{item.stokAdi}</p>
                          <div className="flex items-center gap-3 text-xs text-foreground/60 mt-0.5">
                            <span>{item.stokKodu}</span>
                            <span>Lot: {item.lotNumarasi}</span>
                            {item.miad && item.miad !== '-' && <span>Miad: {item.miad}</span>}
                            <span className="font-bold text-foreground/90">{item.count} {item.anaBirim}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            type="number"
                            min={1}
                            max={Math.max(1, item.count)}
                            value={visualDeductionQuantities[item.groupKey] || 1}
                            onChange={(e) => {
                              const parsed = Number(e.target.value || 1);
                              const safeValue = Number.isFinite(parsed)
                                ? Math.max(1, Math.min(item.count || 1, Math.floor(parsed)))
                                : 1;
                              setVisualDeductionQuantities(prev => ({ ...prev, [item.groupKey]: safeValue }));
                            }}
                            className="w-20 h-8 text-xs"
                            disabled={item.count <= 0}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 px-3 text-xs font-semibold"
                            onClick={() => handleVisualDeduction(
                              item.stokKodu,
                              item.lotNumarasi,
                              item.miad,
                              item.miadRaw,
                              visualDeductionQuantities[item.groupKey] || 1
                            )}
                            disabled={item.count <= 0}
                          >
                            <PackageMinus className="h-3.5 w-3.5 mr-1.5" />
                            Stoktan Düş
                          </Button>
                        </div>
                      </div>
                    ))}
                    {filteredListDeductionItems.length === 0 && (
                      <p className="text-sm text-foreground/70 text-center py-4">
                        {visualSearchQuery || selectedLabGroup ? 'Filtreye uygun ürün bulunamadı.' : 'Seçili laboratuvarda stok bulunmuyor.'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          {/* Right content area - 45% with cards */}
          <div className="w-full lg:w-[45%] p-4 flex flex-col gap-3">

          {/* Card 2: Son Okutulan Ürün */}
          <div
            className={cn(
              "frosted-glass-card transition-all",
              scanStatus === 'success' && 'ring-2 ring-green-500/50',
              scanStatus === 'error' && 'ring-2 ring-destructive/50'
            )}
            role="status"
            aria-live="polite"
            aria-label="Son okutulan ürün bilgisi"
          >
            <div className="frosted-header flex items-center justify-between gap-2">
              <div className={cn(
                "flex items-center gap-2",
                scanStatus === 'success' && 'text-green-500',
                scanStatus === 'error' && 'text-destructive'
              )}>
                {scanStatus === 'success' ? <CheckCircle className="w-5 h-5" aria-hidden="true" /> : scanStatus === 'error' ? <XCircle className="w-5 h-5" aria-hidden="true" /> : <Barcode className="w-5 h-5" aria-hidden="true" />}
                <span className="font-semibold text-sm">Son Okutulan Ürün</span>
              </div>
              {/* Action buttons moved here */}
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => setIsCameraScannerOpen(true)}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Kamera ile Tara"
                  aria-label="Kamera ile barkod tara"
                  disabled={!selectedLabId}
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </Button>

                {selectedLab?.manualDeductionEnabled && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Manuel Düşüm"
                    aria-label="Manuel stok düşümü yap"
                    disabled={!selectedLabId}
                    onClick={() => setIsManualDeductionOpen(true)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => router.push(`/cop-kutusu/${selectedLabId}`)}
                  disabled={!selectedLabId}
                  title="Çöp Kutusu"
                  aria-label="Çöp kutusuna git"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="frosted-content">
              {lastScannedProduct ? (
                <div className="flex items-start gap-4">
                  {/* Product info */}
                  <div className="flex-1 space-y-1">
                    <p className="text-base font-semibold truncate">{safeName(lastScannedProduct.stokKodu, lastScannedProduct.stokAdi ?? '')}</p>
                    <p className="text-xs text-foreground/70 dark:text-foreground/60">Seri: <span className="font-mono">{lastScannedProduct.seriNumarasi}</span></p>
                    <p className="text-xs text-foreground/70 dark:text-foreground/60">Lot: {lastScannedProduct.lotNumarasi} | Miad: {lastScannedProduct.miad ?? ''}</p>
                    {lastScannedProduct.subPointName && (
                      <p className="text-xs text-foreground/70 dark:text-foreground/60">Nokta: {lastScannedProduct.subPointName}</p>
                    )}
                    {(lastScannedLotRemaining !== null || lastScannedTotalRemaining !== null) && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-foreground/10 bg-foreground/5 px-3 py-2 text-center">
                          <p className="text-[10px] uppercase tracking-wider text-foreground/60">Bu Lottan Kalan</p>
                          <p className="text-4xl font-black leading-none mt-1 tabular-nums">
                            {lastScannedLotRemaining ?? '-'}
                          </p>
                          {lastScannedProduct.lotNumarasi && (
                            <p className="text-[10px] text-foreground/60 mt-1 truncate">Lot: {lastScannedProduct.lotNumarasi}</p>
                          )}
                        </div>
                        <div className="rounded-md border border-foreground/10 bg-foreground/5 px-3 py-2 text-center">
                          <p className="text-[10px] uppercase tracking-wider text-foreground/60">Toplam Kalan</p>
                          <p className="text-4xl font-black leading-none mt-1 tabular-nums">
                            {lastScannedTotalRemaining ?? '-'}
                          </p>
                          <p className="text-[10px] text-foreground/60 mt-1">(tüm lotlar)</p>
                        </div>
                      </div>
                    )}
                    {scanStatus === 'success' && <p className="text-green-500 text-xs font-medium mt-1">Stoktan Düşüldü!</p>}
                  </div>
                  {/* Device group image - larger */}
                  {lastScannedDeviceGroupImage && (
                    <div className="flex-shrink-0">
                      <Image
                        src={resolveImageSrc(lastScannedDeviceGroupImage)}
                        alt="Cihaz Grubu"
                        width={120}
                        height={120}
                        className="object-contain"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-foreground/60 dark:text-foreground/50 text-sm text-center py-4">Henüz ürün okutulmadı.</p>
              )}
            </div>
          </div>

          {/* Card 3: Son 10 Tüketim */}
          <div className="frosted-glass-card">
            <div className="frosted-header flex items-center gap-2">
              <Clock className="w-4 h-4 text-foreground/70 dark:text-foreground/60"/>
              <span className="font-semibold text-sm">Son 10 Tüketim</span>
            </div>
            <div className="frosted-content">
              <ScrollArea className="h-[120px]">
                {sessionHistory.length === 0 ? (
                  <p className="text-sm text-foreground/60 dark:text-foreground/50 text-center py-2">Henüz tüketim kaydı yok.</p>
                ) : (
                  <ul className="text-sm space-y-1">
                    {sessionHistory.map((item, index) => (
                      <li key={index} className="flex justify-between items-center text-xs p-1.5 rounded-md hover:bg-white/10 dark:hover:bg-black/20">
                        <div className="truncate flex-1">
                          <span className="font-semibold">{safeName(item.stokKodu, item.stokAdi ?? '')}</span>
                          <span className="text-foreground/70 dark:text-foreground/60 ml-1">({item.lotNumarasi})</span>
                        </div>
                        <span className="font-mono text-foreground/70 dark:text-foreground/60 flex-shrink-0 ml-2">{item.seriNumarasi}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </div>
          </div>

          {/* Card 4: Cihazlar */}
          {selectedLabId && (
            <div className="frosted-glass-card flex-1" role="region" aria-label="Laboratuvar cihazları">
              <div className="frosted-header grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Wrench className="w-4 h-4 text-foreground/70 dark:text-foreground/60"/>
                  <span className="font-semibold text-sm">Cihazlar</span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenGlobalStopModal}
                  disabled={devicesToDisplay.length === 0}
                  className="text-[11px] px-3 py-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  KOMPLE STOP
                </button>
                {devicesToDisplay.length > 0 && (
                  <span className="text-xs text-foreground/70 dark:text-foreground/60 justify-self-end">{devicesToDisplay.length} cihaz</span>
                )}
              </div>
              <div className="frosted-content">
                {devicesToDisplay.length > 0 ? (
                  <div
                    className={cn(
                      "flex flex-wrap gap-3",
                      devicesToDisplay.length <= 5 ? "justify-center" : "justify-start"
                    )}
                    role="list"
                    aria-label="Cihaz listesi"
                    style={{
                      '--device-size': devicesToDisplay.length <= 5
                        ? `calc((100% - ${(devicesToDisplay.length - 1) * 12}px) / ${devicesToDisplay.length})`
                        : '80px'
                    } as React.CSSProperties}
                  >
                    {devicesToDisplay.map((c) => (
                      <button
                        key={c.id}
                        className={cn(
                          "group relative outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-center transition-transform hover:scale-105",
                          devicesToDisplay.length <= 5 ? "flex-1 min-w-[60px] max-w-[120px]" : "w-[80px]"
                        )}
                        onClick={() => {
                          const event = new CustomEvent('openDeviceFaultModal', { detail: c });
                          window.dispatchEvent(event);
                        }}
                        title={`${c.cihazAdi || c.model || ''} • ${c.seriNumarasi || ''}`}
                        aria-label={`${c.cihazAdi || c.model || 'Cihaz'} - Seri: ${c.seriNumarasi || 'N/A'} - ${(c.arizaDurumu !== 'yok') ? 'Arızalı' : 'Çalışıyor'}`}
                        role="listitem"
                      >
                        {/* Device name and serial above image */}
                        <div className="text-center mb-1">
                          <div className="text-[10px] font-medium leading-tight truncate">{c.cihazAdi || c.model}</div>
                          <div className="text-[8px] text-foreground/60 dark:text-foreground/50 font-mono truncate">{c.seriNumarasi || '-'}</div>
                        </div>
                        {/* Device image */}
                        <div className="relative w-full aspect-square flex items-center justify-center">
                          <Image
                            src={resolveImageSrc(c.imageUrl)}
                            alt={c.cihazAdi || c.model || 'Device'}
                            fill
                            className="object-contain"
                            sizes="120px"
                            priority={false}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.srcset = '/lab_diorama.png';
                              target.src = '/lab_diorama.png';
                            }}
                          />
                          {/* Status light at bottom */}
                          <div
                            className={cn(
                              "absolute bottom-0 w-full h-1 rounded-full",
                              (c.arizaDurumu !== 'yok') ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]'
                            )}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-foreground/60 dark:text-foreground/50 space-y-1">
                    <Info className="w-5 h-5 opacity-40" />
                    <p className="text-xs">Bu laboratuvara tanımlı cihaz bulunamadı.</p>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="p-4 pb-0"><DialogTitle>Kamera ile Ürün Kullanımı Tara</DialogTitle></DialogHeader>
          {isCameraScannerOpen && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>}>
              <DynamicCameraBarcodeScanner
                onScanSuccess={handleCameraScanSuccess}
                onClose={() => setIsCameraScannerOpen(false)}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      
      <Dialog open={faultModalOpen} onOpenChange={setFaultModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" aria-describedby="fault-dialog-description">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>
              {faultTargetMode === 'global' ? 'Arıza Kaydı: KOMPLE STOP' : `Arıza Kaydı: ${selectedDevice?.cihazAdi}`}
            </DialogTitle>
            <DialogDescription id="fault-dialog-description">
              {faultTargetMode === 'global'
                ? `${devicesToDisplay.length} cihaz • Arıza tipini seçin`
                : `SN: ${selectedDevice?.seriNumarasi} • Arıza tipini seçin`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto py-4">
            {faultDefinitions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-foreground/60 dark:text-foreground/50">
                <AlertTriangle className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">Arıza tanımı bulunamadı</p>
                <p className="text-sm">Lütfen yöneticinize başvurun.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Teknik Servis Column */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-t-lg border border-blue-200 dark:border-blue-800">
                    <Wrench className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <h3 className="font-semibold text-blue-700 dark:text-blue-300">Teknik Servis</h3>
                    <span className="ml-auto text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded-full">
                      {teknikServisFaults.length} tanım
                    </span>
                  </div>
                  <ScrollArea className="h-[300px] border border-t-0 border-blue-200 dark:border-blue-800 rounded-b-lg">
                    <div className="p-1">
                      {/* Diğer - Custom fault option */}
                      <button
                        onClick={() => handleOpenCustomFault('teknik_servis')}
                        disabled={isSavingFault}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-md transition-all mb-1",
                          "bg-blue-50 dark:bg-blue-950/50",
                          "hover:bg-blue-100 dark:hover:bg-blue-900/40",
                          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          "border border-blue-200 dark:border-blue-700 hover:border-blue-300 dark:hover:border-blue-600"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <ClipboardPlus className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Diğer</span>
                          <span className="ml-auto text-xs text-blue-500 dark:text-blue-400">(Özel arıza)</span>
                        </div>
                      </button>
                      {teknikServisFaults.length === 0 ? (
                        <div className="text-center py-6 text-foreground/60 dark:text-foreground/50 text-sm">
                          Tanımlı arıza yok
                        </div>
                      ) : (
                        teknikServisFaults.map((fault) => (
                          <button
                            key={fault.id}
                            onClick={() => handleFaultReport(fault)}
                            disabled={isSavingFault}
                            className={cn(
                              "w-full text-left px-3 py-2.5 rounded-md transition-all",
                              "hover:bg-blue-100 dark:hover:bg-blue-900/40",
                              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                              "border border-transparent hover:border-blue-300 dark:hover:border-blue-700"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {isSavingFault ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                              ) : (
                                <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                              )}
                              <span className="text-sm font-medium text-foreground">{fault.name}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Aplikasyon Column */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/30 rounded-t-lg border border-purple-200 dark:border-purple-800">
                    <FlaskConical className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="font-semibold text-purple-700 dark:text-purple-300">Aplikasyon</h3>
                    <span className="ml-auto text-xs text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/50 px-2 py-0.5 rounded-full">
                      {aplikasyonFaults.length} tanım
                    </span>
                  </div>
                  <ScrollArea className="h-[300px] border border-t-0 border-purple-200 dark:border-purple-800 rounded-b-lg">
                    <div className="p-1">
                      {/* Diğer - Custom fault option */}
                      <button
                        onClick={() => handleOpenCustomFault('aplikasyon')}
                        disabled={isSavingFault}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-md transition-all mb-1",
                          "bg-purple-50 dark:bg-purple-950/50",
                          "hover:bg-purple-100 dark:hover:bg-purple-900/40",
                          "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          "border border-purple-200 dark:border-purple-700 hover:border-purple-300 dark:hover:border-purple-600"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <ClipboardPlus className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">Diğer</span>
                          <span className="ml-auto text-xs text-purple-500 dark:text-purple-400">(Özel arıza)</span>
                        </div>
                      </button>
                      {aplikasyonFaults.length === 0 ? (
                        <div className="text-center py-6 text-foreground/60 dark:text-foreground/50 text-sm">
                          Tanımlı arıza yok
                        </div>
                      ) : (
                        aplikasyonFaults.map((fault) => (
                          <button
                            key={fault.id}
                            onClick={() => handleFaultReport(fault)}
                            disabled={isSavingFault}
                            className={cn(
                              "w-full text-left px-3 py-2.5 rounded-md transition-all",
                              "hover:bg-purple-100 dark:hover:bg-purple-900/40",
                              "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                              "border border-transparent hover:border-purple-300 dark:hover:border-purple-700"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {isSavingFault ? (
                                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                              ) : (
                                <div className="h-2 w-2 rounded-full bg-purple-500 flex-shrink-0" />
                              )}
                              <span className="text-sm font-medium text-foreground">{fault.name}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t pt-4">
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isSavingFault}
              onClick={() => handleStopFaultReport('E STOP')}
            >
              E STOP
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isSavingFault}
              onClick={() => handleStopFaultReport('S STOP')}
            >
              S STOP
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isSavingFault}
              onClick={() => handleStopFaultReport('NORMAL STOP')}
            >
              NORMAL STOP
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Fault Entry Modal */}
      <Dialog open={customFaultModalOpen} onOpenChange={setCustomFaultModalOpen}>
        <DialogContent className="max-w-md" aria-describedby="custom-fault-dialog-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {customFaultType === 'teknik_servis' ? (
                <>
                  <Wrench className="h-5 w-5 text-blue-600" />
                  <span>Özel Teknik Servis Arızası</span>
                </>
              ) : (
                <>
                  <FlaskConical className="h-5 w-5 text-purple-600" />
                  <span>Özel Aplikasyon Arızası</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription id="custom-fault-dialog-description">
              {selectedDevice?.cihazAdi} cihazı için özel arıza kaydı oluşturun.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="customFaultTitle" className="text-sm font-medium">
                Arıza Başlığı <span className="text-destructive">*</span>
              </Label>
              <Input
                id="customFaultTitle"
                value={customFaultTitle}
                onChange={(e) => setCustomFaultTitle(e.target.value)}
                placeholder="Arıza başlığını girin..."
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customFaultDescription" className="text-sm font-medium">
                Arıza Açıklaması <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="customFaultDescription"
                value={customFaultDescription}
                onChange={(e) => setCustomFaultDescription(e.target.value)}
                placeholder="Arızayı detaylı olarak açıklayın..."
                rows={4}
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCustomFaultModalOpen(false)}
              disabled={isSavingFault}
            >
              İptal
            </Button>
            <Button
              onClick={handleCustomFaultSubmit}
              disabled={isSavingFault || !customFaultTitle.trim() || !customFaultDescription.trim()}
              className={customFaultType === 'teknik_servis' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'}
            >
              {isSavingFault ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                'Arıza Kaydı Oluştur'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTrashBinModalOpen} onOpenChange={setIsTrashBinModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Trash2 className="mr-2 h-5 w-5 text-destructive" />
              Çöp Kutusu - Ürün Ekleme
            </DialogTitle>
            <DialogDescription>
              Çöpe atılacak ürünleri cihaz seçerek veya manuel olarak ekleyin.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            {/* Device selection */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Cihaz Seçin</Label>
              <p className="text-xs text-foreground/70 dark:text-foreground/60 mb-3">
                Ürün eklemek için önce bir cihaz seçin
              </p>
              {devicesToDisplay.length > 0 ? (
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {devicesToDisplay.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => setSelectedTrashDevice(device)}
                      className={cn(
                        "group relative w-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-center transition-all",
                        selectedTrashDevice?.id === device.id
                          ? "scale-105 ring-2 ring-primary"
                          : "hover:scale-105"
                      )}
                    >
                      <div className="text-center mb-1">
                        <div className="text-xs font-medium leading-tight truncate px-1">
                          {device.cihazAdi || device.model}
                        </div>
                        <div className="text-[10px] text-foreground/60 dark:text-foreground/50 font-mono truncate">
                          {device.seriNumarasi || '-'}
                        </div>
                      </div>
                      <div className={cn(
                        "relative w-full aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border-2 transition-colors",
                        selectedTrashDevice?.id === device.id
                          ? "border-primary bg-primary/10"
                          : "border-border group-hover:border-primary/30"
                      )}>
                        <Image
                          src={resolveImageSrc(device.imageUrl)}
                          alt={device.cihazAdi || device.model || 'Device'}
                          fill
                          className="object-contain p-1"
                          sizes="(max-width: 768px) 33vw, 20vw"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.srcset = '/lab_diorama.png';
                            target.src = '/lab_diorama.png';
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center text-foreground/60 dark:text-foreground/50 py-6 bg-muted rounded-lg">
                  <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Bu laboratuvara tanımlı cihaz bulunamadı.</p>
                </div>
              )}
            </div>

            {/* Product selection form - shown after device selection */}
            {selectedTrashDevice && (
              <div className="border-t pt-6 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium">
                      Seçilen Cihaz: {selectedTrashDevice.cihazAdi || selectedTrashDevice.model}
                    </p>
                    <p className="text-xs text-foreground/70 dark:text-foreground/60">
                      SN: {selectedTrashDevice.seriNumarasi}
                    </p>
                  </div>
                </div>

                {/* Manuel product selection */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Ürün Seçin</Label>
                    <Popover open={isTrashProductPopoverOpen} onOpenChange={setIsTrashProductPopoverOpen} modal={false}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal"
                        >
                          {selectedTrashProduct
                            ? products.find((p) => p.stokKodu === selectedTrashProduct)?.stokAdi
                            : "Ürün seçin..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0 z-[9999]" style={{ pointerEvents: 'auto' }}>
                        <div className="flex flex-col">
                          <div className="p-2 border-b">
                            <Input
                              placeholder="Ürün ara..."
                              value={trashProductSearch}
                              onChange={(e) => setTrashProductSearch(e.target.value)}
                              className="h-9"
                            />
                          </div>
                          <div className="max-h-[300px] overflow-y-auto">
                            <div className="p-1">
                              {(() => {
                                const filtered = products
                                  .filter(p => {
                                    // Filter products with min/max stock levels defined in lab management
                                    const rule = minMaxRules.find(r => r.stokKodu === p.stokKodu);
                                    if (!rule || (rule.min == null && rule.max == null)) return false;

                                    // Apply search filter
                                    if (trashProductSearch) {
                                      const search = trashProductSearch.toLowerCase();
                                      const nameMatch = (p.stokAdi || '').toLowerCase().includes(search);
                                      const codeMatch = (p.stokKodu || '').toLowerCase().includes(search);
                                      return nameMatch || codeMatch;
                                    }
                                    return true;
                                  })
                                  .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));

                                if (filtered.length === 0) {
                                  return (
                                    <div className="p-4 text-center text-sm text-foreground/60 dark:text-foreground/50">
                                      Ürün bulunamadı.
                                    </div>
                                  );
                                }

                                return filtered.map((product) => (
                                  <div
                                    key={product.id}
                                    className={cn(
                                      "flex items-center gap-2 p-2 rounded-sm cursor-pointer hover:bg-accent",
                                      selectedTrashProduct === product.stokKodu && "bg-accent"
                                    )}
                                    role="option"
                                    aria-selected={selectedTrashProduct === product.stokKodu}
                                    onClick={() => {
                                      setSelectedTrashProduct(product.stokKodu || '');
                                      setTrashRemainingTests(product.ambalajDegeri || 0);
                                      setIsTrashProductPopoverOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "h-4 w-4 shrink-0",
                                        selectedTrashProduct === product.stokKodu ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <div className="flex flex-col flex-1 min-w-0">
                                      <span className="text-sm">{product.stokAdi}</span>
                                      <span className="text-xs text-foreground/70 dark:text-foreground/60">{product.stokKodu}</span>
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {selectedTrashProduct && (
                    <div>
                      <Label htmlFor="remaining-tests" className="text-sm font-medium mb-2 block">
                        Kalan Test Adeti
                      </Label>
                      <Input
                        id="remaining-tests"
                        type="number"
                        min="0"
                        value={trashRemainingTests}
                        onChange={(e) => setTrashRemainingTests(Number(e.target.value))}
                        placeholder="Kalan test adedini girin"
                      />
                    </div>
                  )}

                  {selectedTrashProduct && (
                    <Button
                      onClick={() => {
                        const product = products.find(p => p.stokKodu === selectedTrashProduct);
                        if (product) {
                          setTrashItems(prev => [...prev, {
                            id: Math.random().toString(36).substr(2, 9),
                            productCode: product.stokKodu || '',
                            productName: product.stokAdi || '',
                            remainingTests: trashRemainingTests,
                          }]);
                          setSelectedTrashProduct('');
                          setTrashRemainingTests(0);
                        }
                      }}
                      className="w-full"
                    >
                      <ClipboardPlus className="h-4 w-4 mr-2" />
                      Listeye Ekle
                    </Button>
                  )}

                  {/* Display added items */}
                  {trashItems.length > 0 && (
                    <div className="border rounded-lg p-4 space-y-2">
                      <Label className="text-sm font-medium">Eklenecek Ürünler ({trashItems.length})</Label>
                      <ScrollArea className="h-32">
                        <div className="space-y-2">
                          {trashItems.map((item) => (
                            <div key={item.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                              <div className="flex-1">
                                <p className="font-medium">{item.productName}</p>
                                <p className="text-xs text-foreground/70 dark:text-foreground/60">
                                  {item.productCode} • Kalan Test: {item.remainingTests}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setTrashItems(prev => prev.filter(i => i.id !== item.id))}
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsTrashBinModalOpen(false);
              setSelectedTrashDevice(null);
              setTrashItems([]);
              setSelectedTrashProduct('');
              setTrashRemainingTests(0);
            }}>
              İptal
            </Button>
            {trashItems.length > 0 && (
              <Button onClick={handleTrashBinSubmit}>
                <Trash2 className="h-4 w-4 mr-2" />
                Çöpe Gönder ({trashItems.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isManualDeductionOpen} onOpenChange={setIsManualDeductionOpen}>
        <DialogContent aria-describedby="manual-deduction-description">
          <DialogHeader>
            <DialogTitle>Manuel Stok Düşüm</DialogTitle>
            <DialogDescription id="manual-deduction-description">Listeden ürün seçerek stoktan düşün.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
              <div>
                <Label htmlFor="manual-product-select">Ürün</Label>
                <Select value={manualProductCode} onValueChange={setManualProductCode}>
                    <SelectTrigger id="manual-product-select" aria-label="Ürün seçin"><SelectValue placeholder="Ürün seçin..." /></SelectTrigger>
                    <SelectContent>{manualDeductionAvailableProducts.map(p => (<SelectItem key={p.id} value={p.stokKodu ?? ''}>{p.stokAdi}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="manual-lot-select">Lot / Miad</Label>
                <Select value={manualLotKey} onValueChange={setManualLotKey} disabled={!manualProductCode}>
                    <SelectTrigger id="manual-lot-select" aria-label="Lot ve miad seçin"><SelectValue placeholder="Lot seçin..." /></SelectTrigger>
                    <SelectContent>{manualDeductionLotOptions.map(opt => (<SelectItem key={opt.key} value={opt.key}>{opt.label} ({opt.count})</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                  <Label htmlFor="manual-quantity-input">Adet</Label>
                  <Input
                    id="manual-quantity-input"
                    type="number"
                    value={manualQuantity}
                    onChange={e => setManualQuantity(Number(e.target.value))}
                    min={1}
                    aria-label="Düşülecek adet"
                  />
              </div>
          </div>
          <DialogFooter>
            <Button onClick={handleManualDeduction} aria-label="Manuel düşüm işlemini başlat">Düşüm Yap</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Centered stock warning modal: stays on screen until user confirms.
          Shown when a consumed product hits min stock OR has 1 remaining (max>2). */}
      <Dialog
        open={stockWarnings.length > 0}
        onOpenChange={(open) => {
          if (!open) setStockWarnings([]);
        }}
      >
        <DialogContent
          className="max-w-lg border-4 border-red-500 stock-warning-blink bg-background"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500 text-xl">
              <AlertTriangle className="h-6 w-6 animate-pulse" />
              Stok Uyarısı
            </DialogTitle>
            <DialogDescription>
              Aşağıdaki ürün(ler) için laboratuvar stoğunda kritik seviyeye ulaşıldı.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-3 py-2">
              {stockWarnings.map((w) => (
                <div
                  key={w.stokKodu}
                  className="rounded-md border-2 border-red-500/70 bg-red-500/10 p-3 space-y-1"
                >
                  <p className="font-semibold text-base">
                    {w.stokAdi || w.stokKodu}{' '}
                    <span className="text-xs text-foreground/60 font-mono">({w.stokKodu})</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span>
                      Kalan: <span className="text-2xl font-black text-red-500 tabular-nums">{w.totalRemaining}</span>
                    </span>
                    {w.minStock != null && (
                      <span className="text-foreground/70">Min: <span className="font-semibold">{w.minStock}</span></span>
                    )}
                    {w.maxStock != null && (
                      <span className="text-foreground/70">Max: <span className="font-semibold">{w.maxStock}</span></span>
                    )}
                  </div>
                  <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-400">
                    {w.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setStockWarnings([])}
              aria-label="Uyarıyı onayla"
            >
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmFaultOpen} onOpenChange={setConfirmFaultOpen}>
        <DialogContent aria-describedby="confirm-fault-description">
          <DialogHeader>
            <DialogTitle>Arıza Kaydı Onayı</DialogTitle>
            <DialogDescription id="confirm-fault-description">
              Bu arıza kaydını açmak istediğinizden emin misiniz?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFaultOpen(false)}>
              Hayır
            </Button>
            <Button onClick={handleConfirmFaultReport} disabled={isSavingFault}>
              {isSavingFault ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Evet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <PeripheralFaultContactModal 
        open={isPeripheralModalOpen} 
        onOpenChange={setIsPeripheralModalOpen} 
        users={peripheralResponsibleUsers} 
      />
    </div>
  );
}
