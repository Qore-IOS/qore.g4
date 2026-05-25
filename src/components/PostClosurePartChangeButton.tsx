'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, query, where, writeBatch, Timestamp, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Package, Loader2, Camera, ImageIcon, X } from 'lucide-react';
import type { PersonalStockItem, PoolWarehouseStockItem, DeviceLabPool, Depot } from '@/lib/types';
import { emitExternalStockUsage } from '@/lib/notifications';

type PostClosurePartChangeButtonProps = {
  formId: string;
  deviceId: string;
  deviceName?: string;
  hospitalId?: string;
  labName?: string;
  formType: 'teknik_servis' | 'aplikasyon';
  sourceType: 'gecmis_accordion' | 'islem_formu_detay';
  /** Firebase collection name where the form is stored */
  formCollection: 'deviceActionForms';
  createdByUid?: string;
};

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  personalStockId?: string;
  poolStockId?: string;
  poolWarehouseId?: string;
  poolWarehouseName?: string;
  serialNumber?: string;
  removedPartStokKodu?: string;
  removedPartStokAdi?: string;
  removedPartSerialNumber?: string;
  removedPartImageUrl?: string;
  usedPartImageUrl?: string;
  isPostClosure?: boolean;
  addedAt?: string;
  addedByName?: string;
};

