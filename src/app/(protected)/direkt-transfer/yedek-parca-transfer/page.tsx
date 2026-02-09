'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  Timestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';
import type { ProductCode, User, PendingReturn, SparePartTransferRow, PersonalStockItem, YedekParcaDepoStokItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  Search,
  Send,
  CheckCircle,
  Clock,
  ArrowLeftRight,
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
  Info,
  Hash,
  List,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Menu selection types
type MenuSection = 'transfer' | 'depo-stok' | 'toplam-stok' | 'personnel';
interface MenuSelection {
  section: MenuSection;
  personnelUid?: string;
  personnelName?: string;
  personnelRole?: string;
}

// Grouped stock item for depo stok view
interface GroupedDepoStokItem {
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  cihazGrubu: string;
  totalQuantity: number;
  earliestDate: Date;
  serialNumbers: { serialNumber: string; createdAt: Date; id: string }[];
  entries: YedekParcaDepoStokItem[];
}

export default function YedekParcaTransferPage() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();

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

  // Product code reference for cihazGrubu lookup
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);

  // Personnel stock data
  const [personnelStock, setPersonnelStock] = useState<PersonalStockItem[]>([]);
  const [personnelStockLoading, setPersonnelStockLoading] = useState(false);
  const [personnelStockPage, setPersonnelStockPage] = useState(0);
  const ITEMS_PER_PAGE = 20;

  // All personnel stock for toplam stok view
  const [allPersonnelStock, setAllPersonnelStock] = useState<PersonalStockItem[]>([]);
  const [allStockLoading, setAllStockLoading] = useState(false);

  // Check authorization
  const isAuthorized = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu';

  // Fetch data
  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch product codes for cihazGrubu reference
        const productsQuery = query(
          collection(db, 'productCodes'),
          where('urunGrubu', '==', 'yedek_parca')
        );
        const productsSnap = await getDocs(productsQuery);
        const sparePartProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        setProductCodes(sparePartProducts);

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

        // Fetch recent transfer logs
        const logsSnap = await getDocs(collection(db, 'sparePartTransferLogs'));
        const logs = logsSnap.docs.map(d => {
          const data = d.data();
          const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
          return { id: d.id, ...data, timestamp };
        });
        logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setTransferLogs(logs.slice(0, 50));
      } catch (err) {
        console.error('Error fetching data:', err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthorized, toast]);

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

      if (item.serialNumber) {
        g.serialNumbers.push({
          serialNumber: item.serialNumber,
          createdAt: item.createdAt,
          id: item.id,
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

  // Fetch personnel stock when personnel selected
  const fetchPersonnelStock = useCallback(async (uid: string) => {
    setPersonnelStockLoading(true);
    setPersonnelStockPage(0);
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
      stockItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPersonnelStock(stockItems);
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

  // Handle menu selection changes
  useEffect(() => {
    if (menuSelection.section === 'depo-stok') {
      fetchDepoStok();
    } else if (menuSelection.section === 'personnel' && menuSelection.personnelUid) {
      fetchPersonnelStock(menuSelection.personnelUid);
    } else if (menuSelection.section === 'toplam-stok') {
      fetchAllPersonnelStock();
    }
  }, [menuSelection, fetchDepoStok, fetchPersonnelStock, fetchAllPersonnelStock]);

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

  // Get selected user details
  const selectedUser = useMemo(() => {
    return users.find(u => u.uid === selectedUserId);
  }, [users, selectedUserId]);

  // Separate users by role
  const teknikServisUsers = useMemo(() => users.filter(u => u.role === 'teknik_servis'), [users]);
  const aplikasyonUsers = useMemo(() => users.filter(u => u.role === 'aplikasyon'), [users]);

  // Paginated personnel stock
  const paginatedPersonnelStock = useMemo(() => {
    const start = personnelStockPage * ITEMS_PER_PAGE;
    return personnelStock.slice(start, start + ITEMS_PER_PAGE);
  }, [personnelStock, personnelStockPage]);

  const totalPersonnelPages = Math.ceil(personnelStock.length / ITEMS_PER_PAGE);

  // Grouped depo stok for the depo stok view
  const groupedDepoStok = useMemo(() => {
    return depoStokProducts;
  }, [depoStokProducts]);

  // Handle serial number change - if serial entered, qty must be 1
  const handleTransferSerialChange = (value: string) => {
    setSerialNumber(value);
    if (value.trim()) {
      setTransferQuantity(1);
    }
  };

  // Add row to transfer list
  const addTransferRow = useCallback(() => {
    if (!selectedProduct || !selectedUser) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün ve personel seçin.', variant: 'destructive' });
      return;
    }

    const sn = serialNumber.trim();
    const qty = sn ? 1 : Math.max(1, Math.floor(transferQuantity));

    // Check for duplicate serial number in current rows
    if (sn && transferRows.some(r => r.serialNumber === sn)) {
      toast({ title: 'Uyarı', description: 'Bu seri numarası zaten listede var.', variant: 'default' });
      return;
    }

    // Check depot stock availability
    // Already committed rows for same product
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

    // If serial number selected, verify it exists in depot
    if (sn && !selectedProduct.serialNumbers.some(s => s.serialNumber === sn)) {
      toast({ title: 'Uyarı', description: 'Bu seri numarası depoda bulunamadı.', variant: 'default' });
      return;
    }

    const newRow: SparePartTransferRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productCodeId: selectedProduct.productCodeId,
      stokKodu: selectedProduct.stokKodu,
      stokAdi: selectedProduct.stokAdi,
      serialNumber: sn,
      quantity: qty,
      cihazGrubu: selectedProduct.cihazGrubu,
      targetUid: selectedUser.uid || '',
      targetName: selectedUser.name || '',
    };

    setTransferRows(prev => [...prev, newRow]);

    // Reset form
    setSerialNumber('');
    setTransferQuantity(1);

    toast({
      title: 'Eklendi',
      description: sn
        ? `${selectedProduct.stokAdi} (SN: ${sn}) listeye eklendi.`
        : `${selectedProduct.stokAdi} x${qty} listeye eklendi.`,
    });
  }, [selectedProduct, serialNumber, transferQuantity, selectedUser, transferRows, toast]);

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
        if (row.serialNumber) {
          // Seri numaralı: depodan ilgili seri numaralı kaydı bul ve sil
          const depoItem = depoStok.find(
            d => d.stokKodu === row.stokKodu && d.serialNumber === row.serialNumber
          );
          if (depoItem) {
            batch.delete(doc(db, 'yedekParcaDepoStok', depoItem.id));
          }

          // Personel stokuna ekle
          const stockRef = doc(collection(db, 'personalStock'));
          batch.set(stockRef, {
            ownerUid: row.targetUid,
            ownerName: row.targetName,
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            serialNumber: row.serialNumber,
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
            serialNumber: row.serialNumber,
            toUid: row.targetUid,
            toName: row.targetName,
            quantity: 1,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });

          // Depo log
          const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
          batch.set(depoLogRef, {
            action: 'transfer_cikis',
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: row.serialNumber,
            quantity: 1,
            relatedPersonnelUid: row.targetUid,
            relatedPersonnelName: row.targetName,
            notes: `Seri numaralı transfer: ${row.serialNumber} -> ${row.targetName}`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });
        } else {
          // Seri numarasız: adetli transfer
          // Depodan ilgili ürünün seri numarasız kayıtlarından adet düş
          let remainingQty = row.quantity;
          const nonSerialEntries = depoStok
            .filter(d => d.stokKodu === row.stokKodu && !d.serialNumber)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // FIFO

          for (const entry of nonSerialEntries) {
            if (remainingQty <= 0) break;

            if (entry.quantity <= remainingQty) {
              // Tüm kaydı sil
              batch.delete(doc(db, 'yedekParcaDepoStok', entry.id));
              remainingQty -= entry.quantity;
            } else {
              // Adeti düş
              batch.update(doc(db, 'yedekParcaDepoStok', entry.id), {
                quantity: entry.quantity - remainingQty,
              });
              remainingQty = 0;
            }
          }

          // Personel stokuna ekle (seri numarasız, adetli)
          // Her adet için ayrı personalStock kaydı oluştur (takip kolaylığı için)
          for (let i = 0; i < row.quantity; i++) {
            const stockRef = doc(collection(db, 'personalStock'));
            batch.set(stockRef, {
              ownerUid: row.targetUid,
              ownerName: row.targetName,
              productCodeId: row.productCodeId,
              stokKodu: row.stokKodu,
              stokAdi: row.stokAdi,
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
            serialNumber: '',
            toUid: row.targetUid,
            toName: row.targetName,
            quantity: row.quantity,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });

          // Depo log
          const depoLogRef = doc(collection(db, 'yedekParcaDepoLog'));
          batch.set(depoLogRef, {
            action: 'transfer_cikis',
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: '',
            quantity: row.quantity,
            relatedPersonnelUid: row.targetUid,
            relatedPersonnelName: row.targetName,
            notes: `${row.quantity} adet transfer -> ${row.targetName}`,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });
        }
      }

      await batch.commit();

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
      const logsSnap = await getDocs(collection(db, 'sparePartTransferLogs'));
      const logs = logsSnap.docs.map(d => {
        const data = d.data();
        const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
        return { id: d.id, ...data, timestamp };
      });
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setTransferLogs(logs.slice(0, 50));
    } catch (err) {
      console.error('Error executing transfer:', err);
      toast({ title: 'Hata', description: 'Transfer sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setIsTransferring(false);
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
          cihazGrubu: pc?.cihazGrubu || '',
          serialNumber: pendingReturn.serialNumber || '',
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
          cihazGrubu: pc?.cihazGrubu || '',
          serialNumber: pendingReturn.serialNumber || '',
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
    };
    return labels[action] || action;
  };

  // ========== RENDER: Transfer Panel (Right Side Default) ==========
  const renderTransferPanel = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Yedek Parça Transfer Paneli
        </CardTitle>
        <CardDescription>
          Yedek parçaları personel şahsi stoklarına transfer edin. Sadece depoda mevcut ürünler listelenir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="transfer">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="transfer">
              <Send className="h-4 w-4 mr-2" />
              Transfer
            </TabsTrigger>
            <TabsTrigger value="borrowed">
              <HandCoins className="h-4 w-4 mr-2" />
              Borç Alınan ({borrowedParts.length})
            </TabsTrigger>
            <TabsTrigger value="pending">
              <Clock className="h-4 w-4 mr-2" />
              İade Bekleyen ({pendingReturns.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-2" />
              Geçmiş
            </TabsTrigger>
          </TabsList>

          {/* Transfer Tab */}
          <TabsContent value="transfer" className="space-y-4 mt-4">
            {/* Add new transfer row */}
            <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
              <Label className="font-semibold">Yeni Transfer Ekle</Label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Product selector - from depot stock */}
                <div className="space-y-2">
                  <Label>Yedek Parça (Depodaki Ürünler)</Label>
                  <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between"
                      >
                        {selectedProduct
                          ? `${selectedProduct.stokKodu} - ${selectedProduct.stokAdi?.substring(0, 15)}... (${selectedProduct.totalQuantity})`
                          : 'Depodaki ürünlerden seçin...'}
                        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[450px] p-0">
                      <Command>
                        <CommandInput
                          placeholder="Kod veya isim ile ara..."
                          value={productSearchQuery}
                          onValueChange={setProductSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>Depoda eşleşen ürün bulunamadı.</CommandEmpty>
                          <CommandGroup>
                            {filteredProducts.map((product) => (
                              <CommandItem
                                key={product.stokKodu}
                                value={`${product.stokKodu} ${product.stokAdi}`}
                                onSelect={() => {
                                  setSelectedStokKodu(product.stokKodu);
                                  setProductSearchOpen(false);
                                  setSerialNumber('');
                                  setTransferQuantity(1);
                                }}
                              >
                                <div className="flex flex-col flex-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{product.stokKodu}</span>
                                    <Badge variant="secondary" className="text-xs ml-2">
                                      {product.totalQuantity} adet
                                    </Badge>
                                  </div>
                                  <span className="text-sm text-muted-foreground truncate">
                                    {product.stokAdi}
                                  </span>
                                  {product.cihazGrubu && (
                                    <span className="text-xs text-blue-500">
                                      {product.cihazGrubu}
                                    </span>
                                  )}
                                  {product.serialNumbers.length > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      {product.serialNumbers.length} adet seri numaralı
                                    </span>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {selectedProduct?.cihazGrubu && (
                    <div className="flex items-center gap-1 text-xs text-blue-600">
                      <Info className="h-3 w-3" />
                      {selectedProduct.cihazGrubu}
                    </div>
                  )}
                </div>

                {/* User selector */}
                <div className="space-y-2">
                  <Label>Hedef Personel</Label>
                  <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between"
                      >
                        {selectedUser ? selectedUser.name : 'Personel seçin...'}
                        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0">
                      <Command>
                        <CommandInput
                          placeholder="İsim ile ara..."
                          value={userSearchQuery}
                          onValueChange={setUserSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>Personel bulunamadı.</CommandEmpty>
                          <CommandGroup>
                            {filteredUsers.map((user) => (
                              <CommandItem
                                key={user.uid}
                                value={`${user.name} ${user.email}`}
                                onSelect={() => {
                                  setSelectedUserId(user.uid || '');
                                  setUserSearchOpen(false);
                                }}
                              >
                                <div className="flex flex-col">
                                  <span className="font-medium">{user.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {user.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Serial Number / Quantity row */}
              {selectedProduct && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Serial number input */}
                  <div className="space-y-2">
                    <Label>Seri Numarası (Opsiyonel)</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Seri numarası girin"
                        value={serialNumber}
                        onChange={(e) => handleTransferSerialChange(e.target.value)}
                        className="flex-1"
                      />
                      {selectedProduct.serialNumbers.length > 0 && (
                        <Popover open={serialSelectOpen} onOpenChange={setSerialSelectOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="shrink-0">
                              <List className="h-4 w-4 mr-1" />
                              Depodan Seç ({selectedProduct.serialNumbers.length})
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[350px] p-0">
                            <Command>
                              <CommandInput placeholder="Seri numarası ara..." />
                              <CommandList>
                                <CommandEmpty>Seri numarası bulunamadı.</CommandEmpty>
                                <CommandGroup heading={`${selectedProduct.stokKodu} Seri Numaraları`}>
                                  {selectedProduct.serialNumbers
                                    .filter(sn => !transferRows.some(r => r.serialNumber === sn.serialNumber))
                                    .map((sn) => (
                                      <CommandItem
                                        key={sn.id}
                                        value={sn.serialNumber}
                                        onSelect={() => {
                                          setSerialNumber(sn.serialNumber);
                                          setTransferQuantity(1);
                                          setSerialSelectOpen(false);
                                        }}
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-mono font-medium">{sn.serialNumber}</span>
                                          <span className="text-xs text-muted-foreground">
                                            Eklenme: {format(sn.createdAt, 'dd.MM.yyyy', { locale: tr })}
                                          </span>
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

                  {/* Quantity input */}
                  <div className="space-y-2">
                    <Label>Adet</Label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedProduct.totalQuantity}
                      value={serialNumber.trim() ? 1 : transferQuantity}
                      onChange={(e) => setTransferQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      disabled={!!serialNumber.trim()}
                    />
                    {serialNumber.trim() && (
                      <p className="text-xs text-muted-foreground">Seri numaralı transferde adet 1 olmalıdır.</p>
                    )}
                    {!serialNumber.trim() && (
                      <p className="text-xs text-muted-foreground">Depoda mevcut: {selectedProduct.totalQuantity}</p>
                    )}
                  </div>

                  {/* Add button */}
                  <div className="flex items-end">
                    <Button
                      onClick={addTransferRow}
                      disabled={!selectedStokKodu || !selectedUserId}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Satır Ekle
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Transfer list */}
            {transferRows.length > 0 && (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ürün Kodu</TableHead>
                      <TableHead>Ürün Adı</TableHead>
                      <TableHead>Cihaz Grubu</TableHead>
                      <TableHead>Seri No</TableHead>
                      <TableHead>Adet</TableHead>
                      <TableHead>Hedef Personel</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono">{row.stokKodu}</TableCell>
                        <TableCell>{row.stokAdi}</TableCell>
                        <TableCell>
                          {row.cihazGrubu ? (
                            <Badge variant="outline" className="text-xs">{row.cihazGrubu}</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="font-mono">{row.serialNumber || '-'}</TableCell>
                        <TableCell className="font-mono">{row.quantity}</TableCell>
                        <TableCell>{row.targetName}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTransferRow(row.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="p-4 border-t flex justify-between items-center">
                  <div className="text-sm text-muted-foreground">
                    <span>{transferRows.length} satır, toplam <strong>{transferRows.reduce((s, r) => s + r.quantity, 0)}</strong> adet transfer edilecek</span>
                  </div>
                  <Button
                    onClick={executeTransfer}
                    disabled={isTransferring}
                  >
                    {isTransferring ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Transfer Et
                  </Button>
                </div>
              </div>
            )}

            {transferRows.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>Henüz transfer edilecek ürün eklenmedi.</p>
                <p className="text-sm">Yukarıdaki formu kullanarak depodaki ürünlerden seçim yapın.</p>
              </div>
            )}
          </TabsContent>

          {/* Borrowed Parts Tab */}
          <TabsContent value="borrowed" className="mt-4">
            {borrowedParts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <HandCoins className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>Onay bekleyen borç alınmış parça bulunmuyor.</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ürün</TableHead>
                      <TableHead>Seri No</TableHead>
                      <TableHead>Cihaz / Lab</TableHead>
                      <TableHead>Kullanan</TableHead>
                      <TableHead>Tarih</TableHead>
                      <TableHead className="w-48"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {borrowedParts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{item.serialNumber || '-'}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{item.deviceName}</p>
                            <p className="text-xs text-muted-foreground">{item.labName}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{item.borrowedByName}</p>
                            <Badge variant="outline" className="text-xs">
                              {item.formType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(item.borrowedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => approveBorrowedPart(item)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Onayla
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => rejectBorrowedPart(item)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reddet
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Pending Returns Tab */}
          <TabsContent value="pending" className="mt-4">
            {pendingReturns.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>Bekleyen iade bulunmuyor.</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ürün</TableHead>
                      <TableHead>Seri No</TableHead>
                      <TableHead>Personel</TableHead>
                      <TableHead>Tür</TableHead>
                      <TableHead>Tarih</TableHead>
                      <TableHead className="w-40"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingReturns.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground">{item.stokKodu}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{item.serialNumber || '-'}</TableCell>
                        <TableCell>{item.ownerName}</TableCell>
                        <TableCell>
                          <Badge variant={item.returnType === 'return_to_depot' ? 'secondary' : 'outline'}>
                            {item.returnType === 'return_to_depot' ? 'İade (Yeni)' : 'Teslim (Çıkma)'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(item.requestedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.imageUrl && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPreviewImage(item.imageUrl!)}
                              >
                                <ImageIcon className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => confirmPendingReturn(item)}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Teslim Al
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-4">
            {transferLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>Henüz işlem geçmişi bulunmuyor.</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tarih</TableHead>
                        <TableHead>İşlem</TableHead>
                        <TableHead>Ürün</TableHead>
                        <TableHead>Seri No</TableHead>
                        <TableHead>Adet</TableHead>
                        <TableHead>Kişi</TableHead>
                        <TableHead>İşlemi Yapan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transferLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm">
                            {format(log.timestamp, 'dd.MM.yyyy HH:mm', { locale: tr })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{getActionLabel(log.action)}</Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium truncate max-w-[150px]">{log.stokAdi}</p>
                              <p className="text-xs text-muted-foreground">{log.stokKodu}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{log.serialNumber || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{log.quantity || 1}</TableCell>
                          <TableCell>
                            {log.toName || log.fromName || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {log.createdByName}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );

  // ========== RENDER: Depo Stok View (Grouped) ==========
  const renderDepoStok = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              Yedek Parça Depo Stok
            </CardTitle>
            <CardDescription>
              Yedek parça deposundaki mevcut stok durumu.
              Toplam: <strong>{groupedDepoStok.reduce((s, g) => s + g.totalQuantity, 0)}</strong> adet, <strong>{groupedDepoStok.length}</strong> farklı ürün.
            </CardDescription>
          </div>
          <Button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/stok-giris')}>
            <Plus className="h-4 w-4 mr-2" />
            Stok Girişi
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {depoStokLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Yükleniyor...</span>
          </div>
        ) : groupedDepoStok.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Warehouse className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>Depoda yedek parça stoku bulunmuyor.</p>
            <p className="text-sm">Stok girişi yaparak ürün ekleyin.</p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ürün Kodu</TableHead>
                  <TableHead>Ürün Adı</TableHead>
                  <TableHead>Cihaz Grubu</TableHead>
                  <TableHead>Adet</TableHead>
                  <TableHead>Eklenme Tarihi</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedDepoStok.map((group) => (
                  <React.Fragment key={group.stokKodu}>
                    <TableRow
                      className={cn(
                        'cursor-pointer hover:bg-muted/50 transition-colors',
                        expandedStokKodu === group.stokKodu && 'bg-muted/30'
                      )}
                      onClick={() => setExpandedStokKodu(
                        expandedStokKodu === group.stokKodu ? null : group.stokKodu
                      )}
                    >
                      <TableCell className="font-mono">{group.stokKodu}</TableCell>
                      <TableCell>{group.stokAdi}</TableCell>
                      <TableCell>
                        {group.cihazGrubu ? (
                          <Badge variant="outline" className="text-xs">{group.cihazGrubu}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{group.totalQuantity}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(group.earliestDate, 'dd.MM.yyyy', { locale: tr })}
                      </TableCell>
                      <TableCell>
                        {group.serialNumbers.length > 0 ? (
                          expandedStokKodu === group.stokKodu ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <div className="flex items-center gap-1">
                              <Hash className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">{group.serialNumbers.length}</span>
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Expanded serial numbers */}
                    {expandedStokKodu === group.stokKodu && group.serialNumbers.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <div className="bg-blue-50 dark:bg-blue-950/30 p-3 border-t">
                            <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">
                              Seri Numaraları ({group.serialNumbers.length} / {group.totalQuantity} adet):
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {group.serialNumbers.map((sn) => (
                                <Badge key={sn.id} variant="outline" className="font-mono text-xs">
                                  {sn.serialNumber}
                                  <span className="ml-1 text-muted-foreground">
                                    ({format(sn.createdAt, 'dd.MM.yy', { locale: tr })})
                                  </span>
                                </Badge>
                              ))}
                            </div>
                            {group.totalQuantity > group.serialNumbers.length && (
                              <p className="text-xs text-muted-foreground mt-2">
                                + {group.totalQuantity - group.serialNumbers.length} adet seri numarasız
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}

                    {expandedStokKodu === group.stokKodu && group.serialNumbers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <div className="bg-muted/20 p-3 border-t">
                            <p className="text-xs text-muted-foreground">
                              Bu üründe seri numaralı kayıt bulunmuyor. Toplam {group.totalQuantity} adet seri numarasız stok.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // ========== RENDER: Personnel Stock View ==========
  const renderPersonnelStock = () => {
    const activeCount = personnelStock.filter(s => s.status === 'in_stock').length;
    const usedCount = personnelStock.filter(s => s.status === 'used' || s.status === 'pending_return').length;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            {menuSelection.personnelName} - Yedek Parça Stoku
          </CardTitle>
          <CardDescription className="flex items-center gap-4">
            <span>
              {menuSelection.personnelRole === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'} personeli stok durumu
            </span>
            <Badge variant="default" className="bg-green-600">{activeCount} Aktif</Badge>
            <Badge variant="secondary">{usedCount} Kullanıldı</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {personnelStockLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Yükleniyor...</span>
            </div>
          ) : personnelStock.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Bu personelde yedek parça bulunmuyor.</p>
            </div>
          ) : (
            <>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ürün Kodu</TableHead>
                      <TableHead>Ürün Adı</TableHead>
                      <TableHead>Seri No</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead>Transfer Tarihi</TableHead>
                      <TableHead>Kullanım Tarihi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedPersonnelStock.map((item) => {
                      const isUsed = item.status === 'used' || item.status === 'pending_return';
                      return (
                        <TableRow key={item.id} className={isUsed ? 'opacity-60' : ''}>
                          <TableCell className={cn('font-mono', isUsed && 'line-through')}>
                            {item.stokKodu}
                          </TableCell>
                          <TableCell className={cn(isUsed && 'line-through')}>
                            {item.stokAdi}
                          </TableCell>
                          <TableCell className={cn('font-mono', isUsed && 'line-through')}>
                            {item.serialNumber || '-'}
                          </TableCell>
                          <TableCell>
                            {item.status === 'in_stock' && (
                              <Badge variant="default" className="bg-green-600">Aktif</Badge>
                            )}
                            {item.status === 'used' && (
                              <Badge variant="secondary">Kullanıldı</Badge>
                            )}
                            {item.status === 'pending_return' && (
                              <Badge variant="outline">İade Bekliyor</Badge>
                            )}
                          </TableCell>
                          <TableCell className={cn('text-sm text-muted-foreground', isUsed && 'line-through')}>
                            {format(item.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.usedAt
                              ? format(item.usedAt, 'dd.MM.yyyy HH:mm', { locale: tr })
                              : '-'
                            }
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPersonnelPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Toplam {personnelStock.length} kayıt, Sayfa {personnelStockPage + 1} / {totalPersonnelPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={personnelStockPage === 0}
                      onClick={() => setPersonnelStockPage(p => p - 1)}
                    >
                      Önceki
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={personnelStockPage >= totalPersonnelPages - 1}
                      onClick={() => setPersonnelStockPage(p => p + 1)}
                    >
                      Sonraki
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            Personeldeki Toplam Stok
          </CardTitle>
          <CardDescription>
            Tüm personellerde bulunan henüz kullanılmamış yedek parçalar.
            Toplam: <strong>{allPersonnelStock.length}</strong> adet aktif stok.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {allStockLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Yükleniyor...</span>
            </div>
          ) : allPersonnelStock.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <PackageOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Personellerde aktif yedek parça stoku bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {personnelList.map((personnel) => (
                <div key={personnel.ownerUid} className="border rounded-lg">
                  <div
                    className="p-3 bg-muted/30 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setMenuSelection({
                      section: 'personnel',
                      personnelUid: personnel.ownerUid,
                      personnelName: personnel.ownerName,
                      personnelRole: users.find(u => u.uid === personnel.ownerUid)?.role,
                    })}
                  >
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4" />
                      <span className="font-medium">{personnel.ownerName}</span>
                      <Badge variant="outline" className="text-xs">
                        {users.find(u => u.uid === personnel.ownerUid)?.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="bg-green-600">{personnel.items.length} adet</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <Table>
                    <TableBody>
                      {personnel.items.slice(0, 5).map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm">{item.stokKodu}</TableCell>
                          <TableCell className="text-sm">{item.stokAdi}</TableCell>
                          <TableCell className="font-mono text-sm">{item.serialNumber || '-'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(item.createdAt, 'dd.MM.yyyy', { locale: tr })}
                          </TableCell>
                        </TableRow>
                      ))}
                      {personnel.items.length > 5 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-2">
                            ... ve {personnel.items.length - 5} ürün daha
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
      default:
        return renderTransferPanel();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Yükleniyor...</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-destructive">Yetkisiz Erişim</h2>
        <p className="text-muted-foreground mt-2">
          Bu sayfaya erişim yetkiniz bulunmamaktadır.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Geri Dön
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/direkt-transfer" />

      <div className="flex items-center gap-2 mb-2">
        <Package className="h-6 w-6" />
        <h1 className="text-xl font-bold">Yedek Parça Yönetim Paneli</h1>
      </div>

      <div className="flex gap-4">
        {/* ===== LEFT PANEL (40%) - Management Menu ===== */}
        <div className="w-[40%] min-w-[280px] space-y-2">
          <Card>
            <CardContent className="p-3">
              <ScrollArea className="h-[calc(100vh-180px)]">
                {/* Depo Stok */}
                <div className="mb-1">
                  <button
                    onClick={() => setMenuSelection({ section: 'depo-stok' })}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      menuSelection.section === 'depo-stok'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <Warehouse className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Depo Stok</p>
                      <p className={cn(
                        'text-xs truncate',
                        menuSelection.section === 'depo-stok'
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground'
                      )}>
                        Yedek parça deposu
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 opacity-50" />
                  </button>
                </div>

                {/* Personeldeki Toplam Stok */}
                <div className="mb-1">
                  <button
                    onClick={() => setMenuSelection({ section: 'toplam-stok' })}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      menuSelection.section === 'toplam-stok'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <PackageOpen className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Personeldeki Toplam Stok</p>
                      <p className={cn(
                        'text-xs truncate',
                        menuSelection.section === 'toplam-stok'
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground'
                      )}>
                        Kullanılmamış toplam stok
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 opacity-50" />
                  </button>
                </div>

                {/* Transfer Paneli */}
                <div className="mb-3">
                  <button
                    onClick={() => setMenuSelection({ section: 'transfer' })}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      menuSelection.section === 'transfer'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <Send className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Transfer Paneli</p>
                      <p className={cn(
                        'text-xs truncate',
                        menuSelection.section === 'transfer'
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground'
                      )}>
                        Transfer, borç, iade, geçmiş
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {borrowedParts.length > 0 && (
                        <Badge variant="destructive" className="text-xs px-1.5 py-0">
                          {borrowedParts.length}
                        </Badge>
                      )}
                      {pendingReturns.length > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0">
                          {pendingReturns.length}
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 opacity-50" />
                  </button>
                </div>

                <Separator className="my-3" />

                {/* Teknik Servis Personel Listesi */}
                <div className="mb-2">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Teknik Servis
                    </span>
                    <Badge variant="outline" className="text-xs ml-auto">{teknikServisUsers.length}</Badge>
                  </div>
                  <div className="space-y-0.5">
                    {teknikServisUsers.map((user) => (
                      <button
                        key={user.uid}
                        onClick={() => setMenuSelection({
                          section: 'personnel',
                          personnelUid: user.uid || '',
                          personnelName: user.name || '',
                          personnelRole: 'teknik_servis',
                        })}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                          menuSelection.section === 'personnel' && menuSelection.personnelUid === user.uid
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        )}
                      >
                        <UserIcon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm truncate flex-1">{user.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
                      </button>
                    ))}
                    {teknikServisUsers.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">Personel bulunamadı</p>
                    )}
                  </div>
                </div>

                <Separator className="my-3" />

                {/* Aplikasyon Personel Listesi */}
                <div className="mb-2">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Aplikasyon
                    </span>
                    <Badge variant="outline" className="text-xs ml-auto">{aplikasyonUsers.length}</Badge>
                  </div>
                  <div className="space-y-0.5">
                    {aplikasyonUsers.map((user) => (
                      <button
                        key={user.uid}
                        onClick={() => setMenuSelection({
                          section: 'personnel',
                          personnelUid: user.uid || '',
                          personnelName: user.name || '',
                          personnelRole: 'aplikasyon',
                        })}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                          menuSelection.section === 'personnel' && menuSelection.personnelUid === user.uid
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        )}
                      >
                        <UserIcon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm truncate flex-1">{user.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
                      </button>
                    ))}
                    {aplikasyonUsers.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">Personel bulunamadı</p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ===== RIGHT PANEL (60%) - Content Area ===== */}
        <div className="w-[60%] min-w-0">
          {renderRightPanel()}
        </div>
      </div>

      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Parça Fotoğrafı
            </DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="relative">
              <img
                src={previewImage}
                alt="Parça fotoğrafı"
                className="w-full h-auto max-h-[70vh] object-contain rounded-md"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
