'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  Timestamp,
  writeBatch,
  increment,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import type { ProductCode, User, PendingReturn, SparePartTransferRow, PersonalStockItem, YedekParcaDepoStokItem, Device, Hospital, Depot, DeviceLabPool, PoolWarehouseStockItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope, filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  Search,
  Send,
  CheckCircle,
  Clock,
  History,
  ImageIcon,
  HandCoins,
  XCircle,
  Warehouse,
  User as UserIcon,
  ChevronRight,
  Wrench,
  Cpu,
  PackageOpen,
  ChevronDown,
  ChevronUp,
  Hash,
  List,
  ChevronLeft,
  Pencil,
  Menu,
  X,
  Download,
  Upload,
  FileText,
  Database,
  SlidersHorizontal,
  ShoppingCart,
  ArrowUpDown,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SparePartTransferTutanakPDFButton from '@/components/exports/SparePartTransferTutanakPDFButton';
import TeknikServisTutanakPDFButton from '@/components/exports/TeknikServisTutanakPDFButton';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';
import { emitSparePartTransfer, emitExternalStockUsage } from '@/lib/notifications';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';

// Menu selection types
type MenuSection = 'transfer' | 'depo-stok' | 'toplam-stok' | 'personnel' | 'pool-stok';
interface MenuSelection {
  section: MenuSection;
  personnelUid?: string;
  personnelName?: string;
  personnelRole?: string;
  poolWarehouseId?: string;
  poolWarehouseName?: string;
}

// Grouped stock item for depo stok view
interface GroupedDepoStokItem {
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  cihazGrubu: string;
  totalQuantity: number;
  earliestDate: Date;
  serialNumbers: { serialNumber: string; hucreNumarasi?: string; createdAt: Date; id: string; address?: string }[];
  entries: YedekParcaDepoStokItem[];
}

interface ManualPersonnelStockRow {
  id: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;
  quantity: number;
}

// Wrapper component for on-demand form PDF download
function SparePartFormPDFButton({ formId, formType, deviceId }: { formId: string; formType: 'teknik_servis' | 'aplikasyon'; deviceId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<{ device: Device; hospital: Hospital | null; actionRecord: any } | null>(null);
  const [autoExport, setAutoExport] = React.useState(false);

  const wrapperRef = React.useCallback((node: HTMLDivElement | null) => {
    if (node && autoExport) {
      const btn = node.querySelector('button');
      if (btn) {
        btn.click();
        setAutoExport(false);
      }
    }
  }, [autoExport]);

  const handleClick = async () => {
    if (data) { setAutoExport(true); return; }
    setLoading(true);
    try {
      const deviceSnap = await getDoc(doc(db, 'devices', deviceId));
      if (!deviceSnap.exists()) return;
      const deviceData = { id: deviceSnap.id, ...deviceSnap.data() } as Device;

      let hospitalData: Hospital | null = null;
      if (deviceData.hospitalId) {
        const hospitalSnap = await getDoc(doc(db, 'hospitals', deviceData.hospitalId));
        if (hospitalSnap.exists()) {
          hospitalData = { id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital;
        }
      }

      const formSnap = await getDoc(doc(db, 'deviceActionForms', formId));
      if (!formSnap.exists()) return;
      const actionRecord = { id: formSnap.id, ...formSnap.data() };

      setData({ device: deviceData, hospital: hospitalData, actionRecord });
      setAutoExport(true);
    } catch (err) {
      console.error('Error fetching form data for PDF:', err);
    } finally {
      setLoading(false);
    }
  };

  if (data) {
    return (
      <div ref={wrapperRef} className="inline-flex">
        {formType === 'teknik_servis' ? (
          <TeknikServisTutanakPDFButton device={data.device} hospital={data.hospital} actionRecord={data.actionRecord} />
        ) : (
          <AplikasyonTutanakPDFButton device={data.device} hospital={data.hospital} actionRecord={data.actionRecord} />
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all hover:opacity-80 active:scale-95 disabled:opacity-50"
      style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
      title={formType === 'teknik_servis' ? 'Teknik Servis Tutanağı İndir' : 'Aplikasyon Tutanağı İndir'}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
      {formType === 'teknik_servis' ? 'T.Servis' : 'Aplikasyon'}
    </button>
  );
}

interface PersonnelStockViewItem extends PersonalStockItem {
  usageLabName?: string;
  usageDeviceName?: string;
}

export default function YedekParcaTransferPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const depotExcelInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [borrowedParts, setBorrowedParts] = useState<any[]>([]);
  const [transferLogs, setTransferLogs] = useState<any[]>([]);

  // Image preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Transfer form state
  const [transferRows, setTransferRows] = useState<SparePartTransferRow[]>([]);
  const [isTransferring, setIsTransferring] = useState(false);

  // New row state - product selector now uses depo stock products
  const [depoStokProducts, setDepoStokProducts] = useState<GroupedDepoStokItem[]>([]);
  const [selectedStokKodu, setSelectedStokKodu] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [hucreNumber, setHucreNumber] = useState('');
  const [transferQuantity, setTransferQuantity] = useState<number>(1);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [serialSelectOpen, setSerialSelectOpen] = useState(false);

  // Left menu selection
  const [menuSelection, setMenuSelection] = useState<MenuSelection>({ section: 'transfer' });

  // Depo stok data (raw)
  const [depoStok, setDepoStok] = useState<YedekParcaDepoStokItem[]>([]);
  const [depoStokLoading, setDepoStokLoading] = useState(false);
  const [expandedStokKodu, setExpandedStokKodu] = useState<string | null>(null);
  const [depoStokSearchQuery, setDepoStokSearchQuery] = useState('');
  const [minMaxPanelOpen, setMinMaxPanelOpen] = useState(false);
  const [depoStokPage, setDepoStokPage] = useState(0);
  const [editingDepoGroup, setEditingDepoGroup] = useState<GroupedDepoStokItem | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number>(1);
  const [isSavingDepoEdit, setIsSavingDepoEdit] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const DEPO_STOK_PER_PAGE = 20;

  // Product code reference for cihazGrubu lookup
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);

  // Personnel stock data
  const [personnelStock, setPersonnelStock] = useState<PersonnelStockViewItem[]>([]);
  const [personnelStockLoading, setPersonnelStockLoading] = useState(false);
  const [personnelStockPage, setPersonnelStockPage] = useState(0);
  const [personnelStockFilter, setPersonnelStockFilter] = useState<'all' | 'used' | 'unused' | 'pending_approval'>('all');
  const [personnelStockSortKey, setPersonnelStockSortKey] = useState<'createdAt' | 'usedAt' | 'movement'>('movement');
  const [personnelStockSortOrder, setPersonnelStockSortOrder] = useState<'asc' | 'desc'>('desc');
  const ITEMS_PER_PAGE = 20;

  // All personnel stock for toplam stok view
  const [allPersonnelStock, setAllPersonnelStock] = useState<PersonalStockItem[]>([]);
  const [allPoolStockAggregate, setAllPoolStockAggregate] = useState<PoolWarehouseStockItem[]>([]);
  const [allStockLoading, setAllStockLoading] = useState(false);
  const [takingOverStockId, setTakingOverStockId] = useState<string | null>(null);
  const [historyActionFilter, setHistoryActionFilter] = useState<string>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [manualStockModalOpen, setManualStockModalOpen] = useState(false);
  const [manualStockRows, setManualStockRows] = useState<ManualPersonnelStockRow[]>([]);
  const [isSavingManualStock, setIsSavingManualStock] = useState(false);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [stockCardSyncDialogOpen, setStockCardSyncDialogOpen] = useState(false);
  const [stockCardSyncLoading, setStockCardSyncLoading] = useState(false);
  const [stockCardSyncMissing, setStockCardSyncMissing] = useState<Array<{ stokKodu: string; stokAdi: string }>>([]);
  const [stockCardSyncBrand, setStockCardSyncBrand] = useState<string>('');

  // Pool warehouse state
  const [poolWarehouses, setPoolWarehouses] = useState<Depot[]>([]);
  const [poolStock, setPoolStock] = useState<PoolWarehouseStockItem[]>([]);
  const [poolStockLoading, setPoolStockLoading] = useState(false);
  const [poolStockFilter, setPoolStockFilter] = useState<'all' | 'used' | 'unused'>('all');
  const [poolStockSortKey, setPoolStockSortKey] = useState<'createdAt' | 'usedAt' | 'movement'>('movement');
  const [poolStockSortOrder, setPoolStockSortOrder] = useState<'asc' | 'desc'>('desc');
  const [poolStockPage, setPoolStockPage] = useState(0);

  // Return to depot modal state
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnModalItem, setReturnModalItem] = useState<PersonalStockItem | null>(null);
  const [returnCondition, setReturnCondition] = useState<'iyi' | 'miad_gecmis' | 'arizali'>('iyi');
  const [returnNote, setReturnNote] = useState('');
  const [isReturning, setIsReturning] = useState(false);

  // Observation (transfer history for a single item) modal state
  const [observationOpen, setObservationOpen] = useState(false);
  const [observationItem, setObservationItem] = useState<{
    id: string;
    scope: 'personal' | 'pool';
    stokKodu: string;
    stokAdi: string;
    serialNumber?: string;
    ownerName?: string;
    poolWarehouseName?: string;
  } | null>(null);
  const [observationLogs, setObservationLogs] = useState<any[]>([]);
  const [observationLoading, setObservationLoading] = useState(false);

  // Personnel-to-personnel transfer modal state
  const [pTransferModalOpen, setPTransferModalOpen] = useState(false);
  const [pTransferItem, setPTransferItem] = useState<PersonalStockItem | null>(null);
  const [pTransferTargetUid, setPTransferTargetUid] = useState('');
  const [pTransferTargetName, setPTransferTargetName] = useState('');
  const [pTransferQuantity, setPTransferQuantity] = useState(1);
  const [pTransferSearchOpen, setPTransferSearchOpen] = useState(false);
  const [pTransferSearchQuery, setPTransferSearchQuery] = useState('');
  const [isPersonnelTransferring, setIsPersonnelTransferring] = useState(false);

  // Check authorization
  const isAuthorized = currentUserProfile?.role === 'super_admin' || currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik' || currentUserProfile?.role === 'teknik_servis' || currentUserProfile?.role === 'aplikasyon';
  const isAdmin = currentUserProfile?.role === 'super_admin' || currentUserProfile?.role === 'admin';
  const isTeknikLojistik = currentUserProfile?.role === 'teknik_lojistik';
  const canApproveDepotReturns = isAdmin || isTeknikLojistik;
  const isFieldPersonnel = currentUserProfile?.role === 'teknik_servis' || currentUserProfile?.role === 'aplikasyon';
  const canAccessTransferPanel = !isFieldPersonnel;

  const getLogQuantity = useCallback((log: any) => {
    const q = Number(log?.quantity);
    return Number.isFinite(q) && q > 0 ? q : 1;
  }, []);

  const getLogNetStockDelta = useCallback((log: any) => {
    const qty = getLogQuantity(log);
    const action = String(log?.action || '');

    if (action === 'stok_giris' || action === 'use_on_device' || action === 'depo_serial_deleted' || action === 'depo_stock_deleted_admin' || action === 'stok_silme_admin' || action === 'personnel_stock_deleted_admin' || action === 'pool_stock_deleted_admin') {
      return action === 'stok_giris' ? qty : -qty;
    }

    if (action === 'borrowed_rejected') {
      return log?.sourceType === 'depot' ? qty : 0;
    }

    if (action === 'depo_stock_adjusted') {
      const notes = String(log?.notes || '');
      const parsed = notes.match(/(\d+)\s*->\s*(\d+)/);
      if (parsed) {
        const oldQty = Number(parsed[1] || 0);
        const newQty = Number(parsed[2] || 0);
        if (Number.isFinite(oldQty) && Number.isFinite(newQty)) {
          return newQty - oldQty;
        }
      }
      return 0;
    }

    return 0;
  }, [getLogQuantity]);

  const loadRecentTransferLogs = useCallback(async () => {
    const [transferLogsSnap, depotLogsSnap, depotStockSnap, personalStockSnap, poolStockSnap] = await Promise.all([
      getDocs(scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin)),
      getDocs(scopedQuery('yedekParcaDepoLog', currentCompanyId, isSuperAdmin)),
      getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin)),
      getDocs(scopedQuery('personalStock', currentCompanyId, isSuperAdmin, where('status', '==', 'in_stock'))),
      getDocs(scopedQuery('poolWarehouseStock', currentCompanyId, isSuperAdmin, where('status', '==', 'in_stock'))),
    ]);

    const transferLogsData = filterByCompanyScope(transferLogsSnap.docs.map(d => {
      const data = d.data();
      const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
      return { id: d.id, ...data, timestamp, sourceCollection: 'sparePartTransferLogs' as const };
    }), currentCompanyId, isSuperAdmin);

    const depotLogsData = filterByCompanyScope(depotLogsSnap.docs.map(d => {
      const data = d.data();
      const timestamp = data.createdAt?.toDate?.() || data.timestamp?.toDate?.() || new Date();
      return { id: d.id, ...data, timestamp, sourceCollection: 'yedekParcaDepoLog' as const };
    }), currentCompanyId, isSuperAdmin);

    const logs = [...transferLogsData, ...depotLogsData];
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const runningStockByCode = new Map<string, number>();
    const addToRunning = (stokKodu: string, quantity: number) => {
      const code = String(stokKodu || '').trim();
      if (!code) return;
      runningStockByCode.set(code, (runningStockByCode.get(code) || 0) + quantity);
    };

    const depotStock = filterByCompanyScope(
      depotStockSnap.docs.map(d => d.data()),
      currentCompanyId,
      isSuperAdmin,
    );
    depotStock.forEach((item: any) => addToRunning(item.stokKodu, Number(item.quantity) || 1));

    const personalStock = filterByCompanyScope(
      personalStockSnap.docs.map(d => d.data()),
      currentCompanyId,
      isSuperAdmin,
    );
    personalStock.forEach((item: any) => addToRunning(item.stokKodu, Number(item.quantity) || 1));

    const poolStockData = filterByCompanyScope(
      poolStockSnap.docs.map(d => d.data()),
      currentCompanyId,
      isSuperAdmin,
    );
    poolStockData.forEach((item: any) => addToRunning(item.stokKodu, Number(item.quantity) || 1));

    for (const log of logs) {
      const code = String(log.stokKodu || '').trim();
      if (!code) {
        log.postActionStockTotal = null;
        continue;
      }

      const currentAfter = runningStockByCode.get(code) || 0;
      log.postActionStockTotal = currentAfter;

      const delta = getLogNetStockDelta(log);
      const before = currentAfter - delta;
      runningStockByCode.set(code, Math.max(0, before));
    }

    setTransferLogs(logs);
  }, [currentCompanyId, getLogNetStockDelta, isSuperAdmin]);

  // Fetch data
  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch product codes for cihazGrubu reference
        const [productsSnap, brandsSnap] = await Promise.all([
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin, where('urunGrubu', '==', 'yedek_parca'))),
          getDocs(scopedQuery('def_brands', currentCompanyId, isSuperAdmin)),
        ]);
        const sparePartProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        const brands = brandsSnap.docs
          .map(d => String(d.data().name || '').trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'tr'));
        setProductCodes(sparePartProducts);
        setBrandOptions(brands);

        // Fetch depot stock - only products in the depot
        const stokSnap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
        const stokItems = filterByCompanyScope(stokSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as YedekParcaDepoStokItem;
        }), currentCompanyId, isSuperAdmin);
        setDepoStok(stokItems);

        // Fetch technicians and application specialists
        const usersSnap = await getDocs(scopedQuery('users', currentCompanyId, isSuperAdmin));
        const allUsers = filterByCompanyScope(
          usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User),
          currentCompanyId, isSuperAdmin
        );
        setUsers(allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon'));

        // Fetch pending returns (status === 'pending')
        const pendingQuery = scopedQuery(
          'pendingReturns',
          currentCompanyId,
          isSuperAdmin,
          where('status', '==', 'pending')
        );
        const pendingSnap = await getDocs(pendingQuery);
        const pending = filterByCompanyScope(pendingSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            requestedAt: data.requestedAt?.toDate ? data.requestedAt.toDate() : new Date(),
          } as PendingReturn;
        }), currentCompanyId, isSuperAdmin);
        pending.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        setPendingReturns(pending);

        // Fetch borrowed spare parts (status === 'pending')
        const borrowedQuery = query(
          collection(db, 'borrowedSpareParts'),
          where('status', '==', 'pending')
        );
        const borrowedSnap = await getDocs(borrowedQuery);
        const borrowed = filterByCompanyScope(borrowedSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            borrowedAt: data.borrowedAt?.toDate ? data.borrowedAt.toDate() : new Date(),
          };
        }), currentCompanyId, isSuperAdmin);
        borrowed.sort((a, b) => new Date(b.borrowedAt).getTime() - new Date(a.borrowedAt).getTime());
        setBorrowedParts(borrowed);

        // Fetch pool warehouses (depots with isPoolWarehouse = true)
        const depotsSnap = await getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin));
        const allDepots = filterByCompanyScope(
          depotsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Depot),
          currentCompanyId, isSuperAdmin
        );
        setPoolWarehouses(allDepots.filter(d => d.isPoolWarehouse === true));

        // Fetch recent transfer logs
        await loadRecentTransferLogs();
      } catch (err) {
        console.error('Error fetching data:', err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [loadRecentTransferLogs, isAuthorized, toast]);

  // Build grouped depot stock products (for transfer product selector)
  useEffect(() => {
    const productCodeMap = new Map<string, ProductCode>();
    productCodes.forEach(p => productCodeMap.set(p.id, p));

    const grouped = new Map<string, GroupedDepoStokItem>();

    for (const item of depoStok) {
      const key = `${item.stokKodu}|${(item.address || '').trim()}`;
      if (!grouped.has(key)) {
        const pc = productCodeMap.get(item.productCodeId);
        grouped.set(key, {
          productCodeId: item.productCodeId,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || pc?.anaBirim || 'Adet',
          cihazGrubu: item.cihazGrubu || pc?.cihazGrubu || '',
          totalQuantity: 0,
          earliestDate: item.createdAt,
          serialNumbers: [],
          entries: [],
        });
      }

      const g = grouped.get(key)!;
      g.totalQuantity += item.quantity;
      g.entries.push(item);

      if (item.serialNumber || item.hucreNumarasi) {
        g.serialNumbers.push({
          serialNumber: item.serialNumber || '',
          hucreNumarasi: item.hucreNumarasi || '',
          createdAt: item.createdAt,
          id: item.id,
          address: item.address || '',
        });
      }

      if (item.createdAt < g.earliestDate) {
        g.earliestDate = item.createdAt;
      }
    }

    const sorted = Array.from(grouped.values()).sort((a, b) => {
      const codeComp = a.stokKodu.localeCompare(b.stokKodu);
      if (codeComp !== 0) return codeComp;
      return (a.entries[0]?.address || '').localeCompare(b.entries[0]?.address || '');
    });
    setDepoStokProducts(sorted);
  }, [depoStok, productCodes]);

  // Fetch depo stok when selected
  const fetchDepoStok = useCallback(async () => {
    setDepoStokLoading(true);
    try {
      const stokSnap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
      const stokItems = filterByCompanyScope(stokSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        } as YedekParcaDepoStokItem;
      }), currentCompanyId, isSuperAdmin);
      stokItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setDepoStok(stokItems);
    } catch (err) {
      console.error('Error fetching depo stok:', err);
      toast({ title: 'Hata', description: 'Depo stok verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setDepoStokLoading(false);
    }
  }, [toast]);


  const downloadDepotStockExcel = useCallback(async () => {
    try {
      const XLSX = await import('xlsx');
      const exportRows = depoStok
        .map(item => ({
          'İşlem ID': item.id,
          'Stok Kodu': item.stokKodu,
          'Ürün Adı': item.stokAdi,
          'Seri No': item.serialNumber || '',
          'Adres': item.address || '',
          'Adet': item.quantity,
          'Giriş Tarihi': format(item.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr }),
        }))
        .sort((a, b) => a['Stok Kodu'].localeCompare(b['Stok Kodu']));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 32 }, { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Depo Stok');
      XLSX.writeFile(wb, `yedek_parca_depo_stok_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);

      toast({ title: 'Excel indirildi', description: `${exportRows.length} satır dışa aktarıldı.` });
    } catch (err) {
      console.error('Error exporting depot stock:', err);
      toast({ title: 'Hata', description: 'Depo stok excel dosyası oluşturulamadı.', variant: 'destructive' });
    }
  }, [depoStok, toast]);

  const handleDepotStockExcelUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

      if (!rows.length) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında güncellenecek satır bulunamadı.', variant: 'default' });
        return;
      }

      const mapById = new Map(depoStok.map(item => [item.id, item]));
      const batch = writeBatch(db);
      const now = new Date();
      let updatedCount = 0;

      for (const row of rows) {
        const id = String(row['İşlem ID'] || row['Islem ID'] || row['id'] || '').trim();
        if (!id) continue;

        const existing = mapById.get(id);
        if (!existing) continue;

        const nextAddress = String(row['Adres'] || '').trim();
        const parsedQty = Number(row['Adet']);
        const nextQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? Math.floor(parsedQty) : existing.quantity;

        const hasAddressChange = (existing.address || '') !== nextAddress;
        const hasQtyChange = existing.quantity !== nextQuantity;
        if (!hasAddressChange && !hasQtyChange) continue;

        batch.update(doc(db, 'yedekParcaDepoStok', existing.id), {
          quantity: nextQuantity,
          address: nextAddress,
        });

        const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
        batch.set(depoLogRef, withCompanyScope({
          action: 'stok_duzeltme',
          productCodeId: existing.productCodeId,
          stokKodu: existing.stokKodu,
          stokAdi: existing.stokAdi,
          anaBirim: existing.anaBirim || 'Adet',
          address: nextAddress,
          cihazGrubu: existing.cihazGrubu || '',
          serialNumber: existing.serialNumber || '',
          depoStokDocId: existing.id,
          quantity: Math.abs(nextQuantity - existing.quantity),
          entrySource: 'excel',
          notes: `[Excel] Stok güncelleme: adet ${existing.quantity} -> ${nextQuantity}, adres "${existing.address || '-'}" -> "${nextAddress || '-'}" (DocID: ${existing.id})`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));

        const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(transferLogRef, withCompanyScope({
          action: 'depo_stock_adjusted',
          productCodeId: existing.productCodeId,
          stokKodu: existing.stokKodu,
          stokAdi: existing.stokAdi,
          anaBirim: existing.anaBirim || 'Adet',
          serialNumber: existing.serialNumber || '',
          quantity: Math.abs(nextQuantity - existing.quantity),
          notes: `Excel ile güncellendi · adres: ${nextAddress || '-'}`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));

        updatedCount += 1;
      }

      if (updatedCount === 0) {
        toast({ title: 'Bilgi', description: 'Excel dosyasında değişiklik gerektiren satır bulunamadı.' });
      } else {
        await batch.commit();
        await fetchDepoStok();
        await loadRecentTransferLogs();
        toast({ title: 'Stok güncellendi', description: `${updatedCount} satır excel ile güncellendi.` });
      }
    } catch (err) {
      console.error('Error uploading depot stock excel:', err);
      toast({ title: 'Hata', description: 'Excel yükleme sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      if (depotExcelInputRef.current) depotExcelInputRef.current.value = '';
    }
  }, [depoStok, currentUserProfile?.name, currentUserProfile?.uid, fetchDepoStok, loadRecentTransferLogs, toast]);

  // Fetch personnel stock when personnel selected
  const fetchPersonnelStock = useCallback(async (uid: string) => {
    setPersonnelStockLoading(true);
    setPersonnelStockPage(0);
    setPersonnelStockFilter('all');
    try {
      const stockQuery = query(
        collection(db, 'personalStock'),
        where('ownerUid', '==', uid)
      );
      const stockSnap = await getDocs(stockQuery);
      const stockItems = filterByCompanyScope(stockSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          usedAt: data.usedAt?.toDate ? data.usedAt.toDate() : undefined,
        } as PersonalStockItem;
      }), currentCompanyId, isSuperAdmin);

      const usageLogQuery = query(
        collection(db, 'sparePartTransferLogs'),
        where('action', '==', 'use_on_device')
      );
      const usageSnap = await getDocs(usageLogQuery);
      const usageByPersonalStockId = new Map<string, { labName: string; deviceName: string }>();

      usageSnap.docs.forEach(d => {
        const data = d.data();
        const personalStockId = String(data.personalStockId || '').trim();
        if (!personalStockId) return;
        if (usageByPersonalStockId.has(personalStockId)) return;

        usageByPersonalStockId.set(personalStockId, {
          labName: String(data.labName || data.laboratoryName || '').trim(),
          deviceName: String(data.deviceName || '').trim(),
        });
      });

      const enrichedStockItems: PersonnelStockViewItem[] = stockItems
        .map(item => {
          const usage = usageByPersonalStockId.get(item.id);
          return {
            ...item,
            usageLabName: usage?.labName || '',
            usageDeviceName: usage?.deviceName || item.usedOnDeviceName || '',
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setPersonnelStock(enrichedStockItems);
    } catch (err) {
      console.error('Error fetching personnel stock:', err);
      toast({ title: 'Hata', description: 'Personel stok verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setPersonnelStockLoading(false);
    }
  }, [toast]);

  // Fetch all personnel stock for toplam stok view
  const fetchAllPersonnelStock = useCallback(async () => {
    setAllStockLoading(true);
    try {
      // Personnel stock (status = in_stock). Not dahil: pending_approval, çünkü onay
      // beklemeyen ürünler stoğa sayılmamalı (personel onaylamadığı ürünleri kendisine
      // ait saymıyor).
      const personalQuery = query(
        collection(db, 'personalStock'),
        where('status', '==', 'in_stock')
      );
      // Havuz depo stoğu - bu sayede ilgili ürünü depoya / havuza transfer eden
      // lojistik personeli de görebiliyor.
      const poolQuery = scopedQuery(
        'poolWarehouseStock',
        currentCompanyId,
        isSuperAdmin,
        where('status', '==', 'in_stock')
      );

      const [personalSnap, poolSnap] = await Promise.all([
        getDocs(personalQuery),
        getDocs(poolQuery),
      ]);

      const stockItems = filterByCompanyScope(personalSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        } as PersonalStockItem;
      }), currentCompanyId, isSuperAdmin);
      stockItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAllPersonnelStock(stockItems);

      const poolItems = filterByCompanyScope(poolSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        } as PoolWarehouseStockItem;
      }), currentCompanyId, isSuperAdmin);
      poolItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAllPoolStockAggregate(poolItems);
    } catch (err) {
      console.error('Error fetching all personnel stock:', err);
      toast({ title: 'Hata', description: 'Toplam stok verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setAllStockLoading(false);
    }
  }, [currentCompanyId, isSuperAdmin, toast]);

  // Fetch pool warehouse stock
  const fetchPoolStock = useCallback(async (poolWarehouseId: string) => {
    setPoolStockLoading(true);
    setPoolStockPage(0);
    setPoolStockFilter('all');
    try {
      const stockQuery = scopedQuery(
        'poolWarehouseStock',
        currentCompanyId,
        isSuperAdmin,
        where('poolWarehouseId', '==', poolWarehouseId)
      );
      const stockSnap = await getDocs(stockQuery);
      const stockItems = filterByCompanyScope(stockSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          usedAt: data.usedAt?.toDate ? data.usedAt.toDate() : undefined,
        } as PoolWarehouseStockItem;
      }), currentCompanyId, isSuperAdmin);
      stockItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPoolStock(stockItems);
    } catch (err) {
      console.error('Error fetching pool stock:', err);
      toast({ title: 'Hata', description: 'Havuz stok verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setPoolStockLoading(false);
    }
  }, [toast]);

  // Handle menu selection changes
  useEffect(() => {
    if (menuSelection.section === 'depo-stok') {
      fetchDepoStok();
    } else if (menuSelection.section === 'personnel' && menuSelection.personnelUid) {
      fetchPersonnelStock(menuSelection.personnelUid);
    } else if (menuSelection.section === 'toplam-stok') {
      fetchAllPersonnelStock();
    } else if (menuSelection.section === 'pool-stok' && menuSelection.poolWarehouseId) {
      fetchPoolStock(menuSelection.poolWarehouseId);
    }
  }, [menuSelection, fetchDepoStok, fetchPersonnelStock, fetchAllPersonnelStock, fetchPoolStock]);

  // Filtered products for search (from depo stock - only products that exist in depot)
  const filteredProducts = useMemo(() => {
    if (!productSearchQuery) return depoStokProducts.slice(0, 50);
    const q = productSearchQuery.toLowerCase();
    return depoStokProducts
      .filter(p =>
        (p.stokKodu?.toLowerCase().includes(q) || p.stokAdi?.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [depoStokProducts, productSearchQuery]);

  // Filtered users for search
  const filteredUsers = useMemo(() => {
    if (!userSearchQuery) return users;
    const q = userSearchQuery.toLowerCase();
    return users.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  }, [users, userSearchQuery]);

  // Get selected product details (from grouped depot stock)
  const selectedProduct = useMemo(() => {
    return depoStokProducts.find(p => p.stokKodu === selectedStokKodu);
  }, [depoStokProducts, selectedStokKodu]);

  // Get selected user details (or pool warehouse)
  const selectedUser = useMemo(() => {
    return users.find(u => u.uid === selectedUserId);
  }, [users, selectedUserId]);

  // Get selected transfer target (user or pool warehouse)
  const selectedTransferTarget = useMemo<TransferTarget | undefined>(() => {
    if (!selectedUserId) return undefined;
    // Check if it's a pool warehouse
    const pool = poolWarehouses.find(pw => pw.id === selectedUserId);
    if (pool) return { type: 'pool', id: pool.id, name: pool.name };
    // Otherwise it's a user
    const user = users.find(u => u.uid === selectedUserId);
    if (user) return { type: 'user', uid: user.uid || '', name: user.name || '', role: user.role };
    return undefined;
  }, [selectedUserId, users, poolWarehouses]);

  // Separate users by role
  const teknikServisUsers = useMemo(() => users.filter(u => u.role === 'teknik_servis'), [users]);
  const aplikasyonUsers = useMemo(() => users.filter(u => u.role === 'aplikasyon'), [users]);

  // Combined transfer targets (users + pool warehouses)
  type TransferTarget = { type: 'user'; uid: string; name: string; role: string } | { type: 'pool'; id: string; name: string };
  const allTransferTargets = useMemo<TransferTarget[]>(() => {
    const targets: TransferTarget[] = [];
    // Add pool warehouses first
    poolWarehouses.forEach(pw => {
      targets.push({ type: 'pool', id: pw.id, name: pw.name });
    });
    // Add users
    users.forEach(u => {
      targets.push({ type: 'user', uid: u.uid || '', name: u.name || '', role: u.role });
    });
    return targets;
  }, [users, poolWarehouses]);

  const filteredTransferTargets = useMemo(() => {
    if (!userSearchQuery) return allTransferTargets;
    const q = userSearchQuery.toLowerCase();
    return allTransferTargets.filter(t =>
      t.name.toLowerCase().includes(q)
    );
  }, [allTransferTargets, userSearchQuery]);

  const filteredPersonnelStock = useMemo(() => {
    let items = [...personnelStock];
    if (personnelStockFilter === 'used') {
      items = items.filter(s => s.status === 'used' || s.status === 'pending_return');
    } else if (personnelStockFilter === 'unused') {
      items = items.filter(s => s.status === 'in_stock');
    } else if (personnelStockFilter === 'pending_approval') {
      items = items.filter(s => s.status === 'pending_approval');
    }

    return items.sort((a, b) => {
      let dateA: number;
      let dateB: number;

      if (personnelStockSortKey === 'movement') {
        dateA = new Date(a.usedAt || a.createdAt).getTime();
        dateB = new Date(b.usedAt || b.createdAt).getTime();
      } else if (personnelStockSortKey === 'usedAt') {
        dateA = a.usedAt ? new Date(a.usedAt).getTime() : 0;
        dateB = b.usedAt ? new Date(b.usedAt).getTime() : 0;
      } else {
        dateA = new Date(a.createdAt).getTime();
        dateB = new Date(b.createdAt).getTime();
      }

      return personnelStockSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
  }, [personnelStock, personnelStockFilter, personnelStockSortKey, personnelStockSortOrder]);

  // Paginated personnel stock
  const paginatedPersonnelStock = useMemo(() => {
    const start = personnelStockPage * ITEMS_PER_PAGE;
    return filteredPersonnelStock.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPersonnelStock, personnelStockPage]);

  const totalPersonnelPages = Math.ceil(filteredPersonnelStock.length / ITEMS_PER_PAGE);

  // Pool stock filtering and pagination
  const filteredPoolStock = useMemo(() => {
    let items = [...poolStock];
    if (poolStockFilter === 'used') {
      items = items.filter(s => s.status === 'used');
    } else if (poolStockFilter === 'unused') {
      items = items.filter(s => s.status === 'in_stock');
    }

    return items.sort((a, b) => {
      let dateA: number;
      let dateB: number;

      if (poolStockSortKey === 'movement') {
        dateA = new Date(a.usedAt || a.createdAt).getTime();
        dateB = new Date(b.usedAt || b.createdAt).getTime();
      } else if (poolStockSortKey === 'usedAt') {
        dateA = a.usedAt ? new Date(a.usedAt).getTime() : 0;
        dateB = b.usedAt ? new Date(b.usedAt).getTime() : 0;
      } else {
        dateA = new Date(a.createdAt).getTime();
        dateB = new Date(b.createdAt).getTime();
      }

      return poolStockSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
  }, [poolStock, poolStockFilter, poolStockSortKey, poolStockSortOrder]);

  const paginatedPoolStock = useMemo(() => {
    const start = poolStockPage * ITEMS_PER_PAGE;
    return filteredPoolStock.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPoolStock, poolStockPage]);

  const totalPoolStockPages = Math.ceil(filteredPoolStock.length / ITEMS_PER_PAGE);

  // Filtered depo stok for the depo stok view (search by stok kodu, stok adı, seri numarası)
  const filteredDepoStok = useMemo(() => {
    if (!depoStokSearchQuery.trim()) return depoStokProducts;
    const q = depoStokSearchQuery.trim().toLowerCase();
    return depoStokProducts.filter(g =>
      g.stokKodu.toLowerCase().includes(q) ||
      g.stokAdi.toLowerCase().includes(q) ||
      g.serialNumbers.some(sn => sn.serialNumber.toLowerCase().includes(q) || (sn.hucreNumarasi || '').toLowerCase().includes(q))
    );
  }, [depoStokProducts, depoStokSearchQuery]);

  const totalDepoStokPages = Math.ceil(filteredDepoStok.length / DEPO_STOK_PER_PAGE);

  const paginatedDepoStok = useMemo(() => {
    const start = depoStokPage * DEPO_STOK_PER_PAGE;
    return filteredDepoStok.slice(start, start + DEPO_STOK_PER_PAGE);
  }, [filteredDepoStok, depoStokPage]);

  const hucreFormatRegex = /^[A-Za-z]\d{4}$/;

  // Handle serial/cell tracking change - if value entered, qty must be 1
  const handleTransferSerialChange = (value: string) => {
    setSerialNumber(value);
    if (value.trim()) {
      setTransferQuantity(1);
    }
  };

  const handleTransferHucreChange = (value: string) => {
    const normalized = value.toUpperCase();
    setHucreNumber(normalized);
    if (normalized.trim()) {
      setTransferQuantity(1);
    }
  };

  // Add row to transfer list
  const addTransferRow = useCallback(() => {
    if (!selectedProduct || !selectedTransferTarget) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün ve hedef seçin.', variant: 'destructive' });
      return;
    }

    const serialInput = serialNumber.trim();
    const hucreInput = hucreNumber.trim().toUpperCase();

    if (serialInput && hucreInput) {
      toast({ title: 'Uyarı', description: 'Lütfen Seri No veya Hücre No alanlarından sadece birini doldurun.', variant: 'default' });
      return;
    }

    if (hucreInput && !hucreFormatRegex.test(hucreInput)) {
      toast({ title: 'Geçersiz Format', description: 'Hücre numarası 1 harf + 4 rakam olmalıdır (örn: A1234).', variant: 'destructive' });
      return;
    }

    const selectedEntry = selectedProduct.serialNumbers.find(s =>
      (!!serialInput && s.serialNumber === serialInput) ||
      (!!hucreInput && (s.hucreNumarasi || '').toUpperCase() === hucreInput)
    );
    const isManualHucreInput = !!hucreInput && !selectedEntry;
    const resolvedSerial = selectedEntry?.serialNumber || serialInput;
    const resolvedHucre = selectedEntry?.hucreNumarasi || (isManualHucreInput ? hucreInput : '');
    const hasTrackingInput = !!serialInput || !!hucreInput;
    const qty = hasTrackingInput ? 1 : Math.max(1, Math.floor(transferQuantity));

    // Check for duplicate serial number in current rows
    if (hasTrackingInput && transferRows.some(r => (resolvedSerial && r.serialNumber === resolvedSerial) || (resolvedHucre && r.hucreNumarasi === resolvedHucre))) {
      toast({ title: 'Uyarı', description: 'Bu seri/hücre kaydı zaten listede var.', variant: 'default' });
      return;
    }

    // Check depot stock availability
    const alreadyInList = transferRows
      .filter(r => r.stokKodu === selectedProduct.stokKodu)
      .reduce((sum, r) => sum + r.quantity, 0);

    if (alreadyInList + qty > selectedProduct.totalQuantity) {
      toast({
        title: 'Yetersiz Stok',
        description: `Depoda ${selectedProduct.stokKodu} için ${selectedProduct.totalQuantity} adet var, listede zaten ${alreadyInList} adet mevcut.`,
        variant: 'destructive',
      });
      return;
    }

    // Manual hücre girişi (format doğruysa) depoda kayıtlı olmasa da kabul edilir
    if (serialInput && !selectedEntry) {
      toast({ title: 'Uyarı', description: 'Bu seri numarası depoda bulunamadı.', variant: 'default' });
      return;
    }

    const targetUid = selectedTransferTarget.type === 'user' ? selectedTransferTarget.uid : `pool_${selectedTransferTarget.id}`;
    const targetName = selectedTransferTarget.name;

    const newRow: SparePartTransferRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productCodeId: selectedProduct.productCodeId,
      stokKodu: selectedProduct.stokKodu,
      stokAdi: selectedProduct.stokAdi,
      anaBirim: selectedProduct.anaBirim || 'Adet',
      serialNumber: resolvedSerial,
      ...(resolvedHucre ? { hucreNumarasi: resolvedHucre } : {}),
      quantity: qty,
      cihazGrubu: selectedProduct.cihazGrubu,
      targetUid,
      targetName,
    };

    setTransferRows(prev => [...prev, newRow]);

    // Reset form
    setSerialNumber('');
    setHucreNumber('');
    setTransferQuantity(1);

    const label = hasTrackingInput
      ? (resolvedSerial && resolvedHucre
        ? `SN: ${resolvedSerial}, Hücre: ${resolvedHucre}`
        : resolvedSerial
          ? `SN: ${resolvedSerial}`
          : `Hücre: ${resolvedHucre}`)
      : `x${qty}`;
    toast({
      title: 'Eklendi',
      description: `${selectedProduct.stokAdi} (${label}) listeye eklendi.`,
    });
  }, [selectedProduct, serialNumber, hucreNumber, transferQuantity, selectedTransferTarget, transferRows, toast]);

  // Remove row from transfer list
  const removeTransferRow = (rowId: string) => {
    setTransferRows(prev => prev.filter(r => r.id !== rowId));
  };

  // Execute transfer - depodan düşüm + personele ekleme + log
  const executeTransfer = async () => {
    if (transferRows.length === 0) {
      toast({ title: 'Uyarı', description: 'Transfer edilecek ürün yok.', variant: 'default' });
      return;
    }

    setIsTransferring(true);

    try {
      const now = new Date();

      // Read fresh depot stock from Firestore to avoid stale state issues
      const freshStokSnap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
      const freshDepoStok = filterByCompanyScope(freshStokSnap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date() } as YedekParcaDepoStokItem;
      }), currentCompanyId, isSuperAdmin);

      // Verify all transfer items still exist in depot before proceeding
      for (const row of transferRows) {
        if (row.serialNumber || row.hucreNumarasi) {
          const exists = freshDepoStok.some(d => d.stokKodu === row.stokKodu && (
            (row.serialNumber && d.serialNumber === row.serialNumber) ||
            (row.hucreNumarasi && d.hucreNumarasi === row.hucreNumarasi)
          ));
          if (!exists && row.serialNumber) {
            throw new Error(`Depoda bulunamadı: ${row.stokKodu} (SN: ${row.serialNumber}). Stok başka biri tarafından transfer edilmiş olabilir.`);
          }
        } else {
          const available = freshDepoStok
            .filter(d => d.stokKodu === row.stokKodu && !d.serialNumber && !d.hucreNumarasi)
            .reduce((sum, d) => sum + d.quantity, 0);
          if (available < row.quantity) {
            throw new Error(`Yetersiz stok: ${row.stokKodu} için depoda ${available} adet var, ${row.quantity} adet isteniyor.`);
          }
        }
      }

      // Collect all batch operations, then split into chunks of max 400 to stay under Firestore 500-op limit
      type BatchOp = { type: 'set'; ref: ReturnType<typeof doc>; data: any } | { type: 'delete'; ref: ReturnType<typeof doc> } | { type: 'update'; ref: ReturnType<typeof doc>; data: any };
      const ops: BatchOp[] = [];

      for (const row of transferRows) {
        const isPoolTarget = row.targetUid.startsWith('pool_');
        const poolWarehouseId = isPoolTarget ? row.targetUid.replace('pool_', '') : '';

        if (row.serialNumber || row.hucreNumarasi) {
          // Tekil takipli: depodan ilgili seri/hücre kaydını bul ve sil
          const depoItem = freshDepoStok.find(
            d => d.stokKodu === row.stokKodu && (
              (row.serialNumber && d.serialNumber === row.serialNumber) ||
              (row.hucreNumarasi && d.hucreNumarasi === row.hucreNumarasi)
            )
          );
          if (depoItem) {
            ops.push({ type: 'delete', ref: doc(db, 'yedekParcaDepoStok', depoItem.id) });
          } else if (row.hucreNumarasi && !row.serialNumber) {
            const fallbackEntry = freshDepoStok
              .filter(d => d.stokKodu === row.stokKodu && !d.serialNumber && !d.hucreNumarasi)
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

            if (!fallbackEntry) {
              throw new Error(`Depoda stok bulunamadı: ${row.stokKodu} (Hücre: ${row.hucreNumarasi})`);
            }

            if (fallbackEntry.quantity <= 1) {
              ops.push({ type: 'delete', ref: doc(db, 'yedekParcaDepoStok', fallbackEntry.id) });
            } else {
              ops.push({ type: 'update', ref: doc(db, 'yedekParcaDepoStok', fallbackEntry.id), data: { quantity: fallbackEntry.quantity - 1 } });
            }
          }

          const hucreData = row.hucreNumarasi ? { hucreNumarasi: row.hucreNumarasi } : {};

          if (isPoolTarget) {
            const poolStockRef = doc(collection(db, 'poolWarehouseStock'));
            ops.push({ type: 'set', ref: poolStockRef, data: withCompanyScope({
              traceId: poolStockRef.id,
              poolWarehouseId,
              poolWarehouseName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              source: 'depot',
              status: 'in_stock',
              cihazGrubu: row.cihazGrubu || '',
              createdAt: Timestamp.fromDate(now),
              transferredByUid: currentUserProfile?.uid || '',
              transferredByName: currentUserProfile?.name || '',
            }, currentCompanyId) });

            ops.push({ type: 'set', ref: doc(collection(db, 'sparePartTransferLogs')), data: withCompanyScope({
              action: 'transfer_to_pool',
              poolStockId: poolStockRef.id,
              traceId: poolStockRef.id,
              poolWarehouseId,
              poolWarehouseName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              toName: row.targetName,
              quantity: 1,
              notes: `Tekil transfer: ${row.serialNumber || row.hucreNumarasi} -> Havuz: ${row.targetName}`,
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            }, currentCompanyId) });
          } else {
            const stockRef = doc(collection(db, 'personalStock'));
            ops.push({ type: 'set', ref: stockRef, data: withCompanyScope({
              traceId: stockRef.id,
              ownerUid: row.targetUid,
              ownerName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              source: 'depot',
              status: 'pending_approval',
              createdAt: Timestamp.fromDate(now),
              transferredByUid: currentUserProfile?.uid || '',
              transferredByName: currentUserProfile?.name || '',
            }, currentCompanyId) });

            ops.push({ type: 'set', ref: doc(collection(db, 'sparePartTransferLogs')), data: withCompanyScope({
              action: 'transfer_to_personnel',
              personalStockId: stockRef.id,
              traceId: stockRef.id,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              toUid: row.targetUid,
              toName: row.targetName,
              quantity: 1,
              notes: `Tekil transfer: ${row.serialNumber || row.hucreNumarasi} -> ${row.targetName}`,
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            }, currentCompanyId) });
          }

          // Depo log with companyScope
          ops.push({ type: 'set', ref: doc(collection(db, 'yedekParcaDepoLog')), data: withCompanyScope({
            action: 'transfer_cikis',
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            anaBirim: row.anaBirim || 'Adet',
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: row.serialNumber,
            ...hucreData,
            quantity: 1,
            relatedPersonnelUid: isPoolTarget ? undefined : row.targetUid,
            relatedPersonnelName: row.targetName,
            notes: isPoolTarget
              ? `Tekil transfer: ${row.serialNumber || row.hucreNumarasi} -> Havuz: ${row.targetName}`
              : `Tekil transfer: ${row.serialNumber || row.hucreNumarasi} -> ${row.targetName}`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId) });
        } else {
          // Seri numarasız: adetli transfer - use fresh data
          let remainingQty = row.quantity;
          const nonSerialEntries = freshDepoStok
            .filter(d => d.stokKodu === row.stokKodu && !d.serialNumber && !d.hucreNumarasi)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // FIFO

          for (const entry of nonSerialEntries) {
            if (remainingQty <= 0) break;

            if (entry.quantity <= remainingQty) {
              ops.push({ type: 'delete', ref: doc(db, 'yedekParcaDepoStok', entry.id) });
              remainingQty -= entry.quantity;
            } else {
              ops.push({ type: 'update', ref: doc(db, 'yedekParcaDepoStok', entry.id), data: { quantity: entry.quantity - remainingQty } });
              remainingQty = 0;
            }
          }

          if (remainingQty > 0) {
            throw new Error(`Yetersiz stok: ${row.stokKodu} için ${remainingQty} adet eksik. Stok başka biri tarafından değiştirilmiş olabilir.`);
          }

          if (isPoolTarget) {
            // Her stok dokümanı için ayrı log üret - Gözlem modalı
            // her parçayı poolStockId ile eşleştirebilsin.
            for (let i = 0; i < row.quantity; i++) {
              const poolStockRef = doc(collection(db, 'poolWarehouseStock'));
              ops.push({ type: 'set', ref: poolStockRef, data: withCompanyScope({
                traceId: poolStockRef.id,
                poolWarehouseId,
                poolWarehouseName: row.targetName,
                productCodeId: row.productCodeId,
                stokKodu: row.stokKodu,
                stokAdi: row.stokAdi,
                anaBirim: row.anaBirim || 'Adet',
                serialNumber: '',
                source: 'depot',
                status: 'in_stock',
                cihazGrubu: row.cihazGrubu || '',
                createdAt: Timestamp.fromDate(now),
                transferredByUid: currentUserProfile?.uid || '',
                transferredByName: currentUserProfile?.name || '',
              }, currentCompanyId) });

              ops.push({ type: 'set', ref: doc(collection(db, 'sparePartTransferLogs')), data: withCompanyScope({
                action: 'transfer_to_pool',
                poolStockId: poolStockRef.id,
                traceId: poolStockRef.id,
                poolWarehouseId,
                poolWarehouseName: row.targetName,
                productCodeId: row.productCodeId,
                stokKodu: row.stokKodu,
                stokAdi: row.stokAdi,
                anaBirim: row.anaBirim || 'Adet',
                serialNumber: '',
                toName: row.targetName,
                quantity: 1,
                notes: `Transfer (${i + 1}/${row.quantity}) -> Havuz: ${row.targetName}`,
                createdAt: Timestamp.fromDate(now),
                createdByUid: currentUserProfile?.uid || '',
                createdByName: currentUserProfile?.name || '',
              }, currentCompanyId) });
            }
          } else {
            for (let i = 0; i < row.quantity; i++) {
              const personalStockRef = doc(collection(db, 'personalStock'));
              ops.push({ type: 'set', ref: personalStockRef, data: withCompanyScope({
                traceId: personalStockRef.id,
                ownerUid: row.targetUid,
                ownerName: row.targetName,
                productCodeId: row.productCodeId,
                stokKodu: row.stokKodu,
                stokAdi: row.stokAdi,
                anaBirim: row.anaBirim || 'Adet',
                serialNumber: '',
                source: 'depot',
                status: 'pending_approval',
                createdAt: Timestamp.fromDate(now),
                transferredByUid: currentUserProfile?.uid || '',
                transferredByName: currentUserProfile?.name || '',
              }, currentCompanyId) });

              ops.push({ type: 'set', ref: doc(collection(db, 'sparePartTransferLogs')), data: withCompanyScope({
                action: 'transfer_to_personnel',
                personalStockId: personalStockRef.id,
                traceId: personalStockRef.id,
                productCodeId: row.productCodeId,
                stokKodu: row.stokKodu,
                stokAdi: row.stokAdi,
                anaBirim: row.anaBirim || 'Adet',
                serialNumber: '',
                toUid: row.targetUid,
                toName: row.targetName,
                quantity: 1,
                notes: `Transfer (${i + 1}/${row.quantity}) -> ${row.targetName}`,
                createdAt: Timestamp.fromDate(now),
                createdByUid: currentUserProfile?.uid || '',
                createdByName: currentUserProfile?.name || '',
              }, currentCompanyId) });
            }
          }

          // Depo log with companyScope
          ops.push({ type: 'set', ref: doc(collection(db, 'yedekParcaDepoLog')), data: withCompanyScope({
            action: 'transfer_cikis',
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            anaBirim: row.anaBirim || 'Adet',
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: '',
            quantity: row.quantity,
            relatedPersonnelUid: isPoolTarget ? undefined : row.targetUid,
            relatedPersonnelName: row.targetName,
            notes: isPoolTarget
              ? `${row.quantity} adet transfer -> Havuz: ${row.targetName}`
              : `${row.quantity} adet transfer -> ${row.targetName}`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId) });
        }
      }

      // Execute in chunked batches (max 400 ops per batch to stay under Firestore 500 limit)
      const BATCH_LIMIT = 400;
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const chunk = ops.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const op of chunk) {
          if (op.type === 'set') batch.set(op.ref, op.data);
          else if (op.type === 'delete') batch.delete(op.ref);
          else if (op.type === 'update') batch.update(op.ref, op.data);
        }
        await batch.commit();
      }

      // Send notifications to each recipient user (not pool warehouses)
      const personnelRows = transferRows.filter(r => !r.targetUid.startsWith('pool_'));
      const byUser = new Map<string, { targetName: string; items: { stokKodu: string; stokAdi: string; quantity: number }[] }>();
      for (const row of personnelRows) {
        if (!byUser.has(row.targetUid)) {
          byUser.set(row.targetUid, { targetName: row.targetName, items: [] });
        }
        byUser.get(row.targetUid)!.items.push({ stokKodu: row.stokKodu, stokAdi: row.stokAdi, quantity: row.quantity });
      }
      for (const [targetUid, data] of byUser) {
        emitSparePartTransfer({
          actor: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || '' },
          targetUid,
          targetName: data.targetName,
          items: data.items,
        }).catch(e => console.error('Spare part transfer notification error:', e));
      }

      // Emit external stock usage notification (Depot usage)
      for (const row of transferRows) {
        emitExternalStockUsage({
          actor: {
            uid: currentUserProfile?.uid || '',
            name: currentUserProfile?.name || currentUserProfile?.email || 'Bilinmeyen Kullanıcı',
          },
          sourceType: 'depot',
          sourceName: 'Merkez Depo',
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          serialNumber: row.serialNumber,
          quantity: row.quantity,
          deviceName: '—',
          hospitalName: row.targetName,
        }).catch(err => console.error('External stock usage notification error:', err));
      }

      const totalItems = transferRows.reduce((s, r) => s + r.quantity, 0);
      const hasPersonnelTargets = transferRows.some(r => !r.targetUid.startsWith('pool_'));
      toast({
        title: 'Transfer Tamamlandı',
        description: hasPersonnelTargets
          ? `${totalItems} adet yedek parça transfer edildi. Personel onayı bekleniyor.`
          : `${totalItems} adet yedek parça başarıyla transfer edildi.`,
      });

      setTransferRows([]);

      // Refresh depot stock
      const stokSnap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
      const stokItems = filterByCompanyScope(stokSnap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date() } as YedekParcaDepoStokItem;
      }), currentCompanyId, isSuperAdmin);
      setDepoStok(stokItems);

      // Refresh personnel stock if viewing a specific person
      if (menuSelection.personnelUid) {
        fetchPersonnelStock(menuSelection.personnelUid);
      }
      // Refresh all personnel stock view
      fetchAllPersonnelStock();

      // Refresh logs
      await loadRecentTransferLogs();
    } catch (err: any) {
      console.error('Error executing transfer:', err);
      const errorMessage = err?.message?.includes('Yetersiz stok') || err?.message?.includes('Depoda bulunamadı')
        ? err.message
        : 'Transfer sırasında hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.';
      toast({ title: 'Transfer Hatası', description: errorMessage, variant: 'destructive' });
      // Refresh depot stock to get latest state after error
      fetchDepoStok();
    } finally {
      setIsTransferring(false);
    }
  };

  const createManualStockRow = (): ManualPersonnelStockRow => ({
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stokKodu: '',
    stokAdi: '',
    serialNumber: '',
    quantity: 1,
  });

  const openManualStockModal = () => {
    setManualStockRows([createManualStockRow()]);
    setManualStockModalOpen(true);
  };

  const updateManualStockRow = (rowId: string, field: keyof Omit<ManualPersonnelStockRow, 'id'>, value: string | number) => {
    setManualStockRows(prev => prev.map(row => {
      if (row.id !== rowId) return row;
      if (field === 'quantity') {
        const parsed = Number(value);
        return { ...row, quantity: Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1 };
      }
      return { ...row, [field]: value };
    }));
  };

  const addManualStockRow = () => {
    setManualStockRows(prev => [...prev, createManualStockRow()]);
  };

  const removeManualStockRow = (rowId: string) => {
    setManualStockRows(prev => prev.length > 1 ? prev.filter(row => row.id !== rowId) : prev);
  };

  const saveManualPersonnelStock = async () => {
    if (!menuSelection.personnelUid || !menuSelection.personnelName) {
      toast({ title: 'Hata', description: 'Personel bilgisi bulunamadı.', variant: 'destructive' });
      return;
    }

    const cleanedRows = manualStockRows
      .map(row => ({
        ...row,
        stokKodu: row.stokKodu.trim(),
        stokAdi: row.stokAdi.trim(),
        serialNumber: row.serialNumber.trim(),
        quantity: Math.max(1, Math.floor(row.quantity || 1)),
      }))
      .filter(row => row.stokKodu || row.stokAdi || row.serialNumber);

    if (cleanedRows.length === 0) {
      toast({ title: 'Eksik Bilgi', description: 'En az bir stok satırı girin.', variant: 'destructive' });
      return;
    }

    const invalidRow = cleanedRows.find(row => !row.stokKodu || !row.stokAdi);
    if (invalidRow) {
      toast({ title: 'Eksik Bilgi', description: 'Stok kodu ve stok adı zorunludur.', variant: 'destructive' });
      return;
    }

    const invalidSerialQuantity = cleanedRows.find(row => row.serialNumber && row.quantity !== 1);
    if (invalidSerialQuantity) {
      toast({ title: 'Geçersiz Adet', description: 'Seri numaralı satırlarda adet 1 olmalıdır.', variant: 'destructive' });
      return;
    }

    setIsSavingManualStock(true);

    try {
      const now = Timestamp.fromDate(new Date());
      const batch = writeBatch(db);

      cleanedRows.forEach((row) => {
        const quantityToCreate = row.serialNumber ? 1 : row.quantity;
        const stockRefIds: string[] = [];
        for (let i = 0; i < quantityToCreate; i++) {
          const stockRef = doc(collection(db, 'personalStock'));
          stockRefIds.push(stockRef.id);
          batch.set(stockRef, withCompanyScope({
            traceId: stockRef.id,
            ownerUid: menuSelection.personnelUid,
            ownerName: menuSelection.personnelName,
            productCodeId: '',
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            anaBirim: row.anaBirim || 'Adet',
            serialNumber: row.serialNumber,
            source: 'manual',
            // Manuel eklemelerde de personelin onayı aranır; onaylanmayan ürün
            // doğrudan kullanıcının stoğuna dahil edilmez.
            status: 'pending_approval',
            createdAt: now,
            transferredByUid: currentUserProfile?.uid || '',
            transferredByName: currentUserProfile?.name || '',
            manualEntry: true,
          }, currentCompanyId));
        }

        const logNotes = row.serialNumber
          ? `[Manuel] Personele doğrudan eklendi: ${row.stokKodu} (SN: ${row.serialNumber}) -> ${menuSelection.personnelName}`
          : `[Manuel] Personele doğrudan eklendi: ${row.stokKodu} x${quantityToCreate} -> ${menuSelection.personnelName}`;

        const logRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(logRef, withCompanyScope({
          action: 'transfer_to_personnel',
          productCodeId: '',
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          anaBirim: row.anaBirim || 'Adet',
          serialNumber: row.serialNumber,
          toUid: menuSelection.personnelUid,
          toName: menuSelection.personnelName,
          quantity: quantityToCreate,
          personalStockDocIds: stockRefIds,
          createdAt: now,
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
          notes: logNotes,
          manualEntry: true,
          entrySource: 'manual',
        }, currentCompanyId));
      });

      await batch.commit();
      await fetchPersonnelStock(menuSelection.personnelUid);
      await fetchAllPersonnelStock();
      await loadRecentTransferLogs();

      const totalQuantity = cleanedRows.reduce((sum, row) => sum + (row.serialNumber ? 1 : row.quantity), 0);
      toast({
        title: 'Onaya Gönderildi',
        description: `${totalQuantity} adet stok ${menuSelection.personnelName} personeline manuel olarak gönderildi. Personel onaylayana kadar stokuna eklenmez.`,
      });

      setManualStockModalOpen(false);
      setManualStockRows([]);
    } catch (err) {
      console.error('Error saving manual personnel stock:', err);
      toast({ title: 'Hata', description: 'Manuel stok kaydı sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSavingManualStock(false);
    }
  };

  const openDepoQuantityEditor = (group: GroupedDepoStokItem) => {
    setEditingDepoGroup(group);
    setEditingQuantity(group.totalQuantity);
  };

  const saveDepoQuantityEdit = async () => {
    if (!editingDepoGroup) return;

    const serialCount = editingDepoGroup.serialNumbers.length;
    const minQuantity = serialCount;
    const nextTotal = Math.max(minQuantity, Math.floor(editingQuantity));
    const oldTotal = editingDepoGroup.totalQuantity;

    if (nextTotal === oldTotal) {
      setEditingDepoGroup(null);
      return;
    }

    setIsSavingDepoEdit(true);
    try {
      const now = new Date();
      const nonSerialEntries = editingDepoGroup.entries.filter(e => !e.serialNumber);
      const nextNonSerialTotal = nextTotal - serialCount;
      const batch = writeBatch(db);

      if (nextNonSerialTotal <= 0) {
        nonSerialEntries.forEach(entry => {
          batch.delete(doc(db, 'yedekParcaDepoStok', entry.id));
        });
      } else if (nonSerialEntries.length > 0) {
        const [first, ...rest] = nonSerialEntries;
        batch.update(doc(db, 'yedekParcaDepoStok', first.id), {
          quantity: nextNonSerialTotal,
        });
        rest.forEach(entry => {
          batch.delete(doc(db, 'yedekParcaDepoStok', entry.id));
        });
      } else {
        const stockRef = doc(collection(db, 'yedekParcaDepoStok'));
        batch.set(stockRef, withCompanyScope({
          productCodeId: editingDepoGroup.productCodeId,
          stokKodu: editingDepoGroup.stokKodu,
          stokAdi: editingDepoGroup.stokAdi,
          anaBirim: editingDepoGroup.anaBirim || 'Adet',
          serialNumber: '',
          quantity: nextNonSerialTotal,
          address: editingDepoGroup.entries.find(e => (e.address || '').trim())?.address || '',
          cihazGrubu: editingDepoGroup.cihazGrubu || '',
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      }

      const delta = nextTotal - oldTotal;

      const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
      batch.set(depoLogRef, withCompanyScope({
        action: 'stok_duzeltme',
        productCodeId: editingDepoGroup.productCodeId,
        stokKodu: editingDepoGroup.stokKodu,
        stokAdi: editingDepoGroup.stokAdi,
        anaBirim: editingDepoGroup.anaBirim || 'Adet',
        cihazGrubu: editingDepoGroup.cihazGrubu || '',
        serialNumber: '',
        address: editingDepoGroup.entries.find(e => (e.address || '').trim())?.address || '',
        quantity: Math.abs(delta),
        notes: `Depo stok adedi düzenlendi: ${oldTotal} -> ${nextTotal}`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, withCompanyScope({
        action: 'depo_stock_adjusted',
        productCodeId: editingDepoGroup.productCodeId,
        stokKodu: editingDepoGroup.stokKodu,
        stokAdi: editingDepoGroup.stokAdi,
          anaBirim: editingDepoGroup.anaBirim || 'Adet',
        serialNumber: '',
        address: editingDepoGroup.entries.find(e => (e.address || '').trim())?.address || '',
        quantity: Math.abs(delta),
        notes: `Depo stok adedi düzenlendi: ${oldTotal} -> ${nextTotal}`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      await batch.commit();
      setEditingDepoGroup(null);
      await fetchDepoStok();
      await loadRecentTransferLogs();

      toast({
        title: 'Stok Güncellendi',
        description: `${editingDepoGroup.stokKodu} için adet ${oldTotal} -> ${nextTotal} olarak güncellendi.`,
      });
    } catch (err) {
      console.error('Error updating depot stock quantity:', err);
      toast({ title: 'Hata', description: 'Depo stok adedi güncellenemedi.', variant: 'destructive' });
    } finally {
      setIsSavingDepoEdit(false);
    }
  };

  const deleteSerialFromDepot = async (group: GroupedDepoStokItem, serialEntry: { serialNumber: string; id: string }) => {
    if (!isAdmin) {
      toast({ title: 'Yetki Hatası', description: 'Bu işlem sadece admin kullanıcılar için izinlidir.', variant: 'destructive' });
      return;
    }

    try {
      const now = new Date();
      const batch = writeBatch(db);

      batch.delete(doc(db, 'yedekParcaDepoStok', serialEntry.id));

      const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
      batch.set(depoLogRef, withCompanyScope({
        action: 'stok_duzeltme',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        cihazGrubu: group.cihazGrubu || '',
        serialNumber: serialEntry.serialNumber,
        depoStokDocId: serialEntry.id,
        quantity: 1,
        notes: `Seri numaralı stok kaydı silindi: ${serialEntry.serialNumber} (DocID: ${serialEntry.id})`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, withCompanyScope({
        action: 'depo_serial_deleted',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        serialNumber: serialEntry.serialNumber,
        depoStokDocId: serialEntry.id,
        quantity: 1,
        notes: `Seri numaralı stok kaydı silindi: ${serialEntry.serialNumber} (DocID: ${serialEntry.id})`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      await batch.commit();
      await fetchDepoStok();
      await loadRecentTransferLogs();

      toast({
        title: 'Seri No Silindi',
        description: `${group.stokKodu} / ${serialEntry.serialNumber} depodan kaldırıldı.`,
      });
    } catch (err) {
      console.error('Error deleting serial from depot stock:', err);
      toast({ title: 'Hata', description: 'Seri numarası silinirken hata oluştu.', variant: 'destructive' });
    }
  };

  const deleteDepotStockGroup = async (group: GroupedDepoStokItem) => {
    if (!isAdmin) {
      toast({ title: 'Yetki Hatası', description: 'Bu işlem sadece admin kullanıcılar için izinlidir.', variant: 'destructive' });
      return;
    }

    const shouldDelete = window.confirm(`${group.stokKodu} kodlu stok kaydının tüm satırları silinsin mi? (${group.totalQuantity} adet)`);
    if (!shouldDelete) return;

    try {
      const now = new Date();
      const batch = writeBatch(db);

      group.entries.forEach((entry) => {
        batch.delete(doc(db, 'yedekParcaDepoStok', entry.id));
      });

      const deletedDocIds = group.entries.map(e => e.id);
      const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
      batch.set(depoLogRef, withCompanyScope({
        action: 'stok_silme_admin',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        cihazGrubu: group.cihazGrubu || '',
        serialNumber: '',
        address: group.entries.find(e => (e.address || '').trim())?.address || '',
        quantity: group.totalQuantity,
        deletedDocIds,
        notes: `Admin stok satırı silme: ${group.totalQuantity} adet kayıt kaldırıldı. Silinen DocIDs: ${deletedDocIds.join(', ')}`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, withCompanyScope({
        action: 'depo_stock_deleted_admin',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        serialNumber: '',
        quantity: group.totalQuantity,
        deletedDocIds,
        notes: `Admin stok satırı silme: ${group.totalQuantity} adet kayıt kaldırıldı`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      await batch.commit();
      await fetchDepoStok();
      await loadRecentTransferLogs();

      toast({
        title: 'Depo Stok Silindi',
        description: `${group.stokKodu} için ${group.totalQuantity} adet stok kaydı silindi.`,
      });
    } catch (err) {
      console.error('Error deleting depot stock group:', err);
      toast({ title: 'Hata', description: 'Depo stok satırı silinirken hata oluştu.', variant: 'destructive' });
    }
  };

  const deletePersonnelStockItem = async (item: PersonnelStockViewItem) => {
    if (!isAdmin && !isTeknikLojistik) {
      toast({ title: 'Yetki Hatası', description: 'Bu işlem için yetkiniz bulunmamaktadır.', variant: 'destructive' });
      return;
    }

    const isActiveStock = item.status === 'in_stock' || item.status === 'pending_approval';
    const confirmMessage = isActiveStock
      ? `${item.stokKodu} (${item.serialNumber || 'Seri No Yok'}) aktif stok kaydı silinecek ve ürün depoya iade edilecektir. Devam edilsin mi?`
      : `${item.stokKodu} (${item.serialNumber || 'Seri No Yok'}) personel stok kaydı silinsin mi?`;
    const shouldDelete = window.confirm(confirmMessage);
    if (!shouldDelete) return;

    try {
      const now = new Date();
      const batch = writeBatch(db);
      const stockRef = doc(db, 'personalStock', item.id);

      batch.delete(stockRef);

      // Active stock (in_stock or pending_approval): return to depot so stock is not lost
      if (isActiveStock) {
        const depoRef = doc(collection(db, 'yedekParcaDepoStok'));
        batch.set(depoRef, withCompanyScope({
          productCodeId: item.productCodeId,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || 'Adet',
          serialNumber: item.serialNumber || '',
          ...(item.hucreNumarasi ? { hucreNumarasi: item.hucreNumarasi } : {}),
          quantity: 1,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));

        const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
        batch.set(depoLogRef, withCompanyScope({
          action: 'iade_giris',
          productCodeId: item.productCodeId,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || 'Adet',
          serialNumber: item.serialNumber || '',
          quantity: 1,
          personalStockDocId: item.id,
          relatedPersonnelUid: item.ownerUid,
          relatedPersonnelName: item.ownerName,
          notes: `Personel stok silme ile depoya iade: ${item.ownerName} -> Depo (PersonalStockID: ${item.id})`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      }

      const logRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(logRef, withCompanyScope({
        action: 'personnel_stock_deleted_admin',
        personalStockId: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim || 'Adet',
        serialNumber: item.serialNumber || '',
        fromUid: item.ownerUid,
        fromName: item.ownerName,
        quantity: item.quantity || 1,
        returnedToDepot: isActiveStock,
        notes: isActiveStock
          ? `${isAdmin ? 'Admin' : 'Teknik Lojistik'} personel stok silme - ürün depoya iade edildi (PersonalStockID: ${item.id})`
          : `${isAdmin ? 'Admin' : 'Teknik Lojistik'} personel stok satırı silme işlemi (PersonalStockID: ${item.id})`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      await batch.commit();

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
      await fetchAllPersonnelStock();
      await fetchDepoStok();
      await loadRecentTransferLogs();

      toast({
        title: 'Personel Stok Kaydı Silindi',
        description: isActiveStock
          ? `${item.stokKodu} kaydı kaldırıldı, ürün depoya iade edildi.`
          : `${item.stokKodu} kaydı kaldırıldı.`,
      });
    } catch (err) {
      console.error('Error deleting personnel stock item:', err);
      toast({ title: 'Hata', description: 'Personel stok satırı silinirken hata oluştu.', variant: 'destructive' });
    }
  };

  const deletePoolStockItem = async (item: PoolWarehouseStockItem) => {
    if (!isAdmin && !isTeknikLojistik) {
      toast({ title: 'Yetki Hatası', description: 'Bu işlem için yetkiniz bulunmamaktadır.', variant: 'destructive' });
      return;
    }

    const shouldDelete = window.confirm(`${item.stokKodu} (${item.serialNumber || 'Seri No Yok'}) havuz stok kaydı silinsin mi?`);
    if (!shouldDelete) return;

    try {
      const now = new Date();
      await deleteDoc(doc(db, 'poolWarehouseStock', item.id));

      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: 'pool_stock_deleted_admin',
        poolStockId: item.id,
        poolWarehouseId: item.poolWarehouseId,
        poolWarehouseName: menuSelection.poolWarehouseName || '',
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim || 'Adet',
        serialNumber: item.serialNumber || '',
        quantity: item.quantity || 1,
        notes: `${isAdmin ? 'Admin' : 'Teknik Lojistik'} havuz stok satırı silme işlemi`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      if (menuSelection.poolWarehouseId) {
        await fetchPoolStock(menuSelection.poolWarehouseId);
      }
      await loadRecentTransferLogs();

      toast({ title: 'Havuz Stok Kaydı Silindi', description: `${item.stokKodu} kaydı kaldırıldı.` });
    } catch (err) {
      console.error('Error deleting pool stock item:', err);
      toast({ title: 'Hata', description: 'Havuz stok satırı silinirken hata oluştu.', variant: 'destructive' });
    }
  };

  // Confirm pending return
  const confirmPendingReturn = async (pendingReturn: PendingReturn) => {
    if (!canApproveDepotReturns) {
      toast({ title: 'Yetki Hatası', description: 'İade onayını yalnızca teknik lojistik veya admin kullanıcıları yapabilir.', variant: 'destructive' });
      return;
    }
    try {
      const now = new Date();

      // Update pending return as confirmed
      await updateDoc(doc(db, 'pendingReturns', pendingReturn.id), {
        status: 'confirmed',
        confirmedAt: Timestamp.fromDate(now),
        confirmedByUid: currentUserProfile?.uid || '',
        confirmedByName: currentUserProfile?.name || '',
      });

      // Update personal stock status
      await updateDoc(doc(db, 'personalStock', pendingReturn.personalStockId), {
        status: 'used',
      });

      // If return_to_depot, add back to depot stock
      if (pendingReturn.returnType === 'return_to_depot') {
        const pc = productCodes.find(p => p.id === pendingReturn.productCodeId);
        await addDoc(collection(db, 'yedekParcaDepoStok'), withCompanyScope({
          productCodeId: pendingReturn.productCodeId,
          stokKodu: pendingReturn.stokKodu,
          stokAdi: pendingReturn.stokAdi,
          anaBirim: pendingReturn.anaBirim || 'Adet',
          cihazGrubu: pc?.cihazGrubu || '',
          serialNumber: pendingReturn.serialNumber || '',
          address: '',
          quantity: 1,
          partCondition: pendingReturn.returnCondition || 'iyi',
          partConditionNote: pendingReturn.returnConditionNote || null,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));

        // Depo log for return
        await addDoc(collection(db, 'yedekParcaDepoLog'), withCompanyScope({
          action: 'iade_giris',
          productCodeId: pendingReturn.productCodeId,
          stokKodu: pendingReturn.stokKodu,
          stokAdi: pendingReturn.stokAdi,
          anaBirim: pendingReturn.anaBirim || 'Adet',
          cihazGrubu: pc?.cihazGrubu || '',
          serialNumber: pendingReturn.serialNumber || '',
          address: '',
          quantity: 1,
          relatedPersonnelUid: pendingReturn.ownerUid,
          relatedPersonnelName: pendingReturn.ownerName,
          notes: `İade teslim alındı: ${pendingReturn.ownerName} -> Depo (Durum: ${pendingReturn.returnCondition || 'iyi'}${pendingReturn.returnConditionNote ? `, Açıklama: ${pendingReturn.returnConditionNote}` : ''})`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      }

      // Create log entry
      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: pendingReturn.returnType === 'return_to_depot' ? 'return_confirmed' : 'submit_confirmed',
        personalStockId: pendingReturn.personalStockId,
        stokKodu: pendingReturn.stokKodu,
        stokAdi: pendingReturn.stokAdi,
          anaBirim: pendingReturn.anaBirim || 'Adet',
        serialNumber: pendingReturn.serialNumber,
        fromUid: pendingReturn.ownerUid,
        fromName: pendingReturn.ownerName,
        notes: `İade durumu: ${pendingReturn.returnCondition || 'iyi'}${pendingReturn.returnConditionNote ? ` (${pendingReturn.returnConditionNote})` : ''}`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      toast({
        title: 'Teslim Alındı',
        description: `${pendingReturn.stokAdi} (${pendingReturn.serialNumber || 'Seri No Yok'}) depoya teslim alındı (${pendingReturn.returnCondition || 'iyi'}).`,
      });

      setPendingReturns(prev => prev.filter(p => p.id !== pendingReturn.id));

      // Refresh depot stock
      fetchDepoStok();
    } catch (err) {
      console.error('Error confirming return:', err);
      toast({ title: 'Hata', description: 'İşlem sırasında hata oluştu.', variant: 'destructive' });
    }
  };

  // Initiate return to depot (by field personnel)
  const initiateReturn = async () => {
    if (!returnModalItem) return;

    // Arızalı veya miadı geçmiş ise açıklama zorunlu
    if ((returnCondition === 'arizali' || returnCondition === 'miad_gecmis') && !returnNote.trim()) {
      toast({
        title: 'Açıklama Gerekli',
        description: returnCondition === 'arizali'
          ? 'Arızalı parça için arıza açıklaması zorunludur.'
          : 'Miadı geçmiş parça için açıklama zorunludur.',
        variant: 'destructive',
      });
      return;
    }

    setIsReturning(true);
    try {
      const now = new Date();
      await addDoc(collection(db, 'pendingReturns'), withCompanyScope({
        personalStockId: returnModalItem.id,
        ownerUid: returnModalItem.ownerUid,
        ownerName: returnModalItem.ownerName,
        productCodeId: returnModalItem.productCodeId,
        stokKodu: returnModalItem.stokKodu,
        stokAdi: returnModalItem.stokAdi,
        anaBirim: returnModalItem.anaBirim || 'Adet',
        serialNumber: returnModalItem.serialNumber || '',
        source: returnModalItem.source,
        returnType: 'return_to_depot' as const,
        returnCondition,
        ...(returnNote.trim() ? { returnNote: returnNote.trim() } : {}),
        status: 'pending' as const,
        requestedAt: Timestamp.fromDate(now),
        requestedByUid: currentUserProfile?.uid || '',
        requestedByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      await updateDoc(doc(db, 'personalStock', returnModalItem.id), {
        status: 'pending_return',
      });

      setPersonnelStock(prev =>
        prev.map(s => s.id === returnModalItem.id ? { ...s, status: 'pending_return' as const } : s)
      );

      setReturnModalOpen(false);
      setReturnModalItem(null);
      setReturnCondition('iyi');
      setReturnNote('');
      toast({
        title: 'İade Talebi Gönderildi',
        description: `${returnModalItem.stokAdi} için iade talebi lojistik sorumlusuna iletildi.`,
      });
      await loadRecentTransferLogs();
    } catch (err) {
      console.error('Error initiating return:', err);
      toast({ title: 'Hata', description: 'İade talebi oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsReturning(false);
    }
  };

  // Approve borrowed part
  const approveBorrowedPart = async (borrowed: any) => {
    if (!isAdmin && !isTeknikLojistik) {
      toast({ title: 'Yetki Hatası', description: 'Borç onayını yalnızca teknik lojistik veya admin kullanıcıları yapabilir.', variant: 'destructive' });
      return;
    }

    try {
      const now = new Date();

      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'approved',
        approvedAt: Timestamp.fromDate(now),
        approvedByUid: currentUserProfile?.uid || '',
        approvedByName: currentUserProfile?.name || '',
      });

      if (borrowed.sourceType === 'depot') {
        await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
          action: 'use_on_device',
          borrowedPartId: borrowed.id,
          stokKodu: borrowed.stokKodu,
          stokAdi: borrowed.stokAdi,
          anaBirim: borrowed.anaBirim || 'Adet',
          serialNumber: borrowed.serialNumber,
          hucreNumarasi: borrowed.hucreNumarasi || '',
          quantity: borrowed.quantity || 1,
          deviceId: borrowed.deviceId,
          deviceName: borrowed.deviceName,
          labName: borrowed.labName,
          formId: borrowed.formId,
          formType: borrowed.formType,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
          approvedByUid: currentUserProfile?.uid || '',
          approvedByName: currentUserProfile?.name || '',
          usageImageUrl: borrowed.usedPartImageUrl || null,
        }, currentCompanyId));
      } else {
        await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
          action: 'borrowed_approved',
          stokKodu: borrowed.stokKodu,
          stokAdi: borrowed.stokAdi,
          anaBirim: borrowed.anaBirim || 'Adet',
          serialNumber: borrowed.serialNumber,
          deviceId: borrowed.deviceId,
          deviceName: borrowed.deviceName,
          borrowedByUid: borrowed.borrowedByUid,
          borrowedByName: borrowed.borrowedByName,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      }

      toast({
        title: 'Onaylandı',
        description: `${borrowed.stokAdi} (${borrowed.serialNumber || ''}) borç kaydı onaylandı.`,
      });

      setBorrowedParts(prev => prev.filter(b => b.id !== borrowed.id));
    } catch (err) {
      console.error('Error approving borrowed part:', err);
      toast({ title: 'Hata', description: 'İşlem sırasında hata oluştu.', variant: 'destructive' });
    }
  };

  // Reject borrowed part
  const rejectBorrowedPart = async (borrowed: any) => {
    if (!isAdmin && !isTeknikLojistik) {
      toast({ title: 'Yetki Hatası', description: 'Borç reddini yalnızca teknik lojistik veya admin kullanıcıları yapabilir.', variant: 'destructive' });
      return;
    }

    try {
      const now = new Date();

      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'rejected',
        rejectedAt: Timestamp.fromDate(now),
        rejectedByUid: currentUserProfile?.uid || '',
        rejectedByName: currentUserProfile?.name || '',
      });

      if (borrowed.sourceType === 'depot') {
        await addDoc(collection(db, 'yedekParcaDepoStok'), withCompanyScope({
          productCodeId: borrowed.productCodeId || '',
          stokKodu: borrowed.stokKodu,
          stokAdi: borrowed.stokAdi,
          anaBirim: borrowed.anaBirim || 'Adet',
          serialNumber: borrowed.serialNumber || '',
          hucreNumarasi: borrowed.hucreNumarasi || '',
          address: borrowed.depotAddress || '',
          quantity: borrowed.quantity || 1,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      }

      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: 'borrowed_rejected',
        stokKodu: borrowed.stokKodu,
        stokAdi: borrowed.stokAdi,
        anaBirim: borrowed.anaBirim || 'Adet',
        serialNumber: borrowed.serialNumber,
        deviceId: borrowed.deviceId,
        deviceName: borrowed.deviceName,
        borrowedByUid: borrowed.borrowedByUid,
        borrowedByName: borrowed.borrowedByName,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      toast({
        title: 'Reddedildi',
        description: `${borrowed.stokAdi} (${borrowed.serialNumber || ''}) borç kaydı reddedildi.`,
      });

      setBorrowedParts(prev => prev.filter(b => b.id !== borrowed.id));
    } catch (err) {
      console.error('Error rejecting borrowed part:', err);
      toast({ title: 'Hata', description: 'İşlem sırasında hata oluştu.', variant: 'destructive' });
    }
  };

  // Delete borrowed part (mistake/junk removal)
  const deleteBorrowedPart = async (borrowed: any) => {
    if (!isAdmin && !isTeknikLojistik) {
      toast({ title: 'Yetki Hatası', description: 'Borç kaydını silme yetkiniz bulunmamaktadır.', variant: 'destructive' });
      return;
    }

    const shouldDelete = window.confirm(`${borrowed.stokAdi} (${borrowed.serialNumber || 'Seri No Yok'}) borç kaydı silinsin mi?`);
    if (!shouldDelete) return;

    try {
      const now = new Date();
      await deleteDoc(doc(db, 'borrowedSpareParts', borrowed.id));

      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: 'borrowed_deleted_admin',
        borrowedPartId: borrowed.id,
        stokKodu: borrowed.stokKodu,
        stokAdi: borrowed.stokAdi,
        anaBirim: borrowed.anaBirim || 'Adet',
        serialNumber: borrowed.serialNumber,
        borrowedByUid: borrowed.borrowedByUid,
        borrowedByName: borrowed.borrowedByName,
        notes: `${isAdmin ? 'Admin' : 'Teknik Lojistik'} borç kaydı silme işlemi`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId));

      setBorrowedParts(prev => prev.filter(b => b.id !== borrowed.id));
      toast({ title: 'Borç Kaydı Silindi', description: `${borrowed.stokAdi} kaydı kaldırıldı.` });
    } catch (err) {
      console.error('Error deleting borrowed part:', err);
      toast({ title: 'Hata', description: 'Borç kaydı silinirken hata oluştu.', variant: 'destructive' });
    }
  };

  // Personnel-to-personnel transfer (owner initiates, target must approve)
  const sendPersonnelTransfer = async () => {
    if (!pTransferItem || !pTransferTargetUid || !pTransferTargetName) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen hedef personeli seçin.', variant: 'destructive' });
      return;
    }
    if (pTransferTargetUid === currentUserProfile?.uid) {
      toast({ title: 'Hata', description: 'Kendinize transfer yapamazsınız.', variant: 'destructive' });
      return;
    }

    // Find all in_stock records for same owner + stokKodu
    const availableItems = personnelStock.filter(
      s => s.status === 'in_stock' &&
        s.ownerUid === pTransferItem.ownerUid &&
        s.stokKodu === pTransferItem.stokKodu
    );
    const qty = Math.min(pTransferQuantity, availableItems.length);
    if (qty < 1) {
      toast({ title: 'Hata', description: 'Transfer edilecek ürün bulunamadı.', variant: 'destructive' });
      return;
    }

    setIsPersonnelTransferring(true);
    try {
      const now = new Date();
      const itemsToTransfer = availableItems.slice(0, qty);

      // Use transaction to verify each item is still in_stock before transferring
      await runTransaction(db, async (transaction) => {
        // First, read all items to verify their current status
        const snapshots = await Promise.all(
          itemsToTransfer.map(si => transaction.get(doc(db, 'personalStock', si.id)))
        );

        // Verify all items are still in_stock
        for (let i = 0; i < snapshots.length; i++) {
          const snap = snapshots[i];
          if (!snap.exists()) {
            throw new Error(`STOCK_NOT_FOUND:${itemsToTransfer[i].stokKodu}`);
          }
          const currentStatus = snap.data()?.status;
          if (currentStatus !== 'in_stock') {
            throw new Error(`INVALID_STATUS:${itemsToTransfer[i].stokKodu}:${currentStatus}`);
          }
        }

        // All items verified, proceed with transfer
        for (const si of itemsToTransfer) {
          transaction.update(doc(db, 'personalStock', si.id), {
            ownerUid: pTransferTargetUid,
            ownerName: pTransferTargetName,
            status: 'pending_approval',
            previousOwnerUid: si.ownerUid,
            previousOwnerName: si.ownerName,
            transferredByUid: currentUserProfile?.uid || '',
            transferredByName: currentUserProfile?.name || '',
            transferredAt: Timestamp.fromDate(now),
          });
        }

        // Transfer log (her stok kaydı için ayrı log)
        for (const si of itemsToTransfer) {
          const logRef = doc(collection(db, 'sparePartTransferLogs'));
          transaction.set(logRef, withCompanyScope({
            action: 'transfer_between_personnel',
            personalStockId: si.id,
            traceId: (si as any).traceId || si.id,
            productCodeId: si.productCodeId,
            stokKodu: si.stokKodu,
            stokAdi: si.stokAdi,
            anaBirim: si.anaBirim || 'Adet',
            serialNumber: si.serialNumber || '',
            quantity: 1,
            fromUid: si.ownerUid,
            fromName: si.ownerName,
            toUid: pTransferTargetUid,
            toName: pTransferTargetName,
            status: 'pending_approval',
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId));
        }
      });

      // Notifications
      emitSparePartTransfer({
        actor: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || '' },
        targetUid: pTransferTargetUid,
        targetName: pTransferTargetName,
        items: [{ stokKodu: pTransferItem.stokKodu, stokAdi: pTransferItem.stokAdi, quantity: qty }],
      }).catch(e => console.error('Personnel transfer notification error:', e));

      toast({
        title: 'Transfer Gönderildi',
        description: `${qty} adet ${pTransferItem.stokAdi}, ${pTransferTargetName} personelinin onayına gönderildi.`,
      });

      setPTransferModalOpen(false);
      setPTransferItem(null);
      setPTransferTargetUid('');
      setPTransferTargetName('');
      setPTransferQuantity(1);
      setPTransferSearchQuery('');

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
      await loadRecentTransferLogs();
    } catch (err: any) {
      console.error('Error sending personnel transfer:', err);
      if (err?.message?.startsWith('STOCK_NOT_FOUND:')) {
        toast({ title: 'Hata', description: 'Transfer edilecek ürünlerden biri artık mevcut değil. Lütfen sayfayı yenileyin.', variant: 'destructive' });
      } else if (err?.message?.startsWith('INVALID_STATUS:')) {
        toast({ title: 'Hata', description: 'Transfer edilecek ürünlerden biri başka bir işlemde kullanılmış. Lütfen sayfayı yenileyin.', variant: 'destructive' });
      } else {
        toast({ title: 'Hata', description: 'Transfer sırasında hata oluştu.', variant: 'destructive' });
      }
    } finally {
      setIsPersonnelTransferring(false);
    }
  };



  // Open observation modal for a single stock item (personal or pool).
  // Loads all transfer log entries related to this exact item so the user can
  // see exactly when / by whom the product arrived and every subsequent move.
  const openObservation = useCallback(async (params: {
    id: string;
    scope: 'personal' | 'pool';
    stokKodu: string;
    stokAdi: string;
    serialNumber?: string;
    hucreNumarasi?: string;
    ownerName?: string;
    poolWarehouseName?: string;
  }) => {
    setObservationItem({
      id: params.id,
      scope: params.scope,
      stokKodu: params.stokKodu,
      stokAdi: params.stokAdi,
      serialNumber: params.serialNumber,
      ownerName: params.ownerName,
      poolWarehouseName: params.poolWarehouseName,
    });
    setObservationOpen(true);
    setObservationLoading(true);
    setObservationLogs([]);

    try {
      const normalize = (v?: string) => String(v || '').trim();
      const serialNumber = normalize(params.serialNumber);
      const hucreNumarasi = normalize(params.hucreNumarasi);
      const idField = params.scope === 'personal' ? 'personalStockId' : 'poolStockId';
      const stockCollection = params.scope === 'personal' ? 'personalStock' : 'poolWarehouseStock';
      const stockSnap = await getDoc(doc(db, stockCollection, params.id));
      const traceId = stockSnap.exists()
        ? normalize((stockSnap.data() as any)?.traceId || params.id)
        : normalize(params.id);

      const toLog = (d: any, source: 'transfer' | 'depo' | 'snapshot') => {
        const data: any = d.data ? d.data() : d;
        const ts = data.createdAt?.toDate ? data.createdAt.toDate()
          : data.timestamp?.toDate ? data.timestamp.toDate()
          : data.usedAt?.toDate ? data.usedAt.toDate()
          : data.approvedAt?.toDate ? data.approvedAt.toDate()
          : data.requestedAt?.toDate ? data.requestedAt.toDate()
          : new Date();
        return { id: d.id || `snapshot-${params.id}`, ...data, _timestamp: ts, _source: source };
      };

      const logMap = new Map<string, any>();
      const pushLogs = (rows: any[]) => {
        rows.forEach((row) => {
          const key = `${row._source}:${row.id}`;
          if (!logMap.has(key)) logMap.set(key, row);
        });
      };

      const transferQueries = [
        scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where(idField, '==', params.id)),
      ];
      if (params.scope === 'personal') {
        transferQueries.push(scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('personalStockDocIds', 'array-contains', params.id)));
      }
      if (traceId) transferQueries.push(scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('traceId', '==', traceId)));
      if (serialNumber) transferQueries.push(scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('serialNumber', '==', serialNumber)));
      if (hucreNumarasi) transferQueries.push(scopedQuery('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('hucreNumarasi', '==', hucreNumarasi)));

      const depoQueries = [
        scopedQuery('yedekParcaDepoLog', currentCompanyId, isSuperAdmin, where('traceId', '==', traceId)),
      ];
      if (serialNumber) depoQueries.push(scopedQuery('yedekParcaDepoLog', currentCompanyId, isSuperAdmin, where('serialNumber', '==', serialNumber)));
      if (hucreNumarasi) depoQueries.push(scopedQuery('yedekParcaDepoLog', currentCompanyId, isSuperAdmin, where('hucreNumarasi', '==', hucreNumarasi)));

      for (const qRef of transferQueries) {
        const snap = await getDocs(qRef);
        pushLogs(snap.docs.map((d) => toLog(d, 'transfer')));
      }
      for (const qRef of depoQueries) {
        const snap = await getDocs(qRef);
        pushLogs(snap.docs.map((d) => toLog(d, 'depo')));
      }

      if (stockSnap.exists()) {
        const stockData: any = stockSnap.data();
        pushLogs([toLog({
          ...stockData,
          id: `snapshot-${params.id}`,
          action: 'stock_snapshot',
          notes: stockData.source === 'manual'
            ? `Stok kaydı manuel açıldı${stockData.createdByName ? ` (${stockData.createdByName})` : ''}.`
            : `Stok kaydı oluşturuldu${stockData.transferredByName ? ` (${stockData.transferredByName})` : ''}.`,
          quantity: stockData.quantity || 1,
          createdAt: stockData.createdAt || Timestamp.now(),
        }, 'snapshot')]);
      }

      let logs = Array.from(logMap.values());
      logs = filterByCompanyScope(logs, currentCompanyId, isSuperAdmin);

      const strictLogs = logs.filter((log: any) => {
        const sameStockDoc = log[idField] === params.id;
        if (sameStockDoc) return true;
        if (Array.isArray(log.personalStockDocIds) && log.personalStockDocIds.includes(params.id)) return true;
        const sameTrace = traceId && normalize(log.traceId) === traceId;
        if (sameTrace) return true;
        return false;
      });
      if (strictLogs.length > 0) {
        logs = strictLogs;
      } else if (serialNumber || hucreNumarasi) {
        logs = logs.filter((log: any) => {
          if (serialNumber) return normalize(log.serialNumber) === serialNumber;
          if (hucreNumarasi) return normalize(log.hucreNumarasi) === hucreNumarasi;
          return false;
        });
      } else {
        logs = [];
      }

      logs.sort((a: any, b: any) => new Date(a._timestamp).getTime() - new Date(b._timestamp).getTime());
      setObservationLogs(logs);
    } catch (err) {
      console.error('Error loading observation logs:', err);
      toast({ title: 'Hata', description: 'Ürün geçmişi yüklenirken hata oluştu.', variant: 'destructive' });
    } finally {
      setObservationLoading(false);
    }
  }, [currentCompanyId, isSuperAdmin, toast]);

  // Approve pending transfer (with status verification via transaction)
  const approveTransfer = async (item: PersonnelStockViewItem) => {
    try {
      const now = new Date();
      const stockRef = doc(db, 'personalStock', item.id);

      await runTransaction(db, async (transaction) => {
        const stockSnap = await transaction.get(stockRef);
        if (!stockSnap.exists()) {
          throw new Error('STOCK_NOT_FOUND');
        }
        const currentStatus = stockSnap.data()?.status;
        if (currentStatus !== 'pending_approval') {
          throw new Error(`INVALID_STATUS:${currentStatus}`);
        }

        transaction.update(stockRef, {
          status: 'in_stock',
          approvedAt: Timestamp.fromDate(now),
        });

        const logRef = doc(collection(db, 'sparePartTransferLogs'));
        transaction.set(logRef, withCompanyScope({
          action: 'transfer_approved',
          personalStockId: item.id,
          traceId: (item as any).traceId || item.id,
          productCodeId: item.productCodeId,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || 'Adet',
          serialNumber: item.serialNumber || '',
          toUid: item.ownerUid,
          toName: item.ownerName,
          quantity: 1,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentCompanyId));
      });

      toast({
        title: 'Onaylandı',
        description: `${item.stokAdi} (${item.serialNumber || item.stokKodu}) stoğunuza eklendi.`,
      });

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
    } catch (err: any) {
      console.error('Error approving transfer:', err);
      if (err?.message === 'STOCK_NOT_FOUND') {
        toast({ title: 'Hata', description: 'Bu stok kaydı artık mevcut değil. Sayfa yenileniyor...', variant: 'destructive' });
      } else if (err?.message?.startsWith('INVALID_STATUS:')) {
        toast({ title: 'Hata', description: 'Bu transfer zaten işlenmiş. Sayfa yenileniyor...', variant: 'destructive' });
      } else {
        toast({ title: 'Hata', description: 'Onaylama sırasında hata oluştu.', variant: 'destructive' });
      }
      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
    }
  };

  // Reject pending transfer - return to depot (with status verification via transaction)
  const rejectTransfer = async (item: PersonnelStockViewItem) => {
    const hasPreviousOwner = !!(item as any).previousOwnerUid;
    const returnLabel = hasPreviousOwner ? `${(item as any).previousOwnerName} adlı personele geri gönderilecektir` : 'depoya geri gönderilecektir';
    const shouldReject = window.confirm(`${item.stokKodu} (${item.serialNumber || 'Seri No Yok'}) transferini reddetmek istediğinize emin misiniz? Ürün ${returnLabel}.`);
    if (!shouldReject) return;

    try {
      const now = new Date();
      const stockRef = doc(db, 'personalStock', item.id);

      await runTransaction(db, async (transaction) => {
        // Re-read the document to verify current status
        const stockSnap = await transaction.get(stockRef);
        if (!stockSnap.exists()) {
          throw new Error('STOCK_NOT_FOUND');
        }
        const currentStatus = stockSnap.data()?.status;
        if (currentStatus !== 'pending_approval') {
          throw new Error(`INVALID_STATUS:${currentStatus}`);
        }

        if (hasPreviousOwner) {
          // Return to previous owner (personnel-to-personnel transfer rejected)
          transaction.update(stockRef, {
            ownerUid: (item as any).previousOwnerUid,
            ownerName: (item as any).previousOwnerName,
            status: 'in_stock',
            previousOwnerUid: null,
            previousOwnerName: null,
            transferredAt: null,
          });

          const logRef = doc(collection(db, 'sparePartTransferLogs'));
          transaction.set(logRef, withCompanyScope({
            action: 'transfer_rejected',
            personalStockId: item.id,
            traceId: (item as any).traceId || item.id,
            productCodeId: item.productCodeId,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            anaBirim: item.anaBirim || 'Adet',
            serialNumber: item.serialNumber || '',
            fromUid: item.ownerUid,
            fromName: item.ownerName,
            toUid: (item as any).previousOwnerUid,
            toName: (item as any).previousOwnerName,
            quantity: 1,
            notes: `Transfer reddedildi: ${item.ownerName} -> ${(item as any).previousOwnerName}`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId));
        } else {
          // Return to depot (lojistik → personnel transfer rejected)
          transaction.delete(stockRef);

          const depoRef = doc(collection(db, 'yedekParcaDepoStok'));
          transaction.set(depoRef, withCompanyScope({
            productCodeId: item.productCodeId,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            anaBirim: item.anaBirim || 'Adet',
            serialNumber: item.serialNumber || '',
            ...(item.hucreNumarasi ? { hucreNumarasi: item.hucreNumarasi } : {}),
            quantity: 1,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId));

          const logRef = doc(collection(db, 'sparePartTransferLogs'));
          transaction.set(logRef, withCompanyScope({
            action: 'transfer_rejected',
            personalStockId: item.id,
            productCodeId: item.productCodeId,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            anaBirim: item.anaBirim || 'Adet',
            serialNumber: item.serialNumber || '',
            fromUid: item.ownerUid,
            fromName: item.ownerName,
            quantity: 1,
            notes: 'Transfer personel tarafından reddedildi, ürün depoya iade edildi.',
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentCompanyId));

          const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
          transaction.set(depoLogRef, {
            action: 'iade_giris',
            productCodeId: item.productCodeId,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            anaBirim: item.anaBirim || 'Adet',
            serialNumber: item.serialNumber || '',
            quantity: 1,
            relatedPersonnelUid: item.ownerUid,
            relatedPersonnelName: item.ownerName,
            notes: `Transfer reddedildi: ${item.ownerName} -> Depo`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });
        }
      });

      toast({
        title: 'Reddedildi',
        description: hasPreviousOwner
          ? `${item.stokAdi} transferi reddedildi, ürün ${(item as any).previousOwnerName} adlı personele geri gönderildi.`
          : `${item.stokAdi} (${item.serialNumber || item.stokKodu}) transferi reddedildi, ürün depoya iade edildi.`,
      });

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
      await loadRecentTransferLogs();
    } catch (err: any) {
      console.error('Error rejecting transfer:', err);
      if (err?.message === 'STOCK_NOT_FOUND') {
        toast({ title: 'Hata', description: 'Bu stok kaydı artık mevcut değil. Sayfa yenileniyor...', variant: 'destructive' });
      } else if (err?.message?.startsWith('INVALID_STATUS:')) {
        toast({ title: 'Hata', description: 'Bu transfer zaten işlenmiş (onaylanmış veya reddedilmiş). Sayfa yenileniyor...', variant: 'destructive' });
      } else {
        toast({ title: 'Hata', description: 'Reddetme sırasında hata oluştu.', variant: 'destructive' });
      }
      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
    }
  };

  // Action labels for logs
  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      transfer_to_personnel: 'Personele Transfer',
      use_on_device: 'Cihazda Kullanıldı',
      return_to_depot: 'Depoya İade',
      submit_to_depot: 'Depoya Teslim',
      return_confirmed: 'İade Teslim Alındı',
      submit_confirmed: 'Teslim Alındı',
      borrowed_part: 'Borç Parça Kullanıldı',
      borrowed_approved: 'Borç Onaylandı',
      borrowed_rejected: 'Borç Reddedildi',
      depo_stock_adjusted: 'Depo Stok Güncellendi',
      depo_serial_deleted: 'Depo Seri No Silindi',
      stok_giris: 'Depo Stok Girişi',
      transfer_cikis: 'Depodan Çıkış',
      iade_giris: 'Depoya İade Girişi',
      stok_duzeltme: 'Depo Stok Düzeltme',
      stok_silme_admin: 'Depo Stok Silme',
      transfer_between_personnel: 'Personelden Personele Devir',
      depo_stock_deleted_admin: 'Admin Depo Stok Silme',
      personnel_stock_deleted_admin: 'Admin Personel Stok Silme',
      pool_stock_deleted_admin: 'Admin Havuz Stok Silme',
      transfer_approved: 'Transfer Onaylandı',
      transfer_rejected: 'Transfer Reddedildi',
    };
    return labels[action] || action;
  };

  const filteredHistoryLogs = useMemo(() => {
    const query = historySearchQuery.trim().toLocaleLowerCase('tr-TR');
    return transferLogs.filter((log) => {
      const matchesAction = historyActionFilter === 'all' || log.action === historyActionFilter;
      if (!matchesAction) return false;
      if (!query) return true;

      const haystack = [
        log.stokKodu,
        log.stokAdi,
        log.serialNumber,
        log.hucreNumarasi,
        log.fromName,
        log.toName,
        log.createdByName,
        log.notes,
      ]
        .map(v => String(v || '').toLocaleLowerCase('tr-TR'))
        .join(' ');

      return haystack.includes(query);
    });
  }, [historyActionFilter, historySearchQuery, transferLogs]);

  useEffect(() => {
    setHistoryPage(0);
  }, [historyActionFilter, historySearchQuery, historyPageSize]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistoryLogs.length / historyPageSize));

  useEffect(() => {
    if (historyPage > totalHistoryPages - 1) {
      setHistoryPage(Math.max(0, totalHistoryPages - 1));
    }
  }, [historyPage, totalHistoryPages]);

  const paginatedHistoryLogs = useMemo(() => {
    const safePage = Math.min(historyPage, Math.max(0, totalHistoryPages - 1));
    const start = safePage * historyPageSize;
    return filteredHistoryLogs.slice(start, start + historyPageSize);
  }, [filteredHistoryLogs, historyPage, historyPageSize, totalHistoryPages]);

  // Transfer panel tab state
  const [transferTab, setTransferTab] = useState<'transfer' | 'borrowed' | 'pending' | 'history'>('transfer');

  // ========== RENDER: Transfer Panel (Right Side Default) ==========
  const renderTransferPanel = () => (
    <div className="space-y-4">
      {/* Header */}
      <div className="cihaz-card-strong p-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,.12)' }}>
            <Send className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>Transfer Paneli</h2>
            <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Depodaki ürünleri personele transfer edin.</p>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="cihaz-pressed inline-flex p-1 gap-0.5 flex-wrap" style={{ borderRadius: 14 }}>
        {([
          { key: 'transfer' as const, label: 'Transfer', icon: <Send className="w-3 h-3" /> },
          { key: 'borrowed' as const, label: `Borç (${borrowedParts.length})`, icon: <HandCoins className="w-3 h-3" /> },
          { key: 'pending' as const, label: `Depoda İade Bekleyenler (${pendingReturns.length})`, icon: <Clock className="w-3 h-3" /> },
          { key: 'history' as const, label: 'Geçmiş', icon: <History className="w-3 h-3" /> },
        ]).map(tab => {
          const isActive = transferTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setTransferTab(tab.key)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
              style={{
                background: isActive ? 'var(--dashboard-surface)' : 'transparent',
                color: isActive ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Transfer tab ── */}
      {transferTab === 'transfer' && (
        <div className="space-y-3">
          {/* Add form */}
          <div className="cihaz-card p-4 space-y-3">
            <p className="cihaz-section-label">Yeni Transfer</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Product selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Yedek Parça *</label>
                <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                  <PopoverTrigger asChild>
                    <button className="cihaz-pressed w-full flex items-center justify-between px-3 py-2.5 text-xs text-left" style={{ borderRadius: 12, color: selectedProduct ? 'var(--dashboard-text)' : 'var(--dashboard-muted)' }}>
                      <span className="truncate">{selectedProduct ? `${selectedProduct.stokKodu} — ${selectedProduct.stokAdi?.substring(0, 20)} (${selectedProduct.totalQuantity})` : 'Depodaki ürünlerden seçin…'}</span>
                      <Search className="w-3.5 h-3.5 flex-shrink-0 ml-2 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0">
                    <Command>
                      <CommandInput placeholder="Kod veya isim ile ara…" value={productSearchQuery} onValueChange={setProductSearchQuery} />
                      <CommandList>
                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {filteredProducts.map(product => (
                            <CommandItem key={product.stokKodu} value={`${product.stokKodu} ${product.stokAdi}`} onSelect={() => { setSelectedStokKodu(product.stokKodu); setProductSearchOpen(false); setSerialNumber(''); setHucreNumber(''); setTransferQuantity(1); }}>
                              <div className="flex flex-col flex-1">
                                <div className="flex items-center justify-between"><span className="font-mono font-medium text-sm">{product.stokKodu}</span><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(107,114,128,.10)', color: 'var(--dashboard-muted)' }}>{product.totalQuantity} ad</span></div>
                                <span className="text-xs text-muted-foreground truncate">{product.stokAdi}</span>
                                {product.anaBirim && <span className="text-[10px]" style={{ color: 'var(--dashboard-accent)' }}>{product.anaBirim.toLocaleLowerCase('tr-TR')}</span>}
                                {product.cihazGrubu && <span className="text-[10px]" style={{ color: 'var(--dashboard-accent)' }}>{product.cihazGrubu}</span>}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedProduct?.anaBirim && <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-accent)' }}>{selectedProduct.anaBirim.toLocaleLowerCase('tr-TR')}</p>}
                {selectedProduct?.cihazGrubu && <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-accent)' }}>{selectedProduct.cihazGrubu}</p>}
              </div>

              {/* Target selector (Users + Pool Warehouses) */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Hedef *</label>
                <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                  <PopoverTrigger asChild>
                    <button className="cihaz-pressed w-full flex items-center justify-between px-3 py-2.5 text-xs text-left" style={{ borderRadius: 12, color: selectedTransferTarget ? 'var(--dashboard-text)' : 'var(--dashboard-muted)' }}>
                      <span className="truncate flex items-center gap-1.5">
                        {selectedTransferTarget ? (
                          <>
                            {selectedTransferTarget.type === 'pool' && <Database className="w-3 h-3 text-purple-600 shrink-0" />}
                            {selectedTransferTarget.name}
                          </>
                        ) : 'Personel veya havuz depo seçin…'}
                      </span>
                      <Search className="w-3.5 h-3.5 flex-shrink-0 ml-2 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-0">
                    <Command>
                      <CommandInput placeholder="İsim ile ara…" value={userSearchQuery} onValueChange={setUserSearchQuery} />
                      <CommandList>
                        <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
                        {filteredTransferTargets.some(t => t.type === 'pool') && (
                          <CommandGroup heading="Havuz Depolar">
                            {filteredTransferTargets.filter(t => t.type === 'pool').map(target => (
                              <CommandItem key={`pool_${(target as any).id}`} value={`havuz ${target.name}`} onSelect={() => { setSelectedUserId((target as any).id); setUserSearchOpen(false); }}>
                                <div className="flex items-center gap-2">
                                  <Database className="h-3.5 w-3.5 text-purple-600" />
                                  <span className="font-medium text-sm">{target.name}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">Havuz</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        <CommandGroup heading="Personel">
                          {filteredTransferTargets.filter(t => t.type === 'user').map(target => {
                            const t = target as { type: 'user'; uid: string; name: string; role: string };
                            return (
                              <CommandItem key={t.uid} value={`${t.name} ${t.role}`} onSelect={() => { setSelectedUserId(t.uid); setUserSearchOpen(false); }}>
                                <div className="flex flex-col"><span className="font-medium text-sm">{t.name}</span><span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{t.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}</span></div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Serial + Qty + Add */}
            {selectedProduct && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Seri No (Opsiyonel)</label>
                  <div className="flex gap-1.5">
                    <Input placeholder="Seri no" value={serialNumber} onChange={(e) => handleTransferSerialChange(e.target.value)} className="cihaz-pressed !border-0 !ring-0 h-9 text-xs flex-1" style={{ borderRadius: 10 }} />
                    {selectedProduct.serialNumbers.length > 0 && (
                      <Popover open={serialSelectOpen} onOpenChange={setSerialSelectOpen}>
                        <PopoverTrigger asChild>
                          <button className="cihaz-tool-item px-2 py-1 text-[10px] font-medium flex-shrink-0" style={{ color: 'var(--dashboard-text)' }}>
                            <List className="w-3 h-3 inline mr-0.5" /> {selectedProduct.serialNumbers.length}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[320px] p-0">
                          <Command>
                            <CommandInput placeholder="Seri/Hücre ara…" />
                            <CommandList>
                              <CommandEmpty>Bulunamadı.</CommandEmpty>
                              <CommandGroup heading={`${selectedProduct.stokKodu}`}>
                                {selectedProduct.serialNumbers.filter(sn => !transferRows.some(r => (sn.serialNumber && r.serialNumber === sn.serialNumber) || (sn.hucreNumarasi && r.hucreNumarasi === sn.hucreNumarasi))).map(sn => (
                                  <CommandItem key={sn.id} value={sn.serialNumber || sn.hucreNumarasi || sn.id} onSelect={() => { setSerialNumber(sn.serialNumber || ''); setHucreNumber(sn.hucreNumarasi || ''); setTransferQuantity(1); setSerialSelectOpen(false); }}>
                                    <div className="flex flex-col">
                                      <span className="font-mono font-medium text-xs">{sn.serialNumber || '—'}{sn.hucreNumarasi ? ` · Hücre: ${sn.hucreNumarasi}` : ''}</span>
                                      <span className="text-[10px] text-muted-foreground">{format(sn.createdAt, 'dd.MM.yyyy', { locale: tr })}</span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Hücre No</label>
                  <Input placeholder="Örn: A1234" value={hucreNumber} onChange={(e) => handleTransferHucreChange(e.target.value)} className="cihaz-pressed !border-0 !ring-0 h-9 text-xs" style={{ borderRadius: 10 }} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Adet</label>
                  <Input type="number" min={1} max={selectedProduct.totalQuantity} value={(serialNumber.trim() || hucreNumber.trim()) ? 1 : transferQuantity} onChange={(e) => setTransferQuantity(Math.max(1, parseInt(e.target.value) || 1))} disabled={!!serialNumber.trim() || !!hucreNumber.trim()} className="cihaz-pressed !border-0 !ring-0 h-9 text-xs" style={{ borderRadius: 10 }} />
                  <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{(serialNumber.trim() || hucreNumber.trim()) ? 'Tekil takip (seri/hücre) → adet 1 · Hücre formatı: 1 harf + 4 rakam' : `Depoda: ${selectedProduct.totalQuantity}`}</p>
                </div>
                <div className="flex items-end">
                  <button onClick={addTransferRow} disabled={!selectedStokKodu || !selectedUserId} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'var(--dashboard-accent)' }}>
                    <Plus className="w-3.5 h-3.5" /> Sepete Ekle
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Transfer basket */}
          {transferRows.length > 0 ? (
            <div className="cihaz-card-strong overflow-hidden">
              <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>Transfer Sepeti</p>
                <span className="cihaz-pressed px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 8, color: 'var(--dashboard-text)' }}>{transferRows.length} satır · {transferRows.reduce((s, r) => s + r.quantity, 0)} adet</span>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                {transferRows.map(row => (
                  <div key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>{row.stokAdi}</p>
                      <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>{row.stokKodu} {row.serialNumber ? `· SN: ${row.serialNumber}` : ''}</p>
                    </div>
                    <span className="text-xs font-bold" style={{ color: 'var(--dashboard-text)' }}>x{row.quantity} {row.anaBirim ? row.anaBirim.toLocaleLowerCase('tr-TR') : 'adet'}</span>
                    <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>→ {row.targetName}</span>
                    <button onClick={() => removeTransferRow(row.id)} className="p-1 rounded-lg hover:bg-black/5"><Trash2 className="w-3 h-3" style={{ color: '#B91C1C' }} /></button>
                  </div>
                ))}
              </div>
              <div className="p-3 flex justify-end" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                <button onClick={executeTransfer} disabled={isTransferring} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: 'var(--dashboard-accent)', boxShadow: 'var(--dashboard-raised-soft)' }}>
                  {isTransferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Transfer Et
                </button>
              </div>
            </div>
          ) : (
            <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}>
              <Send className="w-10 h-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">Henüz transfer edilecek ürün eklenmedi.</p>
              <p className="text-xs mt-1">Yukarıdan ürün + personel seçerek sepete ekleyin.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Borrowed tab ── */}
      {transferTab === 'borrowed' && (
        <div className="space-y-2">
          {borrowedParts.length === 0 ? (
            <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}><HandCoins className="w-10 h-10 mx-auto mb-2 opacity-20" /><p className="text-sm font-medium">Onay bekleyen borç yok.</p></div>
          ) : borrowedParts.map(item => (
            <article key={item.id} className="cihaz-card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>{item.stokAdi}</p>
                <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>{item.stokKodu} {item.serialNumber ? `· SN: ${item.serialNumber}` : ''}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>{item.deviceName} · {item.labName} · {item.borrowedByName}</p>
                <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{format(item.borrowedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(isAdmin || isTeknikLojistik) && (
                  <>
                    <button onClick={() => approveBorrowedPart(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white transition-all hover:opacity-90 active:scale-95" style={{ background: '#16A34A' }}><CheckCircle className="w-3 h-3" /> Onayla</button>
                    <button onClick={() => rejectBorrowedPart(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white transition-all hover:opacity-90 active:scale-95" style={{ background: '#B91C1C' }}><XCircle className="w-3 h-3" /> Reddet</button>
                    <button onClick={() => deleteBorrowedPart(item)} className="p-1.5 rounded-lg hover:bg-black/5 transition-all active:scale-95" title="Borç Kaydını Sil">
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#B91C1C' }} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Pending returns tab ── */}
      {transferTab === 'pending' && (
        <div className="space-y-2">
          {pendingReturns.length === 0 ? (
            <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}><CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" /><p className="text-sm font-medium">Bekleyen iade yok.</p></div>
          ) : pendingReturns.map(item => (
            <article key={item.id} className="cihaz-card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>{item.stokAdi}</p>
                <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>{item.stokKodu} {item.serialNumber ? `· SN: ${item.serialNumber}` : ''}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{item.ownerName}</span>
                  <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: item.returnType === 'return_to_depot' ? 'rgba(22,163,74,.10)' : 'rgba(107,114,128,.10)', color: item.returnType === 'return_to_depot' ? '#16A34A' : 'var(--dashboard-muted)' }}>
                    {item.returnType === 'return_to_depot' ? 'İade (Yeni)' : 'Teslim (Çıkma)'}
                  </span>
                  {item.returnCondition && (
                    <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{
                      background: item.returnCondition === 'iyi' ? 'rgba(22,163,74,.1)' : item.returnCondition === 'miad_gecmis' ? 'rgba(217,119,6,.1)' : 'rgba(185,28,28,.1)',
                      color: item.returnCondition === 'iyi' ? '#16A34A' : item.returnCondition === 'miad_gecmis' ? '#D97706' : '#B91C1C',
                    }}>
                      {item.returnCondition === 'iyi' ? 'İyi' : item.returnCondition === 'miad_gecmis' ? 'Miadı Geçmiş' : 'Arızalı'}
                    </span>
                  )}
                  {(item as any).returnNote && (
                    <span className="text-[10px] italic" style={{ color: 'var(--dashboard-muted)' }}>— {(item as any).returnNote}</span>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{format(item.requestedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--dashboard-muted)' }}>
                  Durum: <span className="font-semibold">{item.returnCondition || 'iyi'}</span>
                  {item.returnConditionNote ? ` · ${item.returnConditionNote}` : ''}
                </p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {item.imageUrl && <button onClick={() => setPreviewImage(item.imageUrl!)} className="cihaz-tool-item p-1.5"><ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} /></button>}
                {canApproveDepotReturns && (
                  <button onClick={() => confirmPendingReturn(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white" style={{ background: '#16A34A' }}><CheckCircle className="w-3 h-3" /> Teslim Al</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── History tab ── */}
      {transferTab === 'history' && (
        <div className="space-y-3">
          {transferLogs.length === 0 ? (
            <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}><History className="w-10 h-10 mx-auto mb-2 opacity-20" /><p className="text-sm font-medium">Henüz geçmiş yok.</p></div>
          ) : (
            <>
              {/* Filter */}
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Filtre:</label>
                <select
                  className="cihaz-pressed px-3 py-1.5 text-xs font-medium !border-0 !ring-0"
                  style={{ borderRadius: 10, color: 'var(--dashboard-text)', background: 'var(--dashboard-pressed, var(--dashboard-surface-2))' }}
                  value={historyActionFilter}
                  onChange={(e) => setHistoryActionFilter(e.target.value)}
                >
                  <option value="all">Tümü</option>
                  <option value="stok_giris">Depo Stok Girişi</option>
                  <option value="stok_duzeltme">Depo Stok Düzeltme</option>
                  <option value="transfer_cikis">Depodan Çıkış</option>
                  <option value="iade_giris">Depoya İade Girişi</option>
                  <option value="transfer_to_personnel">Personele Transfer</option>
                  <option value="transfer_between_personnel">Personelden Personele Devir</option>
                  <option value="return_to_depot">Depoya İade Talebi</option>
                  <option value="submit_to_depot">Depoya Teslim Talebi</option>
                  <option value="return_confirmed">İade Teslim Alındı</option>
                  <option value="submit_confirmed">Teslim Alındı</option>
                  <option value="use_on_device">Cihazda Kullanıldı</option>
                  <option value="borrowed_part">Borç Parça</option>
                  <option value="borrowed_approved">Borç Onaylandı</option>
                  <option value="borrowed_rejected">Borç Reddedildi</option>
                  <option value="transfer_approved">Transfer Onaylandı</option>
                  <option value="transfer_rejected">Transfer Reddedildi</option>
                  <option value="depo_stock_adjusted">Depo Stok Güncellendi</option>
                  <option value="depo_serial_deleted">Depo Seri No Silindi</option>
                  <option value="stok_silme_admin">Depo Stok Silme</option>
                  <option value="depo_stock_deleted_admin">Admin Depo Stok Silme</option>
                  <option value="personnel_stock_deleted_admin">Admin Personel Stok Silme</option>
                  <option value="pool_stock_deleted_admin">Admin Havuz Stok Silme</option>
                </select>
                <select
                  className="cihaz-pressed px-3 py-1.5 text-xs font-medium !border-0 !ring-0"
                  style={{ borderRadius: 10, color: 'var(--dashboard-text)', background: 'var(--dashboard-pressed, var(--dashboard-surface-2))' }}
                  value={String(historyPageSize)}
                  onChange={(e) => setHistoryPageSize(Math.max(10, Number(e.target.value) || 25))}
                >
                  <option value="25">25 / sayfa</option>
                  <option value="50">50 / sayfa</option>
                  <option value="100">100 / sayfa</option>
                </select>
              </div>

              <div className="cihaz-pressed flex items-center gap-2 px-3 py-2" style={{ borderRadius: 12 }}>
                <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--dashboard-muted)' }} />
                <input
                  type="text"
                  placeholder="Kod, ad, seri, personel veya not ile ara…"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--dashboard-muted)]"
                  style={{ color: 'var(--dashboard-text)' }}
                />
                <span className="text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>
                  {filteredHistoryLogs.length} kayıt
                </span>
              </div>

              {/* Log list */}
              <div className="cihaz-card overflow-hidden" style={{ maxHeight: 500, overflowY: 'auto' }}>
                <div className="divide-y" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                  {paginatedHistoryLogs.map(log => {
                    const isTransferAction = log.action === 'transfer_to_personnel' || log.action === 'transfer_between_personnel';
                    const isUseOnDevice = log.action === 'use_on_device';
                    const usageFormId = log.formId || log.usedOnFormId;
                    const usageFormType = log.formType || log.usedOnFormType;
                    const usageDeviceId = log.deviceId || log.usedOnDeviceId;
                    const resolvedActionLabel = log.action === 'borrowed_part' && log.approvalStatus === 'pending'
                      ? 'Onay Bekleyen Borç'
                      : getActionLabel(log.action);
                    return (
                      <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 hover:bg-black/[.02] transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: 'rgba(107,114,128,.10)', color: 'var(--dashboard-muted)' }}>{resolvedActionLabel}</span>
                            <span className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>{log.stokAdi}</span>
                          </div>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>
                            {log.stokKodu} {log.serialNumber ? `· SN: ${log.serialNumber}` : ''} · x{log.quantity || 1} {(log as any).anaBirim ? String((log as any).anaBirim).toLocaleLowerCase('tr-TR') : 'adet'} · {log.toName || log.fromName || '—'} · {log.createdByName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{format(log.timestamp, 'dd.MM.yy HH:mm', { locale: tr })}</span>
                          {isTransferAction && <SparePartTransferTutanakPDFButton log={log} className="h-6 px-2 text-[10px]" />}
                          {isUseOnDevice && usageFormId && usageFormType && usageDeviceId && (usageFormType === 'teknik_servis' || usageFormType === 'aplikasyon') && (
                            <SparePartFormPDFButton
                              formId={usageFormId}
                              formType={usageFormType}
                              deviceId={usageDeviceId}
                            />
                          )}
                          <span
                            className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold"
                            style={{ background: 'rgba(16,185,129,.10)', color: '#047857' }}
                            title="İşlem sonrası toplam stok (depo + personel + havuz)"
                          >
                            Sonrası: {Number.isFinite(Number(log.postActionStockTotal)) ? Number(log.postActionStockTotal) : 0}
                          </span>
                          {log.usageImageUrl && <button onClick={() => setPreviewImage(log.usageImageUrl)} className="cihaz-tool-item p-1"><ImageIcon className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {filteredHistoryLogs.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>
                    Sayfa {Math.min(historyPage + 1, totalHistoryPages)} / {totalHistoryPages}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                      className="cihaz-tool-item px-3 py-1 text-[11px] font-medium disabled:opacity-30"
                      style={{ color: 'var(--dashboard-text)' }}
                    >
                      <ChevronLeft className="w-3 h-3 inline" /> Önceki
                    </button>
                    <button
                      disabled={historyPage >= totalHistoryPages - 1}
                      onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages - 1, p + 1))}
                      className="cihaz-tool-item px-3 py-1 text-[11px] font-medium disabled:opacity-30"
                      style={{ color: 'var(--dashboard-text)' }}
                    >
                      Sonraki <ChevronRight className="w-3 h-3 inline" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );


  const handleOpenStockCardSync = useCallback(() => {
    const existingCodes = new Set(productCodes.map(p => (p.stokKodu || '').trim().toUpperCase()).filter(Boolean));
    const missingMap = new Map<string, { stokKodu: string; stokAdi: string }>();

    for (const item of depoStokProducts) {
      const code = (item.stokKodu || '').trim().toUpperCase();
      if (!code || existingCodes.has(code)) continue;
      if (!missingMap.has(code)) {
        missingMap.set(code, { stokKodu: code, stokAdi: item.stokAdi || code });
      }
    }

    const missing = Array.from(missingMap.values());
    if (missing.length === 0) {
      toast({ title: 'Kontrol Tamam', description: 'Depodaki tüm ürünlerin stok kartı zaten mevcut.' });
      return;
    }

    setStockCardSyncMissing(missing);
    setStockCardSyncBrand(brandOptions[0] || '');
    setStockCardSyncDialogOpen(true);
  }, [brandOptions, depoStokProducts, productCodes, toast]);

  const handleSyncMissingStockCards = useCallback(async () => {
    if (!stockCardSyncBrand) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen marka seçin.', variant: 'destructive' });
      return;
    }

    setStockCardSyncLoading(true);
    try {
      const now = Timestamp.fromDate(new Date());
      for (const item of stockCardSyncMissing) {
        const docId = `auto-${item.stokKodu.toLowerCase().replace(/[^a-z0-9-]/gi, '-')}`;
        await setDoc(doc(db, 'productCodes', docId), {
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
        anaBirim: item.anaBirim || 'Adet',
          urunGrubu: 'yedek_parca',
          marka: stockCardSyncBrand,
          createdAt: now,
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
          autoCreatedFromDepotFlow: true,
        }, { merge: true });
      }

      const refreshedProducts = await getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin, where('urunGrubu', '==', 'yedek_parca')));
      setProductCodes(refreshedProducts.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode));

      toast({ title: 'Başarılı', description: `${stockCardSyncMissing.length} ürün için stok kartı açıldı.` });
      setStockCardSyncDialogOpen(false);
      setStockCardSyncMissing([]);
    } catch (err) {
      console.error('Error syncing stock cards:', err);
      toast({ title: 'Hata', description: 'Stok kartları oluşturulamadı.', variant: 'destructive' });
    } finally {
      setStockCardSyncLoading(false);
    }
  }, [currentUserProfile?.name, currentUserProfile?.uid, stockCardSyncBrand, stockCardSyncMissing, toast]);

  // ========== RENDER: Depo Stok View (Grouped) ==========
  const renderDepoStok = () => (
    <div className="space-y-4">
      {/* Header */}
      <div className="cihaz-card-strong p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Warehouse className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} /><h2 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>Depo Stok</h2></div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>{depoStokProducts.length} ürün · {depoStokProducts.reduce((s, g) => s + g.totalQuantity, 0)} adet</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadDepotStockExcel} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <Download className="w-3.5 h-3.5" /> Stok Güncelle (Excel)
          </button>
          <input ref={depotExcelInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleDepotStockExcelUpload} className="hidden" />
          <button onClick={() => depotExcelInputRef.current?.click()} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <Upload className="w-3.5 h-3.5" /> Excel Yükle
          </button>
          <button onClick={handleOpenStockCardSync} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <CheckCircle className="w-3.5 h-3.5" /> Stok Kart Kontrol
          </button>
          {(isAdmin || isTeknikLojistik) && (
            <button onClick={() => setMinMaxPanelOpen(true)} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
              <SlidersHorizontal className="w-3.5 h-3.5" /> Min-Max Ayarları
            </button>
          )}
          {(isAdmin || isTeknikLojistik) && (
            <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/siparis')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
              <ShoppingCart className="w-3.5 h-3.5" /> Sipariş Paneli
            </button>
          )}
          <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/stok-giris')} className="cihaz-action-tile inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white" style={{ background: 'var(--dashboard-accent)' }}>
            <Plus className="w-3.5 h-3.5" /> Stok Girişi
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="cihaz-pressed flex items-center gap-2 px-3 py-2" style={{ borderRadius: 14 }}>
        <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--dashboard-muted)' }} />
        <input
          type="text"
          placeholder="Stok kodu, ürün adı veya seri no ile ara…"
          value={depoStokSearchQuery}
          onChange={(e) => { setDepoStokSearchQuery(e.target.value); setDepoStokPage(0); }}
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--dashboard-muted)]"
          style={{ color: 'var(--dashboard-text)' }}
        />
        {depoStokSearchQuery && <span className="text-[10px] font-medium flex-shrink-0" style={{ color: 'var(--dashboard-muted)' }}>{filteredDepoStok.length} sonuç</span>}
      </div>

      {/* Content */}
      {depoStokLoading ? (
        <div className="cihaz-card p-8 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--dashboard-accent)' }} /><span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Yükleniyor…</span></div>
      ) : filteredDepoStok.length === 0 ? (
        <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}><Warehouse className="w-10 h-10 mx-auto mb-2 opacity-20" /><p className="text-sm font-medium">{depoStokSearchQuery ? 'Eşleşen ürün yok.' : 'Depoda stok yok.'}</p></div>
      ) : (
        <>
          <div className="space-y-1.5">
            {paginatedDepoStok.map(group => {
              const isExpanded = expandedStokKodu === group.stokKodu;
              return (
                <article key={group.stokKodu} className="cihaz-card overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-black/[.02] transition-colors"
                    onClick={() => setExpandedStokKodu(isExpanded ? null : group.stokKodu)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>{group.stokAdi}</p>
                        {group.cihazGrubu && <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0" style={{ background: 'rgba(245,158,11,.10)', color: '#B45309' }}>{group.cihazGrubu}</span>}
                      </div>
                      <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>{group.stokKodu} · {format(group.earliestDate, 'dd.MM.yyyy', { locale: tr })}</p>
                      <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Adres: {(group.entries[0]?.address || '').trim() || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="cihaz-pressed px-2 py-0.5 text-xs font-bold" style={{ borderRadius: 8, color: 'var(--dashboard-text)' }}>{group.totalQuantity}</span>
                      <button onClick={(e) => { e.stopPropagation(); openDepoQuantityEditor(group); }} className="p-1 rounded-lg hover:bg-black/5 transition" title="Düzenle"><Pencil className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} /></button>
                      {isAdmin && (
                        <button onClick={(e) => { e.stopPropagation(); deleteDepotStockGroup(group); }} className="p-1 rounded-lg hover:bg-red-50 transition" title="Stok satırını sil"><Trash2 className="w-3 h-3" style={{ color: '#B91C1C' }} /></button>
                      )}
                      {group.serialNumbers.length > 0 ? (
                        isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} /> : <div className="flex items-center gap-0.5"><Hash className="w-2.5 h-2.5" style={{ color: 'var(--dashboard-muted)' }} /><span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{group.serialNumbers.length}</span><ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} /></div>
                      ) : null}
                    </div>
                  </div>

                  {/* Expanded serials */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                      {group.serialNumbers.length > 0 ? (
                        <>
                          <p className="text-[10px] font-semibold mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Tekil Takip ({group.serialNumbers.length}/{group.totalQuantity})</p>
                          <div className="flex flex-wrap gap-1.5">
                            {group.serialNumbers.map(sn => (
                              <span key={sn.id} className="cihaz-pressed inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono" style={{ borderRadius: 8 }}>
                                {sn.serialNumber || '—'}
                                {sn.hucreNumarasi ? <span style={{ color: '#7C3AED', fontWeight: 600 }}>H:{sn.hucreNumarasi}</span> : null}
                                <span style={{ color: 'var(--dashboard-muted)' }}>({format(sn.createdAt, 'dd.MM.yy', { locale: tr })})</span>
                                {sn.address ? <span style={{ color: 'var(--dashboard-muted)' }}>[{sn.address}]</span> : null}
                                <button onClick={(e) => { e.stopPropagation(); deleteSerialFromDepot(group, sn); }} className="ml-0.5 p-0.5 rounded hover:bg-black/5"><Trash2 className="w-2.5 h-2.5" style={{ color: '#B91C1C' }} /></button>
                              </span>
                            ))}
                          </div>
                          {group.totalQuantity > group.serialNumbers.length && <p className="text-[10px] mt-1.5" style={{ color: 'var(--dashboard-muted)' }}>+ {group.totalQuantity - group.serialNumbers.length} adet seri numarasız</p>}
                        </>
                      ) : (
                        <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Seri numaralı kayıt yok. {group.totalQuantity} adet seri numarasız.</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Pagination */}
          {totalDepoStokPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Sayfa {depoStokPage + 1}/{totalDepoStokPages} ({filteredDepoStok.length} ürün)</span>
              <div className="flex gap-1.5">
                <button disabled={depoStokPage === 0} onClick={() => setDepoStokPage(p => p - 1)} className="cihaz-tool-item px-3 py-1 text-[11px] font-medium disabled:opacity-30" style={{ color: 'var(--dashboard-text)' }}><ChevronLeft className="w-3 h-3 inline" /> Önceki</button>
                <button disabled={depoStokPage >= totalDepoStokPages - 1} onClick={() => setDepoStokPage(p => p + 1)} className="cihaz-tool-item px-3 py-1 text-[11px] font-medium disabled:opacity-30" style={{ color: 'var(--dashboard-text)' }}>Sonraki <ChevronRight className="w-3 h-3 inline" /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ========== RENDER: Personnel Stock View ==========
  const renderPersonnelStock = () => {
    const pendingApprovalCount = personnelStock.filter(s => s.status === 'pending_approval').length;

    return (
      <div className="space-y-4">
        {/* Header card */}
        <div className="cihaz-card-strong p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--dashboard-text)' }}>
                <UserIcon className="h-5 w-5" />
                {menuSelection.personnelName} - Yedek Parça Stoku
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-1 p-1 cihaz-pressed sm:inline-flex sm:flex-wrap sm:gap-1" style={{ borderRadius: 12 }}>
                {([
                  { key: 'all', label: 'Tümü' },
                  { key: 'pending_approval', label: `Onay (${pendingApprovalCount})` },
                  { key: 'used', label: 'Kullanılan' },
                  { key: 'unused', label: 'Kullanılmayan' },
                ] as const).map(option => {
                  const active = personnelStockFilter === option.key;
                  return (
                    <button
                      key={option.key}
                      onClick={() => { setPersonnelStockFilter(option.key); setPersonnelStockPage(0); }}
                      className="px-2.5 py-1 text-[11px] rounded-lg font-medium transition-all"
                      style={{
                        background: active ? 'var(--dashboard-surface)' : 'transparent',
                        color: active ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={openManualStockModal}
              className="cihaz-card flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all active:scale-95 w-full sm:w-auto"
              style={{ color: 'var(--dashboard-accent)' }}
            >
              <Plus className="h-4 w-4" />
              Manuel Stok Ekle
            </button>
          </div>
        </div>

        {/* Content */}
        {personnelStockLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted)' }}>Yükleniyor...</span>
          </div>
        ) : filteredPersonnelStock.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>{personnelStock.length === 0 ? 'Bu personelde yedek parça bulunmuyor.' : 'Seçilen filtre için kayıt bulunamadı.'}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block cihaz-card-strong rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Ürün Kodu</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Ürün Adı</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Seri No</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Durum</th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer group"
                      style={{ color: personnelStockSortKey === 'createdAt' ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }}
                      onClick={() => {
                        if (personnelStockSortKey === 'createdAt') {
                          setPersonnelStockSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                        } else {
                          setPersonnelStockSortKey('createdAt');
                          setPersonnelStockSortOrder('desc');
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Transfer
                        <ArrowUpDown className={cn("w-3 h-3 transition-colors", personnelStockSortKey === 'createdAt' ? "opacity-100" : "opacity-20 group-hover:opacity-100")} />
                      </div>
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer group"
                      style={{ color: personnelStockSortKey === 'usedAt' ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }}
                      onClick={() => {
                        if (personnelStockSortKey === 'usedAt') {
                          setPersonnelStockSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                        } else {
                          setPersonnelStockSortKey('usedAt');
                          setPersonnelStockSortOrder('desc');
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Kullanım
                        <ArrowUpDown className={cn("w-3 h-3 transition-colors", personnelStockSortKey === 'usedAt' ? "opacity-100" : "opacity-20 group-hover:opacity-100")} />
                      </div>
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Gözlem</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>İşlem</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Form</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPersonnelStock.map((item) => {
                    const isUsed = item.status === 'used' || item.status === 'pending_return';
                    const canTakeOver =
                      item.status === 'in_stock' &&
                      !!currentUserProfile?.uid &&
                      currentUserProfile.uid !== item.ownerUid;

                    return (
                      <tr
                        key={item.id}
                        className={cn('transition-colors', isUsed && 'opacity-50')}
                        style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}
                      >
                        <td className={cn('px-4 py-3 font-mono text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokKodu}
                        </td>
                        <td className={cn('px-4 py-3 text-sm', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokAdi}
                        </td>
                        <td className={cn('px-4 py-3 font-mono text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {item.serialNumber || '—'}
                          {(item as any).hucreNumarasi && (
                            <span className="ml-1.5 text-[10px] font-semibold" style={{ color: '#7C3AED' }}>H:{(item as any).hucreNumarasi}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.status === 'in_stock' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Aktif</span>
                          )}
                          {item.status === 'used' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Kullanıldı</span>
                          )}
                          {item.status === 'pending_return' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">İade Bekliyor</span>
                          )}
                          {item.status === 'pending_approval' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Onay Bekliyor</span>
                          )}
                        </td>
                        <td className={cn('px-4 py-3 text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {format(item.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                          {item.usedAt
                            ? format(item.usedAt, 'dd.MM.yyyy HH:mm', { locale: tr })
                            : '—'
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openObservation({
                              id: item.id,
                              scope: 'personal',
                              stokKodu: item.stokKodu,
                              stokAdi: item.stokAdi,
                              serialNumber: item.serialNumber,
                              hucreNumarasi: (item as any).hucreNumarasi,
                              ownerName: item.ownerName,
                            })}
                            title="Gözlem: Bu ürüne ait transfer geçmişini göster"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg transition-all active:scale-95"
                            style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                          >
                            <History className="h-3 w-3" />
                            Gözlem
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {item.status === 'pending_approval' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => approveTransfer(item)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
                                style={{ background: '#16A34A' }}
                              >
                                <CheckCircle className="w-3.5 h-3.5" /> Onayla
                              </button>
                              <button
                                onClick={() => rejectTransfer(item)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 hover:bg-red-50"
                                style={{ color: '#B91C1C' }}
                              >
                                <XCircle className="w-3.5 h-3.5" /> Reddet
                              </button>
                            </div>
                          ) : (isAdmin || isTeknikLojistik) ? (
                            <button
                              onClick={() => deletePersonnelStockItem(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                              style={{ color: '#B91C1C' }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Stok Sil
                            </button>
                          ) : (item.status === 'in_stock' && item.ownerUid === currentUserProfile?.uid) ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  const maxQty = personnelStock.filter(s => s.status === 'in_stock' && s.ownerUid === item.ownerUid && s.stokKodu === item.stokKodu).length;
                                  setPTransferItem(item);
                                  setPTransferQuantity(Math.min(1, maxQty));
                                  setPTransferTargetUid('');
                                  setPTransferTargetName('');
                                  setPTransferSearchQuery('');
                                  setPTransferModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95"
                                style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                              >
                                <Send className="h-3.5 w-3.5" />
                                Transfer Et
                              </button>
                              <button
                                onClick={() => { setReturnModalItem(item); setReturnCondition('iyi'); setReturnNote(''); setReturnModalOpen(true); }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95"
                                style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                              >
                                <Upload className="h-3.5 w-3.5" />
                                İade Et
                              </button>
                            </div>
                          ) : isUsed ? (
                            <span className="text-[11px] text-left inline-block max-w-[220px]" style={{ color: 'var(--dashboard-muted)' }}>
                              {(item.usageLabName || 'Lab bilgisi yok')} · {(item.usageDeviceName || item.usedOnDeviceName || 'Cihaz bilgisi yok')}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isUsed && item.usedOnFormId && item.usedOnFormType && item.usedOnDeviceId ? (
                            <SparePartFormPDFButton formId={item.usedOnFormId} formType={item.usedOnFormType} deviceId={item.usedOnDeviceId} />
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {paginatedPersonnelStock.map((item) => {
                const isUsed = item.status === 'used' || item.status === 'pending_return';
                const canTakeOver =
                  item.status === 'in_stock' &&
                  !!currentUserProfile?.uid &&
                  currentUserProfile.uid !== item.ownerUid;

                return (
                  <article key={item.id} className={cn('cihaz-card p-3 rounded-xl', isUsed && 'opacity-50')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm font-medium truncate', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokAdi}
                        </p>
                        <p className={cn('text-xs font-mono mt-0.5', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {item.stokKodu} {item.serialNumber ? `• ${item.serialNumber}` : ''}
                        </p>
                      </div>
                      {item.status === 'in_stock' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Aktif</span>
                      )}
                      {item.status === 'used' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">Kullanıldı</span>
                      )}
                      {item.status === 'pending_return' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">İade Bekliyor</span>
                      )}
                      {item.status === 'pending_approval' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 shrink-0">Onay Bekliyor</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                          {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                          {item.usedAt && ` → ${format(item.usedAt, 'dd.MM.yyyy', { locale: tr })}`}
                        </span>
                        <button
                          onClick={() => openObservation({
                            id: item.id,
                            scope: 'personal',
                            stokKodu: item.stokKodu,
                            stokAdi: item.stokAdi,
                            serialNumber: item.serialNumber,
                            hucreNumarasi: (item as any).hucreNumarasi,
                            ownerName: item.ownerName,
                          })}
                          title="Gözlem"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md transition-all active:scale-95"
                          style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                        >
                          <History className="h-2.5 w-2.5" />
                          Gözlem
                        </button>
                      </div>
                      {item.status === 'pending_approval' ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => approveTransfer(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-white rounded-lg transition-all active:scale-95"
                            style={{ background: '#16A34A' }}
                          >
                            <CheckCircle className="w-3 h-3" /> Onayla
                          </button>
                          <button
                            onClick={() => rejectTransfer(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-all active:scale-95 hover:bg-red-50"
                            style={{ color: '#B91C1C' }}
                          >
                            <XCircle className="w-3 h-3" /> Reddet
                          </button>
                        </div>
                      ) : (isAdmin || isTeknikLojistik) ? (
                        <button
                          onClick={() => deletePersonnelStockItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                          style={{ color: '#B91C1C' }}
                        >
                          <Trash2 className="h-3 w-3" />
                          Stok Sil
                        </button>
                      ) : (item.status === 'in_stock' && item.ownerUid === currentUserProfile?.uid) ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              const maxQty = personnelStock.filter(s => s.status === 'in_stock' && s.ownerUid === item.ownerUid && s.stokKodu === item.stokKodu).length;
                              setPTransferItem(item);
                              setPTransferQuantity(Math.min(1, maxQty));
                              setPTransferTargetUid('');
                              setPTransferTargetName('');
                              setPTransferSearchQuery('');
                              setPTransferModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95"
                            style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                          >
                            <Send className="h-3 w-3" />
                            Transfer
                          </button>
                          <button
                            onClick={() => { setReturnModalItem(item); setReturnCondition('iyi'); setReturnNote(''); setReturnModalOpen(true); }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95"
                            style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                          >
                            <Upload className="h-3 w-3" />
                            İade
                          </button>
                        </div>
                      ) : isUsed ? (
                        <span className="text-[10px] text-right max-w-[52%]" style={{ color: 'var(--dashboard-muted)' }}>
                          {(item.usageLabName || 'Lab bilgisi yok')} · {(item.usageDeviceName || item.usedOnDeviceName || 'Cihaz bilgisi yok')}
                        </span>
                      ) : null}
                    </div>
                    {isUsed && item.usedOnFormId && item.usedOnFormType && item.usedOnDeviceId && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                        <SparePartFormPDFButton formId={item.usedOnFormId} formType={item.usedOnFormType} deviceId={item.usedOnDeviceId} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPersonnelPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                  {filteredPersonnelStock.length} kayıt — Sayfa {personnelStockPage + 1} / {totalPersonnelPages}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={personnelStockPage === 0}
                    onClick={() => setPersonnelStockPage(p => p - 1)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                  >
                    Önceki
                  </button>
                  <button
                    disabled={personnelStockPage >= totalPersonnelPages - 1}
                    onClick={() => setPersonnelStockPage(p => p + 1)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ========== RENDER: Pool Stock View ==========
  const renderPoolStock = () => {
    return (
      <div className="space-y-4">
        {/* Header card */}
        <div className="cihaz-card-strong p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--dashboard-text)' }}>
                <Database className="h-5 w-5 text-purple-600" />
                {menuSelection.poolWarehouseName} - Havuz Stok
              </h2>
              <div className="mt-2 grid grid-cols-3 gap-1 p-1 cihaz-pressed sm:inline-flex sm:flex-wrap sm:gap-1" style={{ borderRadius: 12 }}>
                {([
                  { key: 'all', label: 'Tümü' },
                  { key: 'used', label: 'Kullanılan' },
                  { key: 'unused', label: 'Kullanılmayan' },
                ] as const).map(option => {
                  const active = poolStockFilter === option.key;
                  return (
                    <button
                      key={option.key}
                      onClick={() => { setPoolStockFilter(option.key); setPoolStockPage(0); }}
                      className="px-2.5 py-1 text-[11px] rounded-lg font-medium transition-all"
                      style={{
                        background: active ? 'var(--dashboard-surface)' : 'transparent',
                        color: active ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {(isAdmin || isTeknikLojistik) && menuSelection.poolWarehouseId && (
              <button
                onClick={() => router.push(`/direkt-transfer/yedek-parca-transfer/stok-giris/havuz-stok-giris?poolWarehouseId=${menuSelection.poolWarehouseId}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-95"
                style={{ background: 'var(--dashboard-accent)', boxShadow: 'var(--dashboard-raised-soft)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Stok Girişi
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {poolStockLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted)' }}>Yükleniyor...</span>
          </div>
        ) : filteredPoolStock.length === 0 ? (
          <div className="text-center py-12">
            <Database className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>
              {poolStock.length === 0 ? 'Bu havuz deposunda yedek parça bulunmuyor.' : 'Seçilen filtre için kayıt bulunamadı.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block cihaz-card-strong rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Ürün Kodu</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Ürün Adı</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Seri No</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Durum</th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer group"
                      style={{ color: poolStockSortKey === 'createdAt' ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }}
                      onClick={() => {
                        if (poolStockSortKey === 'createdAt') {
                          setPoolStockSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                        } else {
                          setPoolStockSortKey('createdAt');
                          setPoolStockSortOrder('desc');
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Transfer
                        <ArrowUpDown className={cn("w-3 h-3 transition-colors", poolStockSortKey === 'createdAt' ? "opacity-100" : "opacity-20 group-hover:opacity-100")} />
                      </div>
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer group"
                      style={{ color: poolStockSortKey === 'usedAt' ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }}
                      onClick={() => {
                        if (poolStockSortKey === 'usedAt') {
                          setPoolStockSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                        } else {
                          setPoolStockSortKey('usedAt');
                          setPoolStockSortOrder('desc');
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Kullanım
                        <ArrowUpDown className={cn("w-3 h-3 transition-colors", poolStockSortKey === 'usedAt' ? "opacity-100" : "opacity-20 group-hover:opacity-100")} />
                      </div>
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Kullanan</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Gözlem</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>İşlem</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Form</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPoolStock.map((item) => {
                    const isUsed = item.status === 'used';
                    return (
                      <tr
                        key={item.id}
                        className={cn('transition-colors', isUsed && 'opacity-50')}
                        style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}
                      >
                        <td className={cn('px-4 py-3 font-mono text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokKodu}
                        </td>
                        <td className={cn('px-4 py-3 text-sm', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokAdi}
                        </td>
                        <td className={cn('px-4 py-3 font-mono text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {item.serialNumber || '—'}
                          {(item as any).hucreNumarasi && (
                            <span className="ml-1.5 text-[10px] font-semibold" style={{ color: '#7C3AED' }}>H:{(item as any).hucreNumarasi}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.status === 'in_stock' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Aktif</span>
                          )}
                          {item.status === 'used' && (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Kullanıldı</span>
                          )}
                        </td>
                        <td className={cn('px-4 py-3 text-xs', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {format(item.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                          {item.usedAt
                            ? format(item.usedAt, 'dd.MM.yyyy HH:mm', { locale: tr })
                            : '—'
                          }
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                          {item.usedByName || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openObservation({
                              id: item.id,
                              scope: 'pool',
                              stokKodu: item.stokKodu,
                              stokAdi: item.stokAdi,
                              serialNumber: item.serialNumber,
                              hucreNumarasi: (item as any).hucreNumarasi,
                              poolWarehouseName: item.poolWarehouseName,
                            })}
                            title="Gözlem: Bu ürüne ait transfer geçmişini göster"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg transition-all active:scale-95"
                            style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                          >
                            <History className="h-3 w-3" />
                            Gözlem
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(isAdmin || isTeknikLojistik) ? (
                            <button
                              onClick={() => deletePoolStockItem(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                              style={{ color: '#B91C1C' }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Stok Sil
                            </button>
                          ) : isUsed ? (
                            <span className="text-[11px] text-left inline-block max-w-[220px]" style={{ color: 'var(--dashboard-muted)' }}>
                              {item.usedOnLabName || 'Lab bilgisi yok'} · {item.usedOnDeviceName || 'Cihaz bilgisi yok'}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isUsed && item.usedOnFormId && item.usedOnFormType && item.usedOnDeviceId ? (
                            <SparePartFormPDFButton formId={item.usedOnFormId} formType={item.usedOnFormType} deviceId={item.usedOnDeviceId} />
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {paginatedPoolStock.map((item) => {
                const isUsed = item.status === 'used';
                return (
                  <article key={item.id} className={cn('cihaz-card p-3 rounded-xl', isUsed && 'opacity-50')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm font-medium truncate', isUsed && 'line-through')} style={{ color: 'var(--dashboard-text)' }}>
                          {item.stokAdi}
                        </p>
                        <p className={cn('text-xs font-mono mt-0.5', isUsed && 'line-through')} style={{ color: 'var(--dashboard-muted)' }}>
                          {item.stokKodu} {item.serialNumber ? `• ${item.serialNumber}` : ''}
                        </p>
                      </div>
                      {item.status === 'in_stock' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Aktif</span>
                      )}
                      {item.status === 'used' && (
                        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">Kullanıldı</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                          {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                          {item.usedAt && ` → ${format(item.usedAt, 'dd.MM.yyyy', { locale: tr })}`}
                        </span>
                        <button
                          onClick={() => openObservation({
                            id: item.id,
                            scope: 'pool',
                            stokKodu: item.stokKodu,
                            stokAdi: item.stokAdi,
                            serialNumber: item.serialNumber,
                            hucreNumarasi: (item as any).hucreNumarasi,
                            poolWarehouseName: item.poolWarehouseName,
                          })}
                          title="Gözlem"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md transition-all active:scale-95"
                          style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                        >
                          <History className="h-2.5 w-2.5" />
                          Gözlem
                        </button>
                      </div>
                      {(isAdmin || isTeknikLojistik) ? (
                        <button
                          onClick={() => deletePoolStockItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                          style={{ color: '#B91C1C' }}
                        >
                          <Trash2 className="h-3 w-3" />
                          Stok Sil
                        </button>
                      ) : isUsed && item.usedByName && (
                        <span className="text-[10px] font-medium" style={{ color: 'var(--dashboard-accent)' }}>
                          {item.usedByName}
                        </span>
                      )}
                    </div>
                    {isUsed && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                          {item.usedOnLabName || ''} {item.usedOnDeviceName ? `· ${item.usedOnDeviceName}` : ''}
                        </span>
                        {item.usedOnFormId && item.usedOnFormType && item.usedOnDeviceId && (
                          <SparePartFormPDFButton formId={item.usedOnFormId} formType={item.usedOnFormType} deviceId={item.usedOnDeviceId} />
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPoolStockPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                  {filteredPoolStock.length} kayıt — Sayfa {poolStockPage + 1} / {totalPoolStockPages}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={poolStockPage === 0}
                    onClick={() => setPoolStockPage(p => p - 1)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                  >
                    Önceki
                  </button>
                  <button
                    disabled={poolStockPage >= totalPoolStockPages - 1}
                    onClick={() => setPoolStockPage(p => p + 1)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ========== RENDER: Toplam Stok View ==========
  const renderToplamStok = () => {
    const groupedByPersonnel = allPersonnelStock.reduce((acc, item) => {
      const key = item.ownerUid;
      if (!acc[key]) {
        acc[key] = {
          ownerName: item.ownerName,
          ownerUid: item.ownerUid,
          items: [],
        };
      }
      acc[key].items.push(item);
      return acc;
    }, {} as Record<string, { ownerName: string; ownerUid: string; items: PersonalStockItem[] }>);

    const personnelList = Object.values(groupedByPersonnel);
    personnelList.sort((a, b) => b.items.length - a.items.length);

    // Havuz depo stoklarını da bu görüntülemede göster; teknik_lojistik'in
    // havuza transfer ettiği ürünler böylece burada da görünür.
    const groupedByPool = allPoolStockAggregate.reduce((acc, item) => {
      const key = item.poolWarehouseId || 'unknown_pool';
      if (!acc[key]) {
        acc[key] = {
          poolWarehouseId: item.poolWarehouseId,
          poolWarehouseName: item.poolWarehouseName || 'Havuz Depo',
          items: [],
        };
      }
      acc[key].items.push(item);
      return acc;
    }, {} as Record<string, { poolWarehouseId: string; poolWarehouseName: string; items: PoolWarehouseStockItem[] }>);

    const poolList = Object.values(groupedByPool);
    poolList.sort((a, b) => b.items.length - a.items.length);

    const totalEverywhere = allPersonnelStock.length + allPoolStockAggregate.length;

    return (
      <div className="space-y-4">
        {/* Header card */}
        <div className="cihaz-card-strong p-4">
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--dashboard-text)' }}>
            <PackageOpen className="h-5 w-5" />
            Toplam Stok (Personel + Havuz)
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--dashboard-muted)' }}>
            Tüm personel ve havuz depolarındaki henüz kullanılmamış yedek parçalar.
            Toplam: <strong style={{ color: 'var(--dashboard-text)' }}>{totalEverywhere}</strong> adet
            (Personel: <strong style={{ color: 'var(--dashboard-text)' }}>{allPersonnelStock.length}</strong>,
            Havuz: <strong style={{ color: 'var(--dashboard-text)' }}>{allPoolStockAggregate.length}</strong>).
          </p>
        </div>

        {/* Content */}
        {allStockLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted)' }}>Yükleniyor...</span>
          </div>
        ) : totalEverywhere === 0 ? (
          <div className="text-center py-12">
            <PackageOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>Personel veya havuz depolarında aktif yedek parça stoku bulunmuyor.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Pool warehouse groups */}
            {poolList.map((pool) => (
              <div key={pool.poolWarehouseId} className="cihaz-card rounded-xl overflow-hidden">
                <button
                  className="w-full p-3 flex items-center justify-between transition-colors hover:opacity-80"
                  onClick={() => handleMenuSelect({
                    section: 'pool-stok',
                    poolWarehouseId: pool.poolWarehouseId,
                    poolWarehouseName: pool.poolWarehouseName,
                  })}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(147, 51, 234, .12)' }}>
                      <Database className="h-4 w-4" style={{ color: 'rgb(147 51 234)' }} />
                    </div>
                    <div className="text-left min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--dashboard-text)' }}>{pool.poolWarehouseName}</p>
                      <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Havuz Depo</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(147, 51, 234, .12)', color: 'rgb(147 51 234)' }}>
                      {pool.items.length}
                    </span>
                    <ChevronRight className="h-4 w-4" style={{ color: 'var(--dashboard-muted)' }} />
                  </div>
                </button>
                <div style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                  {pool.items.slice(0, 5).map((item) => (
                    <div key={item.id} className="px-3 py-2 flex items-center gap-3 text-xs" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                      <span className="font-mono shrink-0 w-24 truncate" style={{ color: 'var(--dashboard-muted)' }}>{item.stokKodu}</span>
                      <span className="flex-1 truncate" style={{ color: 'var(--dashboard-text)' }}>{item.stokAdi}</span>
                      <span className="font-mono shrink-0" style={{ color: 'var(--dashboard-muted)' }}>{item.serialNumber || '—'}</span>
                      <span className="shrink-0" style={{ color: 'var(--dashboard-muted)' }}>
                        {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                      </span>
                    </div>
                  ))}
                  {pool.items.length > 5 && (
                    <div className="px-3 py-2 text-center text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                      … ve {pool.items.length - 5} ürün daha
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Personnel groups */}
            {personnelList.map((personnel) => {
              const role = users.find(u => u.uid === personnel.ownerUid)?.role;
              return (
                <div key={personnel.ownerUid} className="cihaz-card rounded-xl overflow-hidden">
                  {/* Personnel header - clickable */}
                  <button
                    className="w-full p-3 flex items-center justify-between transition-colors hover:opacity-80"
                    onClick={() => handleMenuSelect({
                      section: 'personnel',
                      personnelUid: personnel.ownerUid,
                      personnelName: personnel.ownerName,
                      personnelRole: role,
                    })}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--dashboard-pressed)' }}>
                        <UserIcon className="h-4 w-4" style={{ color: 'var(--dashboard-accent)' }} />
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--dashboard-text)' }}>{personnel.ownerName}</p>
                        <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                          {role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {personnel.items.length}
                      </span>
                      <ChevronRight className="h-4 w-4" style={{ color: 'var(--dashboard-muted)' }} />
                    </div>
                  </button>

                  {/* Preview items */}
                  <div style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                    {personnel.items.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="px-3 py-2 flex items-center gap-3 text-xs"
                        style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}
                      >
                        <span className="font-mono shrink-0 w-24 truncate" style={{ color: 'var(--dashboard-muted)' }}>{item.stokKodu}</span>
                        <span className="flex-1 truncate" style={{ color: 'var(--dashboard-text)' }}>{item.stokAdi}</span>
                        <span className="font-mono shrink-0" style={{ color: 'var(--dashboard-muted)' }}>{item.serialNumber || '—'}</span>
                        <span className="shrink-0" style={{ color: 'var(--dashboard-muted)' }}>
                          {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                        </span>
                      </div>
                    ))}
                    {personnel.items.length > 5 && (
                      <div className="px-3 py-2 text-center text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                        … ve {personnel.items.length - 5} ürün daha
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleMenuSelect = useCallback((selection: MenuSelection, closeMenu?: () => void) => {
    if (selection.section === 'transfer' && !canAccessTransferPanel) {
      closeMenu?.();
      return;
    }

    setMenuSelection(selection);

    const basePath = '/direkt-transfer/yedek-parca-transfer';
    if (selection.section === 'personnel' && selection.personnelUid) {
      router.push(`/direkt-transfer/yedek-parca-transfer/${selection.personnelUid}`);
    } else if (selection.section === 'depo-stok') {
      router.push(`${basePath}?section=depo-stok`);
    } else if (selection.section === 'toplam-stok') {
      router.push(`${basePath}?section=toplam-stok`);
    } else if (selection.section === 'pool-stok' && selection.poolWarehouseId) {
      router.push(`${basePath}?section=pool-stok&poolWarehouseId=${selection.poolWarehouseId}`);
    } else if (pathname !== basePath || searchParams.toString()) {
      router.push(basePath);
    }

    closeMenu?.();
  }, [canAccessTransferPanel, pathname, router, searchParams]);


  useEffect(() => {
    const segments = pathname.split('/').filter(Boolean);
    const routePersonnelUid = segments.length > 2 ? segments[2] : '';

    if (!routePersonnelUid) return;
    const selectedUser = users.find((user) => user.uid === routePersonnelUid);
    if (!selectedUser) return;

    setMenuSelection((prev) => {
      if (prev.section === 'personnel' && prev.personnelUid === routePersonnelUid) return prev;
      return {
        section: 'personnel',
        personnelUid: selectedUser.uid || '',
        personnelName: selectedUser.name || selectedUser.email || '',
        personnelRole: selectedUser.role || '',
      };
    });
  }, [pathname, users]);

  useEffect(() => {
    const sectionParam = searchParams.get('section');
    const poolWarehouseId = searchParams.get('poolWarehouseId');
    const basePath = '/direkt-transfer/yedek-parca-transfer';
    if (pathname !== basePath) return;
    if (!sectionParam || sectionParam === 'transfer') return;

    if (sectionParam === 'depo-stok') {
      setMenuSelection((prev) => (prev.section === 'depo-stok' ? prev : { section: 'depo-stok' }));
      return;
    }

    if (sectionParam === 'toplam-stok') {
      setMenuSelection((prev) => (prev.section === 'toplam-stok' ? prev : { section: 'toplam-stok' }));
      return;
    }

    if (sectionParam === 'pool-stok') {
      if (!poolWarehouseId) return;
      const warehouse = poolWarehouses.find((w) => w.id === poolWarehouseId);
      if (!warehouse) return;
      setMenuSelection((prev) => {
        if (prev.section === 'pool-stok' && prev.poolWarehouseId === poolWarehouseId) return prev;
        return { section: 'pool-stok', poolWarehouseId, poolWarehouseName: warehouse.name };
      });
    }
  }, [pathname, poolWarehouses, searchParams]);

  useEffect(() => {
    if (!isFieldPersonnel || !currentUserProfile?.uid) return;

    const segments = pathname.split('/').filter(Boolean);
    const routePersonnelUid = segments.length > 2 ? segments[2] : '';
    const sectionParam = searchParams.get('section');
    const ownUid = currentUserProfile.uid;

    if (routePersonnelUid) return;
    if (sectionParam === 'depo-stok' || sectionParam === 'toplam-stok' || sectionParam === 'pool-stok') return;

    setMenuSelection((prev) => {
      if (prev.section === 'personnel' && prev.personnelUid === ownUid) return prev;
      return {
        section: 'personnel',
        personnelUid: ownUid,
        personnelName: currentUserProfile.name || currentUserProfile.email || '',
        personnelRole: currentUserProfile.role || '',
      };
    });

    router.replace(`/direkt-transfer/yedek-parca-transfer/${ownUid}`);
  }, [currentUserProfile, isFieldPersonnel, pathname, router, searchParams]);

  const renderManagementMenu = (closeMenu?: () => void) => {
    const menuItem = (section: MenuSection, icon: React.ReactNode, label: string, sub: string, extra?: React.ReactNode) => {
      const isActive = menuSelection.section === section;
      return (
        <button
          key={section}
          onClick={() => handleMenuSelect({ section }, closeMenu)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
          style={{
            background: isActive ? 'var(--dashboard-surface)' : 'transparent',
            boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
          }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isActive ? 'rgba(245,158,11,.15)' : 'rgba(107,114,128,.08)' }}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: isActive ? 'var(--dashboard-text)' : 'var(--dashboard-text)' }}>{label}</p>
            <p className="text-[10px] truncate" style={{ color: 'var(--dashboard-muted)' }}>{sub}</p>
          </div>
          {extra}
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" style={{ color: 'var(--dashboard-muted)' }} />
        </button>
      );
    };

    const personItem = (user: User, role: string) => {
      const isActive = menuSelection.section === 'personnel' && menuSelection.personnelUid === user.uid;
      return (
        <button
          key={user.uid}
          onClick={() => handleMenuSelect({ section: 'personnel', personnelUid: user.uid || '', personnelName: user.name || '', personnelRole: role }, closeMenu)}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all"
          style={{
            background: isActive ? 'var(--dashboard-surface)' : 'transparent',
            boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
          }}
        >
          <UserIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isActive ? 'var(--dashboard-accent)' : 'var(--dashboard-muted)' }} />
          <span className="text-xs truncate flex-1" style={{ color: 'var(--dashboard-text)' }}>{user.name}</span>
        </button>
      );
    };

    return (
      <>
        {/* Module nav */}
        {menuItem('depo-stok', <Warehouse className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-accent)' }} />, 'Depo Stok', 'Yedek parça deposu')}
        {menuItem('toplam-stok', <PackageOpen className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-accent)' }} />, 'Personel Toplam Stok', 'Kullanılmamış stok')}
        {canAccessTransferPanel && menuItem('transfer', <Send className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-accent)' }} />, 'Transfer Paneli', 'Transfer, borç, iade, geçmiş',
          (borrowedParts.length > 0 || pendingReturns.length > 0) ? (
            <div className="flex gap-1 flex-shrink-0">
              {borrowedParts.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: '#B91C1C' }}>{borrowedParts.length}</span>}
              {pendingReturns.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: 'rgba(107,114,128,.15)', color: 'var(--dashboard-muted)' }}>{pendingReturns.length}</span>}
            </div>
          ) : undefined
        )}

        {/* Pool Warehouses */}
        {poolWarehouses.length > 0 && (
          <>
            <div className="my-2 mx-3" style={{ borderTop: '1px solid var(--dashboard-stroke)' }} />
            <div className="px-3 py-1 flex items-center gap-1.5">
              <Database className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Havuz Depolar</span>
              <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>{poolWarehouses.length}</span>
            </div>
            <div className="space-y-0.5">
              {poolWarehouses.map(pw => {
                const isActive = menuSelection.section === 'pool-stok' && menuSelection.poolWarehouseId === pw.id;
                return (
                  <button
                    key={pw.id}
                    onClick={() => handleMenuSelect({ section: 'pool-stok', poolWarehouseId: pw.id, poolWarehouseName: pw.name }, closeMenu)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all"
                    style={{
                      background: isActive ? 'var(--dashboard-surface)' : 'transparent',
                      boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
                    }}
                  >
                    <Database className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isActive ? 'rgb(147 51 234)' : 'var(--dashboard-muted)' }} />
                    <span className="text-xs truncate flex-1" style={{ color: 'var(--dashboard-text)' }}>{pw.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Divider */}
        <div className="my-2 mx-3" style={{ borderTop: '1px solid var(--dashboard-stroke)' }} />

        {/* Teknik Servis */}
        <div className="px-3 py-1 flex items-center gap-1.5">
          <Wrench className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Teknik Servis</span>
          <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>{teknikServisUsers.length}</span>
        </div>
        <div className="space-y-0.5">
          {teknikServisUsers.map(u => personItem(u, 'teknik_servis'))}
          {teknikServisUsers.length === 0 && <p className="text-[10px] px-3 py-1" style={{ color: 'var(--dashboard-muted)' }}>Personel yok</p>}
        </div>

        <div className="my-2 mx-3" style={{ borderTop: '1px solid var(--dashboard-stroke)' }} />

        {/* Aplikasyon */}
        <div className="px-3 py-1 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Aplikasyon</span>
          <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>{aplikasyonUsers.length}</span>
        </div>
        <div className="space-y-0.5">
          {aplikasyonUsers.map(u => personItem(u, 'aplikasyon'))}
          {aplikasyonUsers.length === 0 && <p className="text-[10px] px-3 py-1" style={{ color: 'var(--dashboard-muted)' }}>Personel yok</p>}
        </div>
      </>
    );
  };

  // ========== RENDER: Right Panel Content ==========
  const renderRightPanel = () => {
    switch (menuSelection.section) {
      case 'transfer':
        return canAccessTransferPanel ? renderTransferPanel() : renderPersonnelStock();
      case 'depo-stok':
        return renderDepoStok();
      case 'personnel':
        return renderPersonnelStock();
      case 'toplam-stok':
        return renderToplamStok();
      case 'pool-stok':
        return renderPoolStock();
      default:
        return canAccessTransferPanel ? renderTransferPanel() : renderPersonnelStock();
    }
  };

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
          <span style={{ color: 'var(--dashboard-text)' }} className="text-sm font-medium">Yükleniyor…</span>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 text-center space-y-3">
          <h2 className="text-lg font-bold" style={{ color: '#B91C1C' }}>Yetkisiz Erişim</h2>
          <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>Bu sayfaya erişim yetkiniz bulunmamaktadır.</p>
          <button onClick={() => router.back()} className="cihaz-tool-item px-4 py-2 text-sm font-medium" style={{ color: 'var(--dashboard-muted)' }}>Geri Dön</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cihaz-shell px-2 pt-1 pb-3 sm:px-4 sm:py-5 space-y-3 sm:space-y-4" style={{ minHeight: '100dvh' }}>

      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => router.push('/direkt-transfer')}
          className="cihaz-tool-item p-1.5"
          style={{ borderRadius: 10 }}
          aria-label="Geri"
        >
          <ChevronLeft className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />
        </button>
        <button
          className="md:hidden cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
          onClick={() => setMobileMenuOpen(true)}
          style={{ color: 'var(--dashboard-text)' }}
        >
          <Menu className="w-3.5 h-3.5" /> Menü
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:gap-4">
        {/* ===== LEFT PANEL - Sidebar Menu ===== */}
        <div className="hidden md:block w-[280px] lg:w-[300px] flex-shrink-0">
          <nav className="cihaz-card-strong p-2 space-y-1 sticky top-4" style={{ maxHeight: 'calc(100dvh - 100px)', overflowY: 'auto' }}>
            {renderManagementMenu()}
          </nav>
        </div>

        {/* ===== RIGHT PANEL - Content Area ===== */}
        <div className="flex-1 min-w-0">
          {renderRightPanel()}
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[85vw] max-w-[320px] cihaz-shell overflow-y-auto" style={{ boxShadow: '4px 0 20px rgba(0,0,0,.12)' }}>
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
              <h2 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>Yedek Parça Menü</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1"><X className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} /></button>
            </div>
            <div className="p-2">{renderManagementMenu(() => setMobileMenuOpen(false))}</div>
          </div>
        </div>
      )}

      <Dialog open={stockCardSyncDialogOpen} onOpenChange={(open) => { if (!stockCardSyncLoading) setStockCardSyncDialogOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Eksik Yedek Parça Stok Kartları</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Depodaki bazı ürünler ürün kodu yönetiminde tanımlı değil. Seçtiğiniz marka ile bu ürünlerin yedek parça stok kartları açılsın mı?
          </p>
          <div className="max-h-44 overflow-y-auto border rounded-md p-2 space-y-2">
            {stockCardSyncMissing.map(item => (
              <div key={item.stokKodu} className="text-xs">
                <p className="font-mono font-semibold">{item.stokKodu}</p>
                <p className="text-muted-foreground">{item.stokAdi}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Marka</label>
            <Select value={stockCardSyncBrand} onValueChange={setStockCardSyncBrand}>
              <SelectTrigger>
                <SelectValue placeholder="Marka seçin" />
              </SelectTrigger>
              <SelectContent>
                {brandOptions.map(brand => (
                  <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <button className="cihaz-tool-item px-4 py-2 text-sm" disabled={stockCardSyncLoading} onClick={() => setStockCardSyncDialogOpen(false)}>
              İptal
            </button>
            <button className="cihaz-action-tile px-4 py-2 text-sm text-white" disabled={stockCardSyncLoading || !stockCardSyncBrand} onClick={handleSyncMissingStockCards}>
              {stockCardSyncLoading ? 'Oluşturuluyor...' : 'Stok Kartlarını Aç'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Min-Max Settings Panel for Spare Parts Depot */}
      {currentCompanyId && (
        <MinMaxSettingsPanel
          isOpen={minMaxPanelOpen}
          onClose={() => setMinMaxPanelOpen(false)}
          target={{ id: currentCompanyId, name: 'Yedek Parça Deposu' } as any}
          targetType="spare_parts_depot"
          productCodes={productCodes}
          toast={toast}
        />
      )}

      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Parça Fotoğrafı</DialogTitle>
          </DialogHeader>
          {previewImage && <img src={previewImage} alt="Parça fotoğrafı" className="w-full h-auto max-h-[70vh] object-contain rounded-xl" />}
        </DialogContent>
      </Dialog>

      {/* Depo Quantity Edit Dialog */}
      <Dialog open={!!editingDepoGroup} onOpenChange={(open) => { if (!open) { setEditingDepoGroup(null); setIsSavingDepoEdit(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Depo Stok Adet Düzenle</DialogTitle></DialogHeader>
          {editingDepoGroup && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>{editingDepoGroup.stokAdi}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--dashboard-muted)' }}>{editingDepoGroup.stokKodu}</p>
                {editingDepoGroup.serialNumbers.length > 0 && (
                  <p className="text-xs mt-1" style={{ color: '#D97706' }}>Seri numaralı. Min adet: {editingDepoGroup.serialNumbers.length}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Yeni Adet</label>
                <Input type="number" min={editingDepoGroup.serialNumbers.length} value={editingQuantity} onChange={(e) => setEditingQuantity(Number(e.target.value || 0))} className="cihaz-pressed !border-0 !ring-0 h-10" style={{ borderRadius: 12 }} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingDepoGroup(null)} disabled={isSavingDepoEdit} className="cihaz-tool-item px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>İptal</button>
                <button onClick={saveDepoQuantityEdit} disabled={isSavingDepoEdit} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40" style={{ background: 'var(--dashboard-accent)' }}>
                  {isSavingDepoEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kaydet
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Personele Transfer Et Dialog */}
      <Dialog open={pTransferModalOpen} onOpenChange={(open) => { if (!isPersonnelTransferring) { setPTransferModalOpen(open); if (!open) { setPTransferItem(null); setPTransferTargetUid(''); setPTransferTargetName(''); setPTransferSearchQuery(''); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" style={{ color: 'var(--dashboard-accent)' }} />
              Personele Transfer Et
            </DialogTitle>
          </DialogHeader>
          {pTransferItem && (() => {
            const availableQty = personnelStock.filter(s => s.status === 'in_stock' && s.ownerUid === pTransferItem.ownerUid && s.stokKodu === pTransferItem.stokKodu).length;
            const targetUsers = users.filter(u => u.uid !== pTransferItem.ownerUid);
            const filteredTargetUsers = pTransferSearchQuery
              ? targetUsers.filter(u => (u.name || '').toLowerCase().includes(pTransferSearchQuery.toLowerCase()))
              : targetUsers;
            return (
              <div className="space-y-4">
                <div className="cihaz-pressed p-3 rounded-xl">
                  <p className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>{pTransferItem.stokAdi}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>
                    {pTransferItem.stokKodu}{pTransferItem.serialNumber ? ` • SN: ${pTransferItem.serialNumber}` : ` • Mevcut: ${availableQty} adet`}
                  </p>
                </div>

                {/* Target personnel selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Hedef Personel</label>
                  {pTransferTargetUid ? (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{ background: 'var(--dashboard-pressed)', borderColor: 'var(--dashboard-stroke)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>{pTransferTargetName}</span>
                      <button onClick={() => { setPTransferTargetUid(''); setPTransferTargetName(''); setPTransferSearchQuery(''); }} className="text-xs px-2 py-0.5 rounded-lg transition-all active:scale-95 hover:bg-black/5" style={{ color: '#B91C1C' }}>Değiştir</button>
                    </div>
                  ) : (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                      <div className="px-3 py-2" style={{ background: 'var(--dashboard-pressed)' }}>
                        <Input
                          placeholder="Personel ara..."
                          value={pTransferSearchQuery}
                          onChange={(e) => setPTransferSearchQuery(e.target.value)}
                          className="!border-0 !ring-0 h-8 text-sm bg-transparent px-0"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {filteredTargetUsers.length === 0 ? (
                          <p className="text-xs text-center py-3" style={{ color: 'var(--dashboard-muted)' }}>Personel bulunamadı.</p>
                        ) : filteredTargetUsers.map(u => (
                          <button
                            key={u.uid}
                            onClick={() => {
                              setPTransferTargetUid(u.uid);
                              setPTransferTargetName(u.name || u.uid);
                              setPTransferSearchQuery('');
                            }}
                            className="w-full flex flex-col px-3 py-2 text-left transition-all hover:bg-black/5"
                            style={{ borderTop: '1px solid var(--dashboard-stroke)' }}
                          >
                            <span className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>{u.name}</span>
                            <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                              {u.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quantity selector — only for non-serial items with multiple units */}
                {!pTransferItem.serialNumber && availableQty > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>
                      Adet <span style={{ color: 'var(--dashboard-muted)', fontWeight: 400 }}>(maks. {availableQty})</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPTransferQuantity(q => Math.max(1, q - 1))}
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition-all active:scale-95"
                        style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                      >−</button>
                      <span className="text-lg font-bold w-8 text-center" style={{ color: 'var(--dashboard-text)' }}>{pTransferQuantity}</span>
                      <button
                        onClick={() => setPTransferQuantity(q => Math.min(availableQty, q + 1))}
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition-all active:scale-95"
                        style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-text)' }}
                      >+</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <button
              onClick={() => setPTransferModalOpen(false)}
              disabled={isPersonnelTransferring}
              className="cihaz-tool-item px-4 py-2 text-sm"
              style={{ color: 'var(--dashboard-muted)' }}
            >
              Vazgeç
            </button>
            <button
              onClick={sendPersonnelTransfer}
              disabled={isPersonnelTransferring || !pTransferTargetUid}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all active:scale-95"
              style={{ background: 'var(--dashboard-accent)' }}
            >
              {isPersonnelTransferring && <Loader2 className="w-4 h-4 animate-spin" />}
              Transferi Gönder
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* İade Et Dialog */}
      <Dialog open={returnModalOpen} onOpenChange={(open) => { if (!isReturning) { setReturnModalOpen(open); if (!open) { setReturnModalItem(null); setReturnNote(''); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" style={{ color: 'var(--dashboard-accent)' }} />
              Depoya İade
            </DialogTitle>
          </DialogHeader>
          {returnModalItem && (
            <div className="space-y-4">
              <div className="cihaz-pressed p-3 rounded-xl">
                <p className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>{returnModalItem.stokAdi}</p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>
                  {returnModalItem.stokKodu}{returnModalItem.serialNumber ? ` • SN: ${returnModalItem.serialNumber}` : ''}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Parça Durumu</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'iyi', label: 'İyi', color: '#16A34A', bg: 'rgba(22,163,74,.1)' },
                    { value: 'miad_gecmis', label: 'Miadı Geçmiş', color: '#D97706', bg: 'rgba(217,119,6,.1)' },
                    { value: 'arizali', label: 'Arızalı', color: '#B91C1C', bg: 'rgba(185,28,28,.1)' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setReturnCondition(opt.value); setReturnNote(''); }}
                      className="px-2 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 border-2"
                      style={{
                        background: returnCondition === opt.value ? opt.bg : 'transparent',
                        color: opt.color,
                        borderColor: returnCondition === opt.value ? opt.color : 'var(--dashboard-stroke)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase flex items-center gap-1" style={{ color: 'var(--dashboard-muted)' }}>
                  {returnCondition === 'arizali' ? 'Arıza Açıklaması' : returnCondition === 'miad_gecmis' ? 'Açıklama' : 'Açıklama (Opsiyonel)'}
                  {(returnCondition === 'arizali' || returnCondition === 'miad_gecmis') && (
                    <span className="text-[10px] font-bold" style={{ color: '#B91C1C' }}>*</span>
                  )}
                </label>
                <textarea
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  placeholder={
                    returnCondition === 'arizali'
                      ? 'Arızanın detayını açıklayın...'
                      : returnCondition === 'miad_gecmis'
                      ? 'Miadı geçme durumunu açıklayın...'
                      : 'Varsa açıklama ekleyebilirsiniz...'
                  }
                  rows={3}
                  className="w-full text-sm resize-none rounded-xl px-3 py-2 !border-0 !ring-0 outline-none"
                  style={{
                    background: 'var(--dashboard-pressed)',
                    color: 'var(--dashboard-text)',
                    borderColor: (returnCondition === 'arizali' || returnCondition === 'miad_gecmis') && !returnNote.trim()
                      ? 'rgba(185,28,28,.4)'
                      : 'var(--dashboard-stroke)',
                    border: '1.5px solid',
                  }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <button
              onClick={() => setReturnModalOpen(false)}
              disabled={isReturning}
              className="cihaz-tool-item px-4 py-2 text-sm"
              style={{ color: 'var(--dashboard-muted)' }}
            >
              Vazgeç
            </button>
            <button
              onClick={initiateReturn}
              disabled={isReturning}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all active:scale-95"
              style={{ background: 'var(--dashboard-accent)' }}
            >
              {isReturning && <Loader2 className="w-4 h-4 animate-spin" />}
              İade Talebini Gönder
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Personnel Stock Dialog */}
      <Dialog open={manualStockModalOpen} onOpenChange={setManualStockModalOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{menuSelection.personnelName} için Manuel Stok Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {manualStockRows.map((row, index) => (
              <div key={row.id} className="cihaz-pressed p-3 grid grid-cols-1 md:grid-cols-12 gap-3" style={{ borderRadius: 14 }}>
                <div className="md:col-span-3 space-y-1">
                  <label className="text-[10px] font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Stok Kodu</label>
                  <Input value={row.stokKodu} onChange={(e) => updateManualStockRow(row.id, 'stokKodu', e.target.value)} placeholder="05521521001" className="!border-0 !ring-0 h-9 text-xs bg-white" style={{ borderRadius: 10 }} />
                </div>
                <div className="md:col-span-4 space-y-1">
                  <label className="text-[10px] font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Stok Adı</label>
                  <Input value={row.stokAdi} onChange={(e) => updateManualStockRow(row.id, 'stokAdi', e.target.value)} placeholder="Ürün adı" className="!border-0 !ring-0 h-9 text-xs bg-white" style={{ borderRadius: 10 }} />
                </div>
                <div className="md:col-span-3 space-y-1">
                  <label className="text-[10px] font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Seri No</label>
                  <Input value={row.serialNumber} onChange={(e) => updateManualStockRow(row.id, 'serialNumber', e.target.value)} placeholder="Opsiyonel" className="!border-0 !ring-0 h-9 text-xs bg-white" style={{ borderRadius: 10 }} />
                </div>
                <div className="md:col-span-1 space-y-1">
                  <label className="text-[10px] font-semibold uppercase" style={{ color: 'var(--dashboard-muted)' }}>Adet</label>
                  <Input type="number" min={1} value={row.quantity} onChange={(e) => updateManualStockRow(row.id, 'quantity', Number(e.target.value))} disabled={!!row.serialNumber.trim()} className="!border-0 !ring-0 h-9 text-xs bg-white" style={{ borderRadius: 10 }} />
                </div>
                <div className="md:col-span-1 flex items-end">
                  <button onClick={() => removeManualStockRow(row.id)} disabled={manualStockRows.length === 1} className="p-2 rounded-lg hover:bg-black/5 transition disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" style={{ color: '#B91C1C' }} /></button>
                </div>
              </div>
            ))}
            <button onClick={addManualStockRow} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
              <Plus className="w-3.5 h-3.5" /> Satır Ekle
            </button>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setManualStockModalOpen(false)} className="cihaz-tool-item px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>Vazgeç</button>
            <button onClick={saveManualPersonnelStock} disabled={isSavingManualStock} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40" style={{ background: 'var(--dashboard-accent)' }}>
              {isSavingManualStock && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kaydet
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Observation Modal — shows full transfer history of a single stock item */}
      <Dialog open={observationOpen} onOpenChange={(open) => {
        if (!open) {
          setObservationOpen(false);
          setObservationItem(null);
          setObservationLogs([]);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Ürün Gözlem Geçmişi
            </DialogTitle>
          </DialogHeader>

          {observationItem && (
            <div className="cihaz-pressed rounded-xl p-3 text-xs space-y-1" style={{ color: 'var(--dashboard-text)' }}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Ürün:</span>
                <span>{observationItem.stokAdi}</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>({observationItem.stokKodu})</span>
              </div>
              {observationItem.serialNumber && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Seri No:</span>
                  <span className="font-mono">{observationItem.serialNumber}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="font-semibold">Konum:</span>
                {observationItem.scope === 'personal' ? (
                  <span>Personel Stoğu · {observationItem.ownerName || '—'}</span>
                ) : (
                  <span>Havuz Depo · {observationItem.poolWarehouseName || '—'}</span>
                )}
              </div>
            </div>
          )}

          {observationLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
              <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted)' }}>Geçmiş yükleniyor...</span>
            </div>
          ) : observationLogs.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--dashboard-muted)' }}>
              Bu ürüne ait log kaydı bulunamadı.
            </div>
          ) : (
            <div className="space-y-2">
              {observationLogs.map((log: any) => {
                const ts: Date = log._timestamp instanceof Date ? log._timestamp : new Date(log._timestamp);
                const action = String(log.action || '');
                const actionLabelMap: Record<string, string> = {
                  transfer_to_personnel: 'Personele Transfer',
                  transfer_to_pool: 'Havuz Depoya Transfer',
                  transfer_between_personnel: 'Personelden Personele Transfer',
                  transfer_approved: 'Transfer Onaylandı',
                  transfer_rejected: 'Transfer Reddedildi',
                  use_on_device: 'Cihazda Kullanıldı',
                  use_from_pool: 'Havuzdan Kullanıldı',
                  return_to_depot: 'Depoya İade',
                  submit_to_depot: 'Depoya Teslim',
                  return_confirmed: 'İade Onaylandı',
                  submit_confirmed: 'Teslim Onaylandı',
                  cancel_usage: 'Kullanım İptali',
                  borrowed_rejected: 'Borç Reddedildi',
                  borrowed_approved: 'Borç Onaylandı',
                  transfer_cikis: 'Depodan Çıkış',
                  iade_giris: 'Depoya Giriş',
                  stok_duzeltme: 'Depo Stok Düzeltme',
                  depo_stock_adjusted: 'Depo Stok Ayarlandı',
                  depo_serial_deleted: 'Depo Seri Kaydı Silindi',
                  depo_stock_deleted_admin: 'Depo Stok Kaydı Silindi',
                  personnel_stock_deleted_admin: 'Personel Stok Kaydı Silindi',
                  pool_stock_deleted_admin: 'Havuz Stok Kaydı Silindi',
                  stock_snapshot: 'Stok Kaydı Oluşturuldu',
                };
                const actionLabel = actionLabelMap[action] || action || 'İşlem';

                const whoFrom = log.fromName || log.createdByName || '';
                const whoTo = log.toName || log.poolWarehouseName || log.ownerName || '';
                const qty = Number(log.quantity) || 1;
                const notes = String(log.notes || '');
                const detailRows = [
                  { label: 'Kaynak', value: log._source === 'depo' ? 'Depo Log' : log._source === 'snapshot' ? 'Stok Kaydı' : 'Transfer Log' },
                  { label: 'Kimden', value: whoFrom },
                  { label: 'Hedef', value: whoTo },
                  { label: 'Transfer Eden', value: log.transferredByName },
                  { label: 'Onaylayan', value: log.approvedByName },
                  { label: 'Kullanan', value: log.usedByName || log.borrowedByName },
                  { label: 'Lab', value: log.labName || log.usedOnLabName },
                  { label: 'Cihaz', value: log.deviceName || log.usedOnDeviceName },
                  { label: 'Form', value: log.formId || log.usedOnFormId },
                  { label: 'Durum', value: log.status || log.approvalStatus },
                  { label: 'İşlem No', value: log.id },
                ].filter((row) => row.value);

                return (
                  <div key={`${log._source || 'log'}-${log.id}`} className="cihaz-card p-3 rounded-xl space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>
                        {actionLabel}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>
                        {format(ts, 'dd.MM.yyyy HH:mm', { locale: tr })}
                      </span>
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>
                      {whoFrom && (<span>Kimden: <strong style={{ color: 'var(--dashboard-text)' }}>{whoFrom}</strong> · </span>)}
                      {whoTo && (<span>Hedef: <strong style={{ color: 'var(--dashboard-text)' }}>{whoTo}</strong> · </span>)}
                      <span>Adet: <strong style={{ color: 'var(--dashboard-text)' }}>{qty}</strong></span>
                    </div>
                    {detailRows.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                        {detailRows.map((row) => (
                          <span key={`${log._source || 'log'}-${log.id}-${row.label}`}>
                            {row.label}: <strong style={{ color: 'var(--dashboard-text)' }}>{String(row.value)}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                    {notes && (
                      <p className="text-[11px] italic" style={{ color: 'var(--dashboard-muted)' }}>
                        {notes}
                      </p>
                    )}
                    {log.createdByName && log.createdByName !== whoFrom && (
                      <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                        Kaydeden: {log.createdByName}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <button
              onClick={() => { setObservationOpen(false); setObservationItem(null); setObservationLogs([]); }}
              className="cihaz-tool-item px-4 py-2 text-xs font-medium"
              style={{ color: 'var(--dashboard-muted)' }}
            >
              Kapat
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
