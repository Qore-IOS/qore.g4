'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
} from 'firebase/firestore';
import type { ProductCode, User, PendingReturn, SparePartTransferRow, PersonalStockItem, YedekParcaDepoStokItem, Device, Hospital, Depot, DeviceLabPool, PoolWarehouseStockItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
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
import { emitSparePartTransfer } from '@/lib/notifications';

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
  const { currentUserProfile } = useAuth();
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
  const [personnelStockFilter, setPersonnelStockFilter] = useState<'all' | 'used' | 'unused'>('all');
  const ITEMS_PER_PAGE = 20;

  // All personnel stock for toplam stok view
  const [allPersonnelStock, setAllPersonnelStock] = useState<PersonalStockItem[]>([]);
  const [allStockLoading, setAllStockLoading] = useState(false);
  const [takingOverStockId, setTakingOverStockId] = useState<string | null>(null);
  const [historyActionFilter, setHistoryActionFilter] = useState<string>('all');
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
  const [poolStockPage, setPoolStockPage] = useState(0);

  // Check authorization
  const isAuthorized = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik' || currentUserProfile?.role === 'teknik_servis' || currentUserProfile?.role === 'aplikasyon';
  const isAdmin = currentUserProfile?.role === 'admin';
  const isTeknikLojistik = currentUserProfile?.role === 'teknik_lojistik';

  const loadRecentTransferLogs = useCallback(async () => {
    const logsSnap = await getDocs(collection(db, 'sparePartTransferLogs'));
    const logs = logsSnap.docs.map(d => {
      const data = d.data();
      const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
      return { id: d.id, ...data, timestamp };
    });
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setTransferLogs(logs.slice(0, 50));
  }, []);

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
          getDocs(query(collection(db, 'productCodes'), where('urunGrubu', '==', 'yedek_parca'))),
          getDocs(collection(db, 'def_brands')),
        ]);
        const sparePartProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        const brands = brandsSnap.docs
          .map(d => String(d.data().name || '').trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'tr'));
        setProductCodes(sparePartProducts);
        setBrandOptions(brands);

        // Fetch depot stock - only products in the depot
        const stokSnap = await getDocs(collection(db, 'yedekParcaDepoStok'));
        const stokItems = stokSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as YedekParcaDepoStokItem;
        });
        setDepoStok(stokItems);

        // Fetch technicians and application specialists
        const usersSnap = await getDocs(collection(db, 'users'));
        const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
        setUsers(allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon'));

        // Fetch pending returns (status === 'pending')
        const pendingQuery = query(
          collection(db, 'pendingReturns'),
          where('status', '==', 'pending')
        );
        const pendingSnap = await getDocs(pendingQuery);
        const pending = pendingSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            requestedAt: data.requestedAt?.toDate ? data.requestedAt.toDate() : new Date(),
          } as PendingReturn;
        });
        pending.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        setPendingReturns(pending);

        // Fetch borrowed spare parts (status === 'pending')
        const borrowedQuery = query(
          collection(db, 'borrowedSpareParts'),
          where('status', '==', 'pending')
        );
        const borrowedSnap = await getDocs(borrowedQuery);
        const borrowed = borrowedSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            borrowedAt: data.borrowedAt?.toDate ? data.borrowedAt.toDate() : new Date(),
          };
        });
        borrowed.sort((a, b) => new Date(b.borrowedAt).getTime() - new Date(a.borrowedAt).getTime());
        setBorrowedParts(borrowed);

        // Fetch pool warehouses (depots with isPoolWarehouse = true)
        const depotsSnap = await getDocs(collection(db, 'depots'));
        const allDepots = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Depot);
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
      const key = item.stokKodu;
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

    const sorted = Array.from(grouped.values()).sort((a, b) => a.stokKodu.localeCompare(b.stokKodu));
    setDepoStokProducts(sorted);
  }, [depoStok, productCodes]);

  // Fetch depo stok when selected
  const fetchDepoStok = useCallback(async () => {
    setDepoStokLoading(true);
    try {
      const stokSnap = await getDocs(collection(db, 'yedekParcaDepoStok'));
      const stokItems = stokSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        } as YedekParcaDepoStokItem;
      });
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
        batch.set(depoLogRef, {
          action: 'stok_duzeltme',
          productCodeId: existing.productCodeId,
          stokKodu: existing.stokKodu,
          stokAdi: existing.stokAdi,
          anaBirim: existing.anaBirim || 'Adet',
          address: nextAddress,
          cihazGrubu: existing.cihazGrubu || '',
          serialNumber: existing.serialNumber || '',
          quantity: Math.abs(nextQuantity - existing.quantity),
          notes: `Excel stok güncelleme: adet ${existing.quantity} -> ${nextQuantity}, adres "${existing.address || '-'}" -> "${nextAddress || '-'}"`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });

        const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(transferLogRef, {
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
        });

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
      const stockItems = stockSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          usedAt: data.usedAt?.toDate ? data.usedAt.toDate() : undefined,
        } as PersonalStockItem;
      });

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
      const stockQuery = query(
        collection(db, 'personalStock'),
        where('status', '==', 'in_stock')
      );
      const stockSnap = await getDocs(stockQuery);
      const stockItems = stockSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        } as PersonalStockItem;
      });
      stockItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAllPersonnelStock(stockItems);
    } catch (err) {
      console.error('Error fetching all personnel stock:', err);
      toast({ title: 'Hata', description: 'Toplam stok verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setAllStockLoading(false);
    }
  }, [toast]);

  // Fetch pool warehouse stock
  const fetchPoolStock = useCallback(async (poolWarehouseId: string) => {
    setPoolStockLoading(true);
    setPoolStockPage(0);
    setPoolStockFilter('all');
    try {
      const stockQuery = query(
        collection(db, 'poolWarehouseStock'),
        where('poolWarehouseId', '==', poolWarehouseId)
      );
      const stockSnap = await getDocs(stockQuery);
      const stockItems = stockSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          usedAt: data.usedAt?.toDate ? data.usedAt.toDate() : undefined,
        } as PoolWarehouseStockItem;
      });
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
    if (personnelStockFilter === 'used') {
      return personnelStock.filter(s => s.status === 'used' || s.status === 'pending_return');
    }
    if (personnelStockFilter === 'unused') {
      return personnelStock.filter(s => s.status === 'in_stock');
    }
    return personnelStock;
  }, [personnelStock, personnelStockFilter]);

  // Paginated personnel stock
  const paginatedPersonnelStock = useMemo(() => {
    const start = personnelStockPage * ITEMS_PER_PAGE;
    return filteredPersonnelStock.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPersonnelStock, personnelStockPage]);

  const totalPersonnelPages = Math.ceil(filteredPersonnelStock.length / ITEMS_PER_PAGE);

  // Pool stock filtering and pagination
  const filteredPoolStock = useMemo(() => {
    if (poolStockFilter === 'used') {
      return poolStock.filter(s => s.status === 'used');
    }
    if (poolStockFilter === 'unused') {
      return poolStock.filter(s => s.status === 'in_stock');
    }
    return poolStock;
  }, [poolStock, poolStockFilter]);

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

  // Handle serial number change - if serial entered, qty must be 1
  const handleTransferSerialChange = (value: string) => {
    setSerialNumber(value);
    if (value.trim()) {
      setTransferQuantity(1);
    }
  };

  // Add row to transfer list
  const addTransferRow = useCallback(() => {
    if (!selectedProduct || !selectedTransferTarget) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün ve hedef seçin.', variant: 'destructive' });
      return;
    }

    const trackingInput = serialNumber.trim();
    const selectedEntry = trackingInput
      ? selectedProduct.serialNumbers.find(s => s.serialNumber === trackingInput || s.hucreNumarasi === trackingInput)
      : undefined;
    const resolvedSerial = selectedEntry?.serialNumber || '';
    const resolvedHucre = selectedEntry?.hucreNumarasi || '';
    const qty = trackingInput ? 1 : Math.max(1, Math.floor(transferQuantity));

    // Check for duplicate serial number in current rows
    if (trackingInput && transferRows.some(r => (resolvedSerial && r.serialNumber === resolvedSerial) || (resolvedHucre && r.hucreNumarasi === resolvedHucre))) {
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

    // If serial/hücre selected, verify it exists in depot
    if (trackingInput && !selectedEntry) {
      toast({ title: 'Uyarı', description: 'Bu seri veya hücre numarası depoda bulunamadı.', variant: 'default' });
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
    setTransferQuantity(1);

    const label = trackingInput
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
  }, [selectedProduct, serialNumber, transferQuantity, selectedTransferTarget, transferRows, toast]);

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
      const batch = writeBatch(db);
      const now = new Date();

      for (const row of transferRows) {
        const isPoolTarget = row.targetUid.startsWith('pool_');
        const poolWarehouseId = isPoolTarget ? row.targetUid.replace('pool_', '') : '';

        if (row.serialNumber || row.hucreNumarasi) {
          // Tekil takipli: depodan ilgili seri/hücre kaydını bul ve sil
          const depoItem = depoStok.find(
            d => d.stokKodu === row.stokKodu && (
              (row.serialNumber && d.serialNumber === row.serialNumber) ||
              (row.hucreNumarasi && d.hucreNumarasi === row.hucreNumarasi)
            )
          );
          if (depoItem) {
            batch.delete(doc(db, 'yedekParcaDepoStok', depoItem.id));
          }

          const hucreData = row.hucreNumarasi ? { hucreNumarasi: row.hucreNumarasi } : {};

          if (isPoolTarget) {
            // Havuz deposuna ekle
            const poolStockRef = doc(collection(db, 'poolWarehouseStock'));
            batch.set(poolStockRef, {
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
            });

            // Transfer log
            const logRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(logRef, {
              action: 'transfer_to_pool',
              poolStockId: poolStockRef.id,
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
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            });
          } else {
            // Personel stokuna ekle
            const stockRef = doc(collection(db, 'personalStock'));
            batch.set(stockRef, {
              ownerUid: row.targetUid,
              ownerName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              source: 'depot',
              status: 'in_stock',
              createdAt: Timestamp.fromDate(now),
              transferredByUid: currentUserProfile?.uid || '',
              transferredByName: currentUserProfile?.name || '',
            });

            // Transfer log
            const logRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(logRef, {
              action: 'transfer_to_personnel',
              personalStockId: stockRef.id,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: row.serialNumber,
              ...hucreData,
              toUid: row.targetUid,
              toName: row.targetName,
              quantity: 1,
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            });
          }

          // Depo log
          const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
          batch.set(depoLogRef, {
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
          });
        } else {
          // Seri numarasız: adetli transfer
          let remainingQty = row.quantity;
          const nonSerialEntries = depoStok
            .filter(d => d.stokKodu === row.stokKodu && !d.serialNumber && !d.hucreNumarasi)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // FIFO

          for (const entry of nonSerialEntries) {
            if (remainingQty <= 0) break;

            if (entry.quantity <= remainingQty) {
              batch.delete(doc(db, 'yedekParcaDepoStok', entry.id));
              remainingQty -= entry.quantity;
            } else {
              batch.update(doc(db, 'yedekParcaDepoStok', entry.id), {
                quantity: entry.quantity - remainingQty,
              });
              remainingQty = 0;
            }
          }

          if (isPoolTarget) {
            // Havuz deposuna ekle (her adet için ayrı kayıt)
            for (let i = 0; i < row.quantity; i++) {
              const poolStockRef = doc(collection(db, 'poolWarehouseStock'));
              batch.set(poolStockRef, {
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
              });
            }

            // Transfer log
            const logRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(logRef, {
              action: 'transfer_to_pool',
              poolWarehouseId,
              poolWarehouseName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: '',
              toName: row.targetName,
              quantity: row.quantity,
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            });
          } else {
            // Personel stokuna ekle
            for (let i = 0; i < row.quantity; i++) {
              const stockRef = doc(collection(db, 'personalStock'));
              batch.set(stockRef, {
                ownerUid: row.targetUid,
                ownerName: row.targetName,
                productCodeId: row.productCodeId,
                stokKodu: row.stokKodu,
                stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
                serialNumber: '',
                source: 'depot',
                status: 'in_stock',
                createdAt: Timestamp.fromDate(now),
                transferredByUid: currentUserProfile?.uid || '',
                transferredByName: currentUserProfile?.name || '',
              });
            }

            // Transfer log
            const logRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(logRef, {
              action: 'transfer_to_personnel',
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
              serialNumber: '',
              toUid: row.targetUid,
              toName: row.targetName,
              quantity: row.quantity,
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
            });
          }

          // Depo log
          const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
          batch.set(depoLogRef, {
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
          });
        }
      }

      await batch.commit();

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

      const totalItems = transferRows.reduce((s, r) => s + r.quantity, 0);
      toast({
        title: 'Transfer Tamamlandı',
        description: `${totalItems} adet yedek parça başarıyla transfer edildi.`,
      });

      setTransferRows([]);

      // Refresh data
      const stokSnap = await getDocs(collection(db, 'yedekParcaDepoStok'));
      const stokItems = stokSnap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date() } as YedekParcaDepoStokItem;
      });
      setDepoStok(stokItems);

      // Refresh logs
      await loadRecentTransferLogs();
    } catch (err) {
      console.error('Error executing transfer:', err);
      toast({ title: 'Hata', description: 'Transfer sırasında hata oluştu.', variant: 'destructive' });
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
        for (let i = 0; i < quantityToCreate; i++) {
          const stockRef = doc(collection(db, 'personalStock'));
          batch.set(stockRef, {
            ownerUid: menuSelection.personnelUid,
            ownerName: menuSelection.personnelName,
            productCodeId: '',
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
            serialNumber: row.serialNumber,
            source: 'depot',
            status: 'in_stock',
            createdAt: now,
            transferredByUid: currentUserProfile?.uid || '',
            transferredByName: currentUserProfile?.name || '',
            manualEntry: true,
          });
        }

        const logRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(logRef, {
          action: 'transfer_to_personnel',
          productCodeId: '',
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
              anaBirim: row.anaBirim || 'Adet',
          serialNumber: row.serialNumber,
          toUid: menuSelection.personnelUid,
          toName: menuSelection.personnelName,
          quantity: quantityToCreate,
          createdAt: now,
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
          notes: 'Manuel stok girişi',
          manualEntry: true,
        });
      });

      await batch.commit();
      await fetchPersonnelStock(menuSelection.personnelUid);
      await fetchAllPersonnelStock();
      await loadRecentTransferLogs();

      const totalQuantity = cleanedRows.reduce((sum, row) => sum + (row.serialNumber ? 1 : row.quantity), 0);
      toast({
        title: 'Başarılı',
        description: `${totalQuantity} adet stok ${menuSelection.personnelName} personeline manuel olarak eklendi.`,
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
        batch.set(stockRef, {
          productCodeId: editingDepoGroup.productCodeId,
          stokKodu: editingDepoGroup.stokKodu,
          stokAdi: editingDepoGroup.stokAdi,
          anaBirim: editingDepoGroup.anaBirim || 'Adet',
          serialNumber: '',
          quantity: nextNonSerialTotal,
          address: '',
          cihazGrubu: editingDepoGroup.cihazGrubu || '',
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      const delta = nextTotal - oldTotal;

      const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
      batch.set(depoLogRef, {
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
      });

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, {
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
      });

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
      batch.set(depoLogRef, {
        action: 'stok_duzeltme',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        cihazGrubu: group.cihazGrubu || '',
        serialNumber: serialEntry.serialNumber,
        quantity: 1,
        notes: `Seri numaralı stok kaydı silindi: ${serialEntry.serialNumber}`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, {
        action: 'depo_serial_deleted',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        serialNumber: serialEntry.serialNumber,
        quantity: 1,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

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

      const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
      batch.set(depoLogRef, {
        action: 'stok_silme_admin',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        cihazGrubu: group.cihazGrubu || '',
        serialNumber: '',
        address: group.entries.find(e => (e.address || '').trim())?.address || '',
        quantity: group.totalQuantity,
        notes: `Admin stok satırı silme: ${group.totalQuantity} adet kayıt kaldırıldı.`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

      const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
      batch.set(transferLogRef, {
        action: 'depo_stock_deleted_admin',
        productCodeId: group.productCodeId,
        stokKodu: group.stokKodu,
        stokAdi: group.stokAdi,
        anaBirim: group.anaBirim || 'Adet',
        serialNumber: '',
        quantity: group.totalQuantity,
        notes: 'Admin depo stok satırı silme işlemi',
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

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

    const shouldDelete = window.confirm(`${item.stokKodu} (${item.serialNumber || 'Seri No Yok'}) personel stok kaydı silinsin mi?`);
    if (!shouldDelete) return;

    try {
      const now = new Date();
      await deleteDoc(doc(db, 'personalStock', item.id));

      await addDoc(collection(db, 'sparePartTransferLogs'), {
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
        notes: `${isAdmin ? 'Admin' : 'Teknik Lojistik'} personel stok satırı silme işlemi`,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
      await fetchAllPersonnelStock();
      await loadRecentTransferLogs();

      toast({ title: 'Personel Stok Kaydı Silindi', description: `${item.stokKodu} kaydı kaldırıldı.` });
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

      await addDoc(collection(db, 'sparePartTransferLogs'), {
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
      });

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
        await addDoc(collection(db, 'yedekParcaDepoStok'), {
          productCodeId: pendingReturn.productCodeId,
          stokKodu: pendingReturn.stokKodu,
          stokAdi: pendingReturn.stokAdi,
          anaBirim: pendingReturn.anaBirim || 'Adet',
          cihazGrubu: pc?.cihazGrubu || '',
          serialNumber: pendingReturn.serialNumber || '',
          address: '',
          quantity: 1,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });

        // Depo log for return
        await addDoc(collection(db, 'yedekParcaDepoLog'), {
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
          notes: `İade teslim alındı: ${pendingReturn.ownerName} -> Depo`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      // Create log entry
      await addDoc(collection(db, 'sparePartTransferLogs'), {
        action: pendingReturn.returnType === 'return_to_depot' ? 'return_confirmed' : 'submit_confirmed',
        personalStockId: pendingReturn.personalStockId,
        stokKodu: pendingReturn.stokKodu,
        stokAdi: pendingReturn.stokAdi,
          anaBirim: pendingReturn.anaBirim || 'Adet',
        serialNumber: pendingReturn.serialNumber,
        fromUid: pendingReturn.ownerUid,
        fromName: pendingReturn.ownerName,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile?.uid || '',
        createdByName: currentUserProfile?.name || '',
      });

      toast({
        title: 'Teslim Alındı',
        description: `${pendingReturn.stokAdi} (${pendingReturn.serialNumber || 'Seri No Yok'}) depoya teslim alındı.`,
      });

      setPendingReturns(prev => prev.filter(p => p.id !== pendingReturn.id));

      // Refresh depot stock
      fetchDepoStok();
    } catch (err) {
      console.error('Error confirming return:', err);
      toast({ title: 'Hata', description: 'İşlem sırasında hata oluştu.', variant: 'destructive' });
    }
  };

  // Approve borrowed part
  const approveBorrowedPart = async (borrowed: any) => {
    try {
      const now = new Date();

      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'approved',
        approvedAt: Timestamp.fromDate(now),
        approvedByUid: currentUserProfile?.uid || '',
        approvedByName: currentUserProfile?.name || '',
      });

      await addDoc(collection(db, 'sparePartTransferLogs'), {
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
      });

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
    try {
      const now = new Date();

      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'rejected',
        rejectedAt: Timestamp.fromDate(now),
        rejectedByUid: currentUserProfile?.uid || '',
        rejectedByName: currentUserProfile?.name || '',
      });

      await addDoc(collection(db, 'sparePartTransferLogs'), {
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
      });

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

  const takeOverPersonnelStock = async (item: PersonalStockItem) => {
    if (!currentUserProfile?.uid || !currentUserProfile?.name) {
      toast({ title: 'Hata', description: 'Kullanıcı bilgisi bulunamadı.', variant: 'destructive' });
      return;
    }

    if (item.ownerUid === currentUserProfile.uid) {
      toast({ title: 'Bilgi', description: 'Bu ürün zaten sizin üzerinizde.', variant: 'default' });
      return;
    }

    if (item.status !== 'in_stock') {
      toast({ title: 'Uyarı', description: 'Sadece aktif stok devralınabilir.', variant: 'default' });
      return;
    }

    setTakingOverStockId(item.id);
    try {
      const now = new Date();
      await updateDoc(doc(db, 'personalStock', item.id), {
        ownerUid: currentUserProfile.uid,
        ownerName: currentUserProfile.name,
        createdAt: Timestamp.fromDate(now),
        transferredByUid: currentUserProfile.uid,
        transferredByName: currentUserProfile.name,
        previousOwnerUid: item.ownerUid,
        previousOwnerName: item.ownerName,
      });

      await addDoc(collection(db, 'sparePartTransferLogs'), {
        action: 'transfer_between_personnel',
        personalStockId: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim || 'Adet',
        serialNumber: item.serialNumber || '',
        quantity: 1,
        fromUid: item.ownerUid,
        fromName: item.ownerName,
        toUid: currentUserProfile.uid,
        toName: currentUserProfile.name,
        createdAt: Timestamp.fromDate(now),
        createdByUid: currentUserProfile.uid,
        createdByName: currentUserProfile.name,
      });

      toast({
        title: 'Üzerinize Alındı',
        description: `${item.stokAdi} (${item.serialNumber || 'Seri No Yok'}) stoğunuza eklendi.`,
      });

      if (menuSelection.personnelUid) {
        await fetchPersonnelStock(menuSelection.personnelUid);
      }
      await fetchAllPersonnelStock();
      await loadRecentTransferLogs();
    } catch (err) {
      console.error('Error taking over personal stock:', err);
      toast({ title: 'Hata', description: 'Ürünü üzerinize alma işlemi başarısız oldu.', variant: 'destructive' });
    } finally {
      setTakingOverStockId(null);
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
      transfer_between_personnel: 'Personelden Personele Devir',
      depo_stock_deleted_admin: 'Admin Depo Stok Silme',
      personnel_stock_deleted_admin: 'Admin Personel Stok Silme',
      pool_stock_deleted_admin: 'Admin Havuz Stok Silme',
    };
    return labels[action] || action;
  };

  const filteredHistoryLogs = useMemo(() => {
    if (historyActionFilter === 'all') return transferLogs;
    return transferLogs.filter((log) => log.action === historyActionFilter);
  }, [historyActionFilter, transferLogs]);

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
          { key: 'pending' as const, label: `İade (${pendingReturns.length})`, icon: <Clock className="w-3 h-3" /> },
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
                            <CommandItem key={product.stokKodu} value={`${product.stokKodu} ${product.stokAdi}`} onSelect={() => { setSelectedStokKodu(product.stokKodu); setProductSearchOpen(false); setSerialNumber(''); setTransferQuantity(1); }}>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Seri No / Hücre</label>
                  <div className="flex gap-1.5">
                    <Input placeholder="Seri no veya hücre" value={serialNumber} onChange={(e) => handleTransferSerialChange(e.target.value)} className="cihaz-pressed !border-0 !ring-0 h-9 text-xs flex-1" style={{ borderRadius: 10 }} />
                    {selectedProduct.serialNumbers.length > 0 && (
                      <Popover open={serialSelectOpen} onOpenChange={setSerialSelectOpen}>
                        <PopoverTrigger asChild>
                          <button className="cihaz-tool-item px-2 py-1 text-[10px] font-medium flex-shrink-0" style={{ color: 'var(--dashboard-text)' }}>
                            <List className="w-3 h-3 inline mr-0.5" /> {selectedProduct.serialNumbers.length}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[320px] p-0">
                          <Command>
                            <CommandInput placeholder="Seri no ara…" />
                            <CommandList>
                              <CommandEmpty>Bulunamadı.</CommandEmpty>
                              <CommandGroup heading={`${selectedProduct.stokKodu}`}>
                                {selectedProduct.serialNumbers.filter(sn => !transferRows.some(r => (sn.serialNumber && r.serialNumber === sn.serialNumber) || (sn.hucreNumarasi && r.hucreNumarasi === sn.hucreNumarasi))).map(sn => (
                                  <CommandItem key={sn.id} value={sn.serialNumber || sn.hucreNumarasi || sn.id} onSelect={() => { setSerialNumber(sn.serialNumber || sn.hucreNumarasi || ''); setTransferQuantity(1); setSerialSelectOpen(false); }}>
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
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Adet</label>
                  <Input type="number" min={1} max={selectedProduct.totalQuantity} value={serialNumber.trim() ? 1 : transferQuantity} onChange={(e) => setTransferQuantity(Math.max(1, parseInt(e.target.value) || 1))} disabled={!!serialNumber.trim()} className="cihaz-pressed !border-0 !ring-0 h-9 text-xs" style={{ borderRadius: 10 }} />
                  <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{serialNumber.trim() ? 'Tekil takip (seri/hücre) → adet 1' : `Depoda: ${selectedProduct.totalQuantity}`}</p>
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
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => approveBorrowedPart(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white" style={{ background: '#16A34A' }}><CheckCircle className="w-3 h-3" /> Onayla</button>
                <button onClick={() => rejectBorrowedPart(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white" style={{ background: '#B91C1C' }}><XCircle className="w-3 h-3" /> Reddet</button>
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
                  <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{format(item.requestedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}</span>
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {item.imageUrl && <button onClick={() => setPreviewImage(item.imageUrl!)} className="cihaz-tool-item p-1.5"><ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} /></button>}
                <button onClick={() => confirmPendingReturn(item)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-white" style={{ background: '#16A34A' }}><CheckCircle className="w-3 h-3" /> Teslim Al</button>
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
                  <option value="transfer_to_personnel">Personele Transfer</option>
                  <option value="transfer_between_personnel">Personelden Personele Devir</option>
                  <option value="return_confirmed">İade Teslim Alındı</option>
                  <option value="submit_confirmed">Teslim Alındı</option>
                  <option value="use_on_device">Cihazda Kullanıldı</option>
                  <option value="borrowed_part">Borç Parça</option>
                  <option value="borrowed_approved">Borç Onaylandı</option>
                  <option value="borrowed_rejected">Borç Reddedildi</option>
                  <option value="depo_stock_adjusted">Depo Stok Güncellendi</option>
                  <option value="depo_serial_deleted">Depo Seri No Silindi</option>
                  <option value="depo_stock_deleted_admin">Admin Depo Stok Silme</option>
                  <option value="personnel_stock_deleted_admin">Admin Personel Stok Silme</option>
                  <option value="pool_stock_deleted_admin">Admin Havuz Stok Silme</option>
                </select>
              </div>

              {/* Log list */}
              <div className="cihaz-card overflow-hidden" style={{ maxHeight: 500, overflowY: 'auto' }}>
                <div className="divide-y" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                  {filteredHistoryLogs.map(log => {
                    const isTransferAction = log.action === 'transfer_to_personnel' || log.action === 'transfer_between_personnel';
                    return (
                      <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 hover:bg-black/[.02] transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: 'rgba(107,114,128,.10)', color: 'var(--dashboard-muted)' }}>{getActionLabel(log.action)}</span>
                            <span className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>{log.stokAdi}</span>
                          </div>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>
                            {log.stokKodu} {log.serialNumber ? `· SN: ${log.serialNumber}` : ''} · x{log.quantity || 1} {(log as any).anaBirim ? String((log as any).anaBirim).toLocaleLowerCase('tr-TR') : 'adet'} · {log.toName || log.fromName || '—'} · {log.createdByName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{format(log.timestamp, 'dd.MM.yy HH:mm', { locale: tr })}</span>
                          {isTransferAction && <SparePartTransferTutanakPDFButton log={log} className="h-6 px-2 text-[10px]" />}
                          {log.usageImageUrl && <button onClick={() => setPreviewImage(log.usageImageUrl)} className="cihaz-tool-item p-1"><ImageIcon className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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

      const refreshedProducts = await getDocs(query(collection(db, 'productCodes'), where('urunGrubu', '==', 'yedek_parca')));
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
                      <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Adres: {group.entries.find(e => (e.address || '').trim())?.address || '—'}</p>
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
    const activeCount = personnelStock.filter(s => s.status === 'in_stock').length;
    const usedCount = personnelStock.filter(s => s.status === 'used' || s.status === 'pending_return').length;

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
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>
                  {menuSelection.personnelRole === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'} personeli
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {activeCount} Aktif
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-muted)' }}>
                  {usedCount} Kullanıldı
                </span>
              </div>
              <div className="mt-2 inline-flex gap-1 p-1 cihaz-pressed" style={{ borderRadius: 12 }}>
                {([
                  { key: 'all', label: 'Tamamını Göster' },
                  { key: 'used', label: 'Kullanılanları Göster' },
                  { key: 'unused', label: 'Kullanılmayanları Göster' },
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
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Transfer</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Kullanım</th>
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
                        <td className="px-4 py-3 text-right">
                          {(isAdmin || isTeknikLojistik) ? (
                            <button
                              onClick={() => deletePersonnelStockItem(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                              style={{ color: '#B91C1C' }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Stok Sil
                            </button>
                          ) : canTakeOver ? (
                            <button
                              disabled={takingOverStockId === item.id}
                              onClick={() => takeOverPersonnelStock(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 disabled:opacity-50"
                              style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                            >
                              {takingOverStockId === item.id && <Loader2 className="h-3 w-3 animate-spin" />}
                              Üzerime Al
                            </button>
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
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                      <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                        {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                        {item.usedAt && ` → ${format(item.usedAt, 'dd.MM.yyyy', { locale: tr })}`}
                      </span>
                      {(isAdmin || isTeknikLojistik) ? (
                        <button
                          onClick={() => deletePersonnelStockItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95 hover:bg-red-50"
                          style={{ color: '#B91C1C' }}
                        >
                          <Trash2 className="h-3 w-3" />
                          Stok Sil
                        </button>
                      ) : canTakeOver ? (
                        <button
                          disabled={takingOverStockId === item.id}
                          onClick={() => takeOverPersonnelStock(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all active:scale-95 disabled:opacity-50"
                          style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-accent)' }}
                        >
                          {takingOverStockId === item.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          Üzerime Al
                        </button>
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
    const activeCount = poolStock.filter(s => s.status === 'in_stock').length;
    const usedCount = poolStock.filter(s => s.status === 'used').length;

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
              <div className="flex items-center gap-3 mt-1.5">
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {activeCount} Aktif
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--dashboard-pressed)', color: 'var(--dashboard-muted)' }}>
                  {usedCount} Kullanıldı
                </span>
              </div>
              <div className="mt-2 inline-flex gap-1 p-1 cihaz-pressed" style={{ borderRadius: 12 }}>
                {([
                  { key: 'all', label: 'Tamamını Göster' },
                  { key: 'used', label: 'Kullanılanları Göster' },
                  { key: 'unused', label: 'Kullanılmayanları Göster' },
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
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Transfer</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Kullanım</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Kullanan</th>
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
                      <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                        {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                        {item.usedAt && ` → ${format(item.usedAt, 'dd.MM.yyyy', { locale: tr })}`}
                      </span>
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

    return (
      <div className="space-y-4">
        {/* Header card */}
        <div className="cihaz-card-strong p-4">
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--dashboard-text)' }}>
            <PackageOpen className="h-5 w-5" />
            Personeldeki Toplam Stok
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--dashboard-muted)' }}>
            Tüm personellerde bulunan henüz kullanılmamış yedek parçalar.
            Toplam: <strong style={{ color: 'var(--dashboard-text)' }}>{allPersonnelStock.length}</strong> adet aktif stok.
          </p>
        </div>

        {/* Content */}
        {allStockLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted)' }}>Yükleniyor...</span>
          </div>
        ) : allPersonnelStock.length === 0 ? (
          <div className="text-center py-12">
            <PackageOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>Personellerde aktif yedek parça stoku bulunmuyor.</p>
          </div>
        ) : (
          <div className="space-y-3">
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
    setMenuSelection(selection);

    if (selection.section === 'personnel' && selection.personnelUid) {
      router.push(`/direkt-transfer/yedek-parca-transfer/${selection.personnelUid}`);
    } else if (pathname !== '/direkt-transfer/yedek-parca-transfer') {
      router.push('/direkt-transfer/yedek-parca-transfer');
    }

    closeMenu?.();
  }, [pathname, router]);


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
        {menuItem('transfer', <Send className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-accent)' }} />, 'Transfer Paneli', 'Transfer, borç, iade, geçmiş',
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
        return renderTransferPanel();
      case 'depo-stok':
        return renderDepoStok();
      case 'personnel':
        return renderPersonnelStock();
      case 'toplam-stok':
        return renderToplamStok();
      case 'pool-stok':
        return renderPoolStock();
      default:
        return renderTransferPanel();
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
    <div className="cihaz-shell px-2 py-3 sm:px-4 sm:py-5 space-y-3 sm:space-y-4" style={{ minHeight: '100dvh' }}>

      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => router.push('/direkt-transfer')}
            className="cihaz-tool-item p-1.5"
            style={{ borderRadius: 10 }}
          >
            <ChevronLeft className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />
          </button>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,.12)' }}>
            <Package className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} />
          </div>
          <h1 className="text-base sm:text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>Yedek Parça Yönetimi</h1>
        </div>
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
    </div>
  );
}
