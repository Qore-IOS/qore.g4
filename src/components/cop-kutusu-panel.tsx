'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { Laboratory, Device, ProductCode, TrashBinRecord, DeviceGroup } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLightDashboardData } from './dashboard/useDashboardData';
import { useMinMaxRules, useDevices } from '@/hooks/useFirebaseQueries';

export default function CopKutusuPanel() {
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();

  const slug = params.slug as string[] | undefined;
  const labIdFromUrl = slug?.[0] || '';

  const [selectedLabId, setSelectedLabId] = useState(labIdFromUrl);

  // Use lightweight dashboard data
  const {
      hospitals: laboratories,
      productCodes: products,
      isLoading,
  } = useLightDashboardData();

  // Fetch devices separately
  const { data: devices = [] } = useDevices();

  // Fetch min/max rules for selected lab
  const { data: minMaxRules = [] } = useMinMaxRules(selectedLabId);

  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);

  // Trash bin states
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [trashItems, setTrashItems] = useState<Array<{
    id: string;
    productCode: string;
    productName: string;
    remainingTests: number;
  }>>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [remainingTests, setRemainingTests] = useState<number>(0);
  const [productSearch, setProductSearch] = useState('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);

  // Fetch device groups
  useEffect(() => {
    const fetchDeviceGroups = async () => {
      try {
        const dgsnap = await getDocs(collection(db, 'def_deviceGroups'));
        setDeviceGroups(dgsnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup)));
      } catch (e) {
        toast({title: 'Hata', description: 'Cihaz grupları yüklenemedi.', variant: 'destructive'});
      }
    };
    fetchDeviceGroups();
  }, [toast]);

  const selectedLab = useMemo(() => laboratories.find(l => l.id === selectedLabId) || null, [laboratories, selectedLabId]);

  const assignedLaboratories = useMemo(() => {
    const allLabs = laboratories.filter(l => !l.isConsumablesHospital);
    if (currentUserProfile?.role === 'admin') return allLabs;
    if (currentUserProfile?.assignedLaboratories && currentUserProfile.assignedLaboratories.length > 0) {
      return allLabs.filter(h => currentUserProfile?.assignedLaboratories?.includes(h.id));
    }
    return [];
  }, [currentUserProfile, laboratories]);

  // Filter devices for selected lab (same as urun-kullanim-panel)
  const labDevices = useMemo(() => {
    if (!selectedLabId || !devices) return [];
    return devices
      .filter(d => {
        const deviceLabId = d.hospitalId || (d as any).hastaneId;
        return deviceLabId?.toString() === selectedLabId.toString();
      })
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }, [devices, selectedLabId]);

  // Add item to trash list
  const handleAddItem = useCallback(() => {
    if (!selectedProduct || remainingTests <= 0) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün seçin ve kalan test sayısını girin.', variant: 'destructive' });
      return;
    }

    const product = products.find(p => p.stokKodu === selectedProduct);
    if (!product) return;

    const newItem = {
      id: Date.now().toString(),
      productCode: selectedProduct,
      productName: product.stokAdi || '',
      remainingTests: remainingTests,
    };

    setTrashItems(prev => [...prev, newItem]);
    setSelectedProduct('');
    setRemainingTests(0);
    setProductSearch('');
    toast({ title: 'Eklendi', description: 'Ürün listeye eklendi.' });
  }, [selectedProduct, remainingTests, products, toast]);

  // Remove item from list
  const handleRemoveItem = useCallback((id: string) => {
    setTrashItems(prev => prev.filter(item => item.id !== id));
  }, []);

  // Submit trash bin records
  const handleSubmit = useCallback(async () => {
    if (!selectedDevice || trashItems.length === 0 || !selectedLab) {
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
          deviceId: selectedDevice.id,
          deviceModel: selectedDevice.cihazAdi || selectedDevice.model || '',
          deviceSerialNumber: selectedDevice.seriNumarasi || '',
          stokKodu: item.productCode,
          stokAdi: item.productName,
          remainingTests: item.remainingTests,
          createdAt: Timestamp.now(),
          createdByUid: currentUser?.uid || '',
          createdByName: currentUserProfile?.name || currentUserProfile?.email || '',
          sourceType: 'manual',
        };

        batch.set(trashBinRef, withCompanyScope(trashBinRecord, currentCompanyId));
      });

      await batch.commit();

      // Reset form
      setTrashItems([]);
      setSelectedDevice(null);
      setSelectedProduct('');
      setRemainingTests(0);

      toast({
        title: 'Başarılı',
        description: `${trashItems.length} ürün çöp kutusuna eklendi.`
      });

    } catch (error) {
      console.error('Error saving trash bin records:', error);
      toast({ title: 'Hata', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    }
  }, [selectedDevice, trashItems, selectedLab, currentUser, currentUserProfile, toast]);

  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Yükleniyor...</div>;
  }

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-6 w-6" />
            Çöp Kutusu - Ürün Ekleme
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Çöpe atılacak ürünleri cihaz seçerek veya manuel olarak ekleyin.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Laboratory Info */}
          {selectedLab && (
            <div className="bg-primary/5 p-4 rounded-lg">
              <p className="text-sm text-muted-foreground">Seçili Laboratuvar</p>
              <p className="font-medium text-lg">{selectedLab.name}</p>
            </div>
          )}

          {!selectedLabId && (
            <div className="text-center p-8 text-muted-foreground">
              Lütfen ürün kullanım panelinden bir laboratuvar seçerek gelin.
            </div>
          )}

          {selectedLabId && (
            <>
              {/* Device Selection */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Cihaz Seçin {labDevices.length > 0 && `(${labDevices.length} cihaz)`}
                </Label>

                {labDevices.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground border-2 border-dashed rounded-lg">
                    Bu laboratuvara ait cihaz bulunamadı.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {labDevices.map((device) => {
                    const group = deviceGroups.find(g => g.id === device.cihazGrubuId);
                    const isSelected = selectedDevice?.id === device.id;

                    return (
                      <div
                        key={device.id}
                        onClick={() => setSelectedDevice(device)}
                        className={cn(
                          "relative border-2 rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg",
                          isSelected ? "border-primary bg-primary/5" : "border-gray-200"
                        )}
                      >
                        {group?.gorselUrl && (
                          <div className="relative w-full h-32 mb-2">
                            <Image
                              src={group.gorselUrl}
                              alt={device.cihazAdi || ''}
                              fill
                              className="object-contain"
                            />
                          </div>
                        )}
                        <div className="text-center">
                          <p className="font-medium text-sm">{device.cihazAdi || device.model}</p>
                          <p className="text-xs text-muted-foreground">SN: {device.seriNumarasi}</p>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>

              {selectedDevice && (
                <>
                  {/* Product Selection */}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium mb-2 block">Ürün Seçin</Label>
                      <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen} modal={false}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                          >
                            {selectedProduct
                              ? products.find((p) => p.stokKodu === selectedProduct)?.stokAdi
                              : "Ürün seçin..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0 z-[9999]" style={{ pointerEvents: 'auto' }}>
                          <div className="flex flex-col">
                            <div className="p-2 border-b">
                              <Input
                                placeholder="Ürün ara..."
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                className="h-9"
                              />
                            </div>
                            <div className="max-h-[300px] overflow-y-auto">
                              <div className="p-1">
                                {(() => {
                                  const filtered = products
                                    .filter(p => {
                                      const rule = minMaxRules.find(r => r.stokKodu === p.stokKodu);
                                      if (!rule || (rule.min == null && rule.max == null)) return false;

                                      if (productSearch) {
                                        const search = productSearch.toLowerCase();
                                        const nameMatch = (p.stokAdi || '').toLowerCase().includes(search);
                                        const codeMatch = (p.stokKodu || '').toLowerCase().includes(search);
                                        return nameMatch || codeMatch;
                                      }
                                      return true;
                                    })
                                    .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));

                                  if (filtered.length === 0) {
                                    return (
                                      <div className="p-4 text-center text-sm text-muted-foreground">
                                        Ürün bulunamadı.
                                      </div>
                                    );
                                  }

                                  return filtered.map((product) => (
                                    <div
                                      key={product.id}
                                      className={cn(
                                        "flex items-center gap-2 p-2 rounded-sm cursor-pointer hover:bg-accent",
                                        selectedProduct === product.stokKodu && "bg-accent"
                                      )}
                                      onClick={() => {
                                        setSelectedProduct(product.stokKodu || '');
                                        setIsProductPopoverOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          selectedProduct === product.stokKodu ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-sm">{product.stokAdi}</span>
                                        <span className="text-xs text-muted-foreground">{product.stokKodu}</span>
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

                    {selectedProduct && (
                      <div>
                        <Label htmlFor="remaining-tests" className="text-sm font-medium mb-2 block">
                          Kalan Test Adeti
                        </Label>
                        <Input
                          id="remaining-tests"
                          type="number"
                          min="0"
                          value={remainingTests || ''}
                          onChange={(e) => setRemainingTests(parseInt(e.target.value) || 0)}
                        />
                      </div>
                    )}

                    <Button onClick={handleAddItem} className="w-full">
                      Listeye Ekle
                    </Button>
                  </div>

                  {/* Items List */}
                  {trashItems.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Eklenecek Ürünler ({trashItems.length})</Label>
                      <div className="border rounded-md divide-y">
                        {trashItems.map((item) => (
                          <div key={item.id} className="flex items-center justify-between p-3">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{item.productName}</p>
                              <p className="text-xs text-muted-foreground">{item.productCode}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">{item.remainingTests} test</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveItem(item.id)}
                              >
                                Sil
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button onClick={handleSubmit} className="w-full" size="lg">
                        Çöp Kutusuna Gönder ({trashItems.length} ürün)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