export default function PostClosurePartChangeButton({
  formId,
  deviceId,
  deviceName,
  hospitalId,
  labName,
  formType,
  sourceType,
  formCollection,
  createdByUid,
}: PostClosurePartChangeButtonProps) {
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [poolStockItems, setPoolStockItems] = useState<PoolWarehouseStockItem[]>([]);
  const [stockSourceTab, setStockSourceTab] = useState<'personal' | 'pool'>('personal');
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
  const [selectedPoolStockItem, setSelectedPoolStockItem] = useState<PoolWarehouseStockItem | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [manualSerialNumber, setManualSerialNumber] = useState('');
  const [removedPartStokKodu, setRemovedPartStokKodu] = useState('');
  const [removedPartStokAdi, setRemovedPartStokAdi] = useState('');
  const [removedPartSerialNumber, setRemovedPartSerialNumber] = useState('');
  const [removedPartImageFile, setRemovedPartImageFile] = useState<File | null>(null);
  const [removedPartImagePreview, setRemovedPartImagePreview] = useState<string | null>(null);
  const [usedPartImageFile, setUsedPartImageFile] = useState<File | null>(null);
  const [usedPartImagePreview, setUsedPartImagePreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const removedPartImageInputRef = useRef<HTMLInputElement>(null);
  const usedPartImageInputRef = useRef<HTMLInputElement>(null);

  // Only show for the form creator
  const canAddParts = currentUser?.uid === createdByUid;

  // Fetch personal stock
  useEffect(() => {
    if (!currentUser || !isOpen) return;
    (async () => {
      try {
        const stockSnap = await getDocs(
          scopedQuery(
            'personalStock',
            currentCompanyId,
            isSuperAdmin,
            where('ownerUid', '==', currentUser.uid),
            where('status', '==', 'in_stock')
          )
        );
        setPersonalStock(stockSnap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalStockItem)));
      } catch (e) {
        console.error('Error fetching personal stock:', e);
      }
    })();
  }, [currentUser, isOpen]);

  // Fetch pool stock
  useEffect(() => {
    if (!deviceId || !isOpen) return;
    (async () => {
      try {
        const deviceSnap = await getDoc(doc(db, 'devices', deviceId));
        if (!deviceSnap.exists()) return;
        const deviceData = deviceSnap.data();
        const hId = hospitalId || deviceData.hospitalId;
        if (!hId) return;

        const poolsSnap = await getDocs(collection(db, 'deviceLabPools'));
        const matchingPoolIds: string[] = [];
        poolsSnap.docs.forEach(d => {
          const pool = d.data() as DeviceLabPool;
          if (pool.memberIds?.includes(hId)) {
            matchingPoolIds.push(d.id);
          }
        });
        if (matchingPoolIds.length === 0) return;

        const depotsSnap = await getDocs(collection(db, 'depots'));
        const poolWarehouseIds: string[] = [];
        depotsSnap.docs.forEach(d => {
          const depot = d.data() as Depot;
          if (depot.isPoolWarehouse && depot.linkedDeviceLabPoolIds?.some(id => matchingPoolIds.includes(id))) {
            poolWarehouseIds.push(d.id);
          }
        });
        if (poolWarehouseIds.length === 0) return;

        const allPoolStock: PoolWarehouseStockItem[] = [];
        for (const pwId of poolWarehouseIds) {
          const stockQ = scopedQuery(
            'poolWarehouseStock',
            currentCompanyId,
            isSuperAdmin,
            where('poolWarehouseId', '==', pwId),
            where('status', '==', 'in_stock')
          );
          const stockSnap = await getDocs(stockQ);
          stockSnap.docs.forEach(d => {
            const data = d.data();
            allPoolStock.push({
              id: d.id,
              ...data,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            } as PoolWarehouseStockItem);
          });
        }
        setPoolStockItems(allPoolStock);
      } catch (err) {
        console.error("Error fetching pool stock:", err);
      }
    })();
  }, [deviceId, hospitalId, isOpen]);

  const filteredStock = useMemo(() => {
    if (!partSearchQuery) return personalStock;
    const q = partSearchQuery.toLowerCase();
    return personalStock.filter(p =>
      p.stokKodu?.toLowerCase().includes(q) ||
      p.stokAdi?.toLowerCase().includes(q) ||
      p.serialNumber?.toLowerCase().includes(q)
    );
  }, [personalStock, partSearchQuery]);

  const filteredPoolStock = useMemo(() => {
    if (!partSearchQuery) return poolStockItems;
    const q = partSearchQuery.toLowerCase();
    return poolStockItems.filter(p =>
      p.stokKodu?.toLowerCase().includes(q) ||
      p.stokAdi?.toLowerCase().includes(q) ||
      p.serialNumber?.toLowerCase().includes(q)
    );
  }, [poolStockItems, partSearchQuery]);

  const resetState = () => {
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setStockSourceTab('personal');
    setPartSearchQuery('');
    setManualPartCode('');
    setManualPartName('');
    setManualSerialNumber('');
    setShowManualEntry(false);
    setRemovedPartStokKodu('');
    setRemovedPartStokAdi('');
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null);
    setRemovedPartImagePreview(null);
    setUsedPartImageFile(null);
    setUsedPartImagePreview(null);
  };

  const handleRemovedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRemovedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setRemovedPartImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUsedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUsedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setUsedPartImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const uploadPartImage = async (file: File, pathPrefix: 'removed-parts' | 'used-parts'): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', pathPrefix);
      formData.append('deviceId', deviceId || 'unknown-device');

      const response = await fetch('/api/storage/upload-image', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Resim yüklenemedi.');
      }
      return payload.url;
    } catch (e: any) {
      console.error('Image upload error:', e);
      toast({ title: 'Resim Yükleme Hatası', description: e.message || 'Resim yüklenemedi.', variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!currentUser) return;

    if (!selectedStockItem && !selectedPoolStockItem && !(showManualEntry && manualPartCode && manualPartName)) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen stokunuzdan, havuz stoktan bir parça seçin veya manuel girin.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      let removedImgUrl: string | undefined = undefined;
      let usedImgUrl: string | undefined = undefined;

      if (removedPartImageFile) {
        const url = await uploadPartImage(removedPartImageFile, 'removed-parts');
        if (url) removedImgUrl = url;
      }
      if (usedPartImageFile) {
        const url = await uploadPartImage(usedPartImageFile, 'used-parts');
        if (url) usedImgUrl = url;
      }

      const batch = writeBatch(db);
      const now = new Date();

      const resolvedStokKodu = selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || manualPartCode.trim();
      const resolvedStokAdi = selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName.trim();
      const resolvedSerialNumber = selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || manualSerialNumber.trim();

      const newAction: ActionItem = {
        id: `post_closure_${Date.now()}`,
        type: 'part_change',
        action: resolvedStokKodu,
        stokKodu: resolvedStokKodu,
        stokAdi: resolvedStokAdi,
        serialNumber: resolvedSerialNumber,
        quantity: 1,
        isManualEntry: !selectedStockItem && !selectedPoolStockItem,
        personalStockId: selectedStockItem?.id,
        poolStockId: selectedPoolStockItem?.id,
        poolWarehouseId: selectedPoolStockItem?.poolWarehouseId,
        poolWarehouseName: selectedPoolStockItem?.poolWarehouseName,
        removedPartStokKodu: removedPartStokKodu.trim() || resolvedStokKodu,
        removedPartStokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim() || undefined,
        removedPartImageUrl: removedImgUrl,
        usedPartImageUrl: usedImgUrl,
        isPostClosure: true,
        addedAt: now.toISOString(),
        addedByName: currentUserProfile?.name || 'Bilinmeyen',
      };

      // Update the form document to append the new action
      const formRef = doc(db, formCollection, formId);
      batch.update(formRef, {
        actions: arrayUnion(newAction),
      });

      // Also update the mirrored collection if applicable
      const mirrorCollectionName = formType === 'teknik_servis' ? 'teknikServisActionForms' : 'aplikasyonActionForms';
      try {
        const mirrorRef = doc(db, mirrorCollectionName, formId);
        const mirrorSnap = await getDoc(mirrorRef);
        if (mirrorSnap.exists()) {
          batch.update(mirrorRef, {
            actions: arrayUnion(newAction),
          });
        }
      } catch {
        // Mirror doc may not exist, that's ok
      }

      // If from personal stock, mark stock item as used
      if (selectedStockItem?.id) {
        const stockRef = doc(db, 'personalStock', selectedStockItem.id);
        batch.update(stockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedOnDeviceId: deviceId,
          usedOnFormId: formId,
          usedOnFormType: formType,
          usedPartImageUrl: usedImgUrl || null,
        });
      }

      // If from pool stock, mark pool stock item as used
      if (selectedPoolStockItem?.id) {
        const poolStockRef = doc(db, 'poolWarehouseStock', selectedPoolStockItem.id);
        batch.update(poolStockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedByUid: currentUser.uid,
          usedByName: currentUserProfile?.name || '',
          usedOnDeviceId: deviceId,
          usedOnDeviceName: deviceName || '',
          usedOnFormId: formId,
          usedOnFormType: formType,
          usedOnLabName: labName || null,
        });
      }

      // If removed part has serial number, create personal stock entry.
      // Protect against re-adding used part serial as a new active stock row.
      const removedSerial = removedPartSerialNumber.trim();
      const removedStokKoduValue = removedPartStokKodu.trim() || resolvedStokKodu;
      const isReusableStockStatus = (status: unknown) => {
        const normalized = String(status || '').trim().toLowerCase();
        return normalized === 'in_stock' || normalized === 'pending_approval';
      };

      if (removedSerial && removedSerial !== resolvedSerialNumber.trim()) {
        const duplicateSnap = await getDocs(query(
          collection(db, 'personalStock'),
          where('ownerUid', '==', currentUser.uid),
          where('serialNumber', '==', removedSerial)
        ));
        const hasActiveDuplicate = duplicateSnap.docs.some((docSnap) => {
          const data = docSnap.data();
          return data.stokKodu === removedStokKoduValue && isReusableStockStatus(data.status);
        });

        if (!hasActiveDuplicate) {
          const removedStockRef = doc(collection(db, 'personalStock'));
          batch.set(removedStockRef, {
            ownerUid: currentUser.uid,
            ownerName: currentUserProfile?.name || '',
            productCodeId: null,
            stokKodu: removedStokKoduValue,
            stokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
            serialNumber: removedSerial,
            imageUrl: removedImgUrl || null,
            source: 'device',
            sourceDeviceId: deviceId,
            sourceDeviceName: deviceName || '',
            status: 'in_stock',
            createdAt: Timestamp.fromDate(now),
            replacedPartId: selectedStockItem?.id || selectedPoolStockItem?.id || null,
          });
        }
      }

      // Log to dedicated audit collection
      const logRef = doc(collection(db, 'postClosurePartChangeLogs'));
      batch.set(logRef, withCompanyScope({
        formId,
        formCollection,
        formType,
        deviceId,
        deviceName: deviceName || '',
        labName: labName || '',
        stokKodu: resolvedStokKodu,
        stokAdi: resolvedStokAdi,
        serialNumber: resolvedSerialNumber,
        removedPartStokKodu: removedPartStokKodu.trim() || resolvedStokKodu,
        removedPartStokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim() || null,
        personalStockId: selectedStockItem?.id || null,
        poolStockId: selectedPoolStockItem?.id || null,
        poolWarehouseId: selectedPoolStockItem?.poolWarehouseId || null,
        poolWarehouseName: selectedPoolStockItem?.poolWarehouseName || null,
        isManualEntry: !selectedStockItem && !selectedPoolStockItem,
        addedByUid: currentUser.uid,
        addedByName: currentUserProfile?.name || 'Bilinmeyen',
        addedAt: Timestamp.fromDate(now),
        sourceType,
      }, currentCompanyId));

      await batch.commit();

      if (selectedPoolStockItem) {
        emitExternalStockUsage({
          actor: {
            uid: currentUser.uid,
            name: currentUserProfile?.name || currentUserProfile?.email || 'Bilinmeyen Kullanıcı',
          },
          sourceType: 'pool',
          sourceName: selectedPoolStockItem.poolWarehouseName || 'Havuz Depo',
          stokKodu: resolvedStokKodu,
          stokAdi: resolvedStokAdi,
          serialNumber: resolvedSerialNumber,
          quantity: 1,
          deviceName: deviceName || '',
          hospitalName: labName || '',
        }).catch(err => console.error('Notification error:', err));
      }

      toast({ title: 'Başarılı', description: 'Değişen parça sonradan eklendi ve loglandı.' });
      resetState();
      setIsOpen(false);
    } catch (e: any) {
      console.error('Post-closure part change error:', e);
      toast({ title: 'Hata', description: e.message || 'Parça değişimi eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!canAddParts) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => { e.stopPropagation(); setIsOpen(true); }}
        className="text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        Değişen Parça Ekle
      </Button>

      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) resetState();
        setIsOpen(open);
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Sonradan Değişen Parça Ekle</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Section 1: Select part from personal stock or pool stock */}
            <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
              <Label className="font-semibold">1. Parça Seçin</Label>

              {/* Stock source tabs */}
              {poolStockItems.length > 0 && !showManualEntry && (
                <div className="flex gap-1 p-1 rounded-lg bg-muted border">
                  <button
                    onClick={() => { setStockSourceTab('personal'); setSelectedPoolStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      stockSourceTab === 'personal'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Şahsi Stok ({personalStock.length})
                  </button>
                  <button
                    onClick={() => { setStockSourceTab('pool'); setSelectedStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      stockSourceTab === 'pool'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Havuz Stok ({poolStockItems.length})
                  </button>
                </div>
              )}

              {!showManualEntry && stockSourceTab === 'personal' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Parça kodu, adı veya seri no ile arayın..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-40 border rounded-md bg-background">
                    {filteredStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        {personalStock.length === 0
                          ? 'Şahsi stokunuzda yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => { setSelectedStockItem(item); setSelectedPoolStockItem(null); }}
                            className={`w-full text-left p-2 rounded-md transition-colors ${
                              selectedStockItem?.id === item.id
                                ? 'bg-primary/10 border-primary border'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{item.stokAdi}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono">{item.serialNumber}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.source === 'depot' ? 'Depodan' : 'Cihazdan'}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManualEntry(true)}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
                </>
              ) : !showManualEntry && stockSourceTab === 'pool' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Havuz stokta ara..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-40 border rounded-md bg-background">
                    {filteredPoolStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        {poolStockItems.length === 0
                          ? 'Havuz depoda yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredPoolStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => { setSelectedPoolStockItem(item); setSelectedStockItem(null); }}
                            className={`w-full text-left p-2 rounded-md transition-colors ${
                              selectedPoolStockItem?.id === item.id
                                ? 'bg-purple-500/10 border-purple-500 border'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{item.stokAdi}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono">{item.serialNumber || '—'}</p>
                                <p className="text-xs text-purple-600 font-medium">{item.poolWarehouseName}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManualEntry(true)}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
                </>
              ) : showManualEntry ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Parça Kodu <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="Kod..."
                        value={manualPartCode}
                        onChange={(e) => setManualPartCode(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Seri No</Label>
                      <Input
                        placeholder="Seri No..."
                        value={manualSerialNumber}
                        onChange={(e) => setManualSerialNumber(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Parça Adı <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="Parça adını girin..."
                      value={manualPartName}
                      onChange={(e) => setManualPartName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManualEntry(false)}
                    className="text-xs"
                  >
                    Stoktan seç
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Section 2: Removed part info */}
            <div className="p-3 border rounded-lg space-y-3 bg-muted/30">
              <Label className="font-semibold flex items-center gap-2">
                2. Cihazdan Çıkan Parça Bilgisi
                <span className="text-xs font-normal text-muted-foreground">(opsiyonel)</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Parça Kodu</Label>
                  <Input
                    placeholder={selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || manualPartCode || 'Kod...'}
                    value={removedPartStokKodu}
                    onChange={(e) => setRemovedPartStokKodu(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Seri No</Label>
                  <Input
                    placeholder="Çıkan parça seri no..."
                    value={removedPartSerialNumber}
                    onChange={(e) => setRemovedPartSerialNumber(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Parça Adı</Label>
                <Input
                  placeholder={selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName || 'Parça adı...'}
                  value={removedPartStokAdi}
                  onChange={(e) => setRemovedPartStokAdi(e.target.value)}
                  className="h-9"
                />
              </div>
              {/* Part images */}
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    Çıkan Parça Fotoğrafı (Opsiyonel)
                  </Label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={removedPartImageInputRef}
                    onChange={handleRemovedPartImageSelect}
                    className="hidden"
                  />
                  {removedPartImagePreview ? (
                    <div className="relative">
                      <img
                        src={removedPartImagePreview}
                        alt="Çıkan parça"
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => {
                          setRemovedPartImageFile(null);
                          setRemovedPartImagePreview(null);
                          if (removedPartImageInputRef.current) removedPartImageInputRef.current.value = '';
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-16 border-dashed flex flex-col gap-1"
                      onClick={() => removedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Çıkan parça fotoğrafı</span>
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    Takılan Parça Fotoğrafı (Opsiyonel)
                  </Label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={usedPartImageInputRef}
                    onChange={handleUsedPartImageSelect}
                    className="hidden"
                  />
                  {usedPartImagePreview ? (
                    <div className="relative">
                      <img
                        src={usedPartImagePreview}
                        alt="Takılan parça"
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => {
                          setUsedPartImageFile(null);
                          setUsedPartImagePreview(null);
                          if (usedPartImageInputRef.current) usedPartImageInputRef.current.value = '';
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-16 border-dashed flex flex-col gap-1"
                      onClick={() => usedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Takılan parça fotoğrafı</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Selected item summary */}
            {(selectedStockItem || selectedPoolStockItem || (showManualEntry && manualPartCode && manualPartName)) && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Takılacak: {selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || manualSerialNumber || 'Seri No Yok'})
                </p>
                {selectedPoolStockItem && (
                  <p className="text-purple-700 dark:text-purple-300 text-xs">
                    Kaynak: Havuz Stok - {selectedPoolStockItem.poolWarehouseName}
                  </p>
                )}
                {removedPartSerialNumber && (
                  <p className="text-green-700 dark:text-green-300">
                    Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber})
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>İptal</Button>
            <Button
              onClick={handleSave}
              disabled={
                (!selectedStockItem && !selectedPoolStockItem && !(showManualEntry && manualPartCode && manualPartName))
                || isSaving
                || isUploadingImage
              }
            >
              {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Kaydediliyor...</> : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
