'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import type { ProductCode, User, PendingReturn, SparePartTransferRow, PersonalStockItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export default function YedekParcaTransferPage() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [spareParts, setSpareParts] = useState<ProductCode[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [borrowedParts, setBorrowedParts] = useState<any[]>([]);
  const [transferLogs, setTransferLogs] = useState<any[]>([]);

  // Image preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Transfer form state
  const [transferRows, setTransferRows] = useState<SparePartTransferRow[]>([]);
  const [isTransferring, setIsTransferring] = useState(false);

  // New row state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

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
        // Fetch spare parts (productCodes where urunGrubu is 'yedek_parca')
        const productsQuery = query(
          collection(db, 'productCodes'),
          where('urunGrubu', '==', 'yedek_parca')
        );
        const productsSnap = await getDocs(productsQuery);
        const sparePartProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        setSpareParts(sparePartProducts);

        // Fetch technicians and application specialists
        const usersSnap = await getDocs(collection(db, 'users'));
        const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
        setUsers(allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon'));

        // Fetch pending returns (status === 'pending') - no orderBy to avoid index requirement
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
        // Sort by requestedAt in memory (newest first)
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
        // Sort by borrowedAt in memory (newest first)
        borrowed.sort((a, b) => new Date(b.borrowedAt).getTime() - new Date(a.borrowedAt).getTime());
        setBorrowedParts(borrowed);

        // Fetch recent transfer logs - no orderBy to avoid index requirement
        const logsSnap = await getDocs(collection(db, 'sparePartTransferLogs'));
        const logs = logsSnap.docs.map(d => {
          const data = d.data();
          const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
          return {
            id: d.id,
            ...data,
            timestamp,
          };
        });
        // Sort by timestamp in memory (newest first) and take first 50
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

  // Filtered products for search
  const filteredProducts = useMemo(() => {
    if (!productSearchQuery) return spareParts.slice(0, 50);
    const q = productSearchQuery.toLowerCase();
    return spareParts
      .filter(p =>
        (p.stokKodu?.toLowerCase().includes(q) || p.stokAdi?.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [spareParts, productSearchQuery]);

  // Filtered users for search
  const filteredUsers = useMemo(() => {
    if (!userSearchQuery) return users;
    const q = userSearchQuery.toLowerCase();
    return users.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  }, [users, userSearchQuery]);

  // Get selected product details
  const selectedProduct = useMemo(() => {
    return spareParts.find(p => p.id === selectedProductId);
  }, [spareParts, selectedProductId]);

  // Get selected user details
  const selectedUser = useMemo(() => {
    return users.find(u => u.uid === selectedUserId);
  }, [users, selectedUserId]);

  // Add row to transfer list
  const addTransferRow = useCallback(() => {
    if (!selectedProduct || !serialNumber.trim() || !selectedUser) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm alanları doldurun.', variant: 'destructive' });
      return;
    }

    // Check for duplicate serial number in current rows
    if (transferRows.some(r => r.serialNumber === serialNumber.trim())) {
      toast({ title: 'Uyarı', description: 'Bu seri numarası zaten listede var.', variant: 'default' });
      return;
    }

    const newRow: SparePartTransferRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productCodeId: selectedProduct.id,
      stokKodu: selectedProduct.stokKodu || '',
      stokAdi: selectedProduct.stokAdi || '',
      serialNumber: serialNumber.trim(),
      targetUid: selectedUser.uid || '',
      targetName: selectedUser.name || '',
    };

    setTransferRows(prev => [...prev, newRow]);

    // Reset form for next entry
    setSerialNumber('');
    // Keep product and user selected for quick multiple entries

    toast({ title: 'Eklendi', description: `${selectedProduct.stokAdi} (${serialNumber.trim()}) listeye eklendi.` });
  }, [selectedProduct, serialNumber, selectedUser, transferRows, toast]);

  // Remove row from transfer list
  const removeTransferRow = (rowId: string) => {
    setTransferRows(prev => prev.filter(r => r.id !== rowId));
  };

  // Execute transfer
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
        // Create PersonalStockItem
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

        // Create transfer log
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
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      await batch.commit();

      toast({
        title: 'Transfer Tamamlandı',
        description: `${transferRows.length} yedek parça başarıyla transfer edildi.`,
      });

      setTransferRows([]);

      // Refresh logs
      const logsSnap = await getDocs(collection(db, 'sparePartTransferLogs'));
      const logs = logsSnap.docs.map(d => {
        const data = d.data();
        const timestamp = data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date();
        return {
          id: d.id,
          ...data,
          timestamp,
        };
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
        status: 'used', // No longer in personnel's stock
      });

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
        description: `${pendingReturn.stokAdi} (${pendingReturn.serialNumber}) depoya teslim alındı.`,
      });

      // Refresh pending returns
      setPendingReturns(prev => prev.filter(p => p.id !== pendingReturn.id));
    } catch (err) {
      console.error('Error confirming return:', err);
      toast({ title: 'Hata', description: 'İşlem sırasında hata oluştu.', variant: 'destructive' });
    }
  };

  // Approve borrowed part
  const approveBorrowedPart = async (borrowed: any) => {
    try {
      const now = new Date();

      // Update borrowed record as approved
      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'approved',
        approvedAt: Timestamp.fromDate(now),
        approvedByUid: currentUserProfile?.uid || '',
        approvedByName: currentUserProfile?.name || '',
      });

      // Create log entry
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
        description: `${borrowed.stokAdi} (${borrowed.serialNumber}) borç kaydı onaylandı.`,
      });

      // Refresh borrowed parts
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

      // Update borrowed record as rejected
      await updateDoc(doc(db, 'borrowedSpareParts', borrowed.id), {
        status: 'rejected',
        rejectedAt: Timestamp.fromDate(now),
        rejectedByUid: currentUserProfile?.uid || '',
        rejectedByName: currentUserProfile?.name || '',
      });

      // Create log entry
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
        description: `${borrowed.stokAdi} (${borrowed.serialNumber}) borç kaydı reddedildi.`,
      });

      // Refresh borrowed parts
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Yedek Parça Transfer Paneli
          </CardTitle>
          <CardDescription>
            Yedek parçaları personel şahsi stoklarına transfer edin ve iade işlemlerini yönetin.
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

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Product selector */}
                  <div className="space-y-2">
                    <Label>Yedek Parça</Label>
                    <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between"
                        >
                          {selectedProduct
                            ? `${selectedProduct.stokKodu} - ${selectedProduct.stokAdi?.substring(0, 20)}...`
                            : 'Ürün seçin...'}
                          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0">
                        <Command>
                          <CommandInput
                            placeholder="Kod veya isim ile ara..."
                            value={productSearchQuery}
                            onValueChange={setProductSearchQuery}
                          />
                          <CommandList>
                            <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                            <CommandGroup>
                              {filteredProducts.map((product) => (
                                <CommandItem
                                  key={product.id}
                                  value={`${product.stokKodu} ${product.stokAdi}`}
                                  onSelect={() => {
                                    setSelectedProductId(product.id);
                                    setProductSearchOpen(false);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">{product.stokKodu}</span>
                                    <span className="text-sm text-muted-foreground truncate">
                                      {product.stokAdi}
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

                  {/* Serial number input */}
                  <div className="space-y-2">
                    <Label>Seri Numarası</Label>
                    <Input
                      placeholder="Seri numarasını girin"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      disabled={!selectedProductId}
                    />
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
                          disabled={!serialNumber.trim()}
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

                  {/* Add button */}
                  <div className="flex items-end">
                    <Button
                      onClick={addTransferRow}
                      disabled={!selectedProductId || !serialNumber.trim() || !selectedUserId}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Satır Ekle
                    </Button>
                  </div>
                </div>
              </div>

              {/* Transfer list */}
              {transferRows.length > 0 && (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ürün Kodu</TableHead>
                        <TableHead>Ürün Adı</TableHead>
                        <TableHead>Seri No</TableHead>
                        <TableHead>Hedef Personel</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transferRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono">{row.stokKodu}</TableCell>
                          <TableCell>{row.stokAdi}</TableCell>
                          <TableCell className="font-mono">{row.serialNumber}</TableCell>
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
                    <span className="text-sm text-muted-foreground">
                      {transferRows.length} ürün transfer edilecek
                    </span>
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
                  <p className="text-sm">Yukarıdaki formu kullanarak ürün ekleyin.</p>
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
                          <TableCell className="font-mono">{item.serialNumber}</TableCell>
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
                          <TableCell className="font-mono">{item.serialNumber}</TableCell>
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
                            <TableCell className="font-mono text-sm">{log.serialNumber}</TableCell>
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
