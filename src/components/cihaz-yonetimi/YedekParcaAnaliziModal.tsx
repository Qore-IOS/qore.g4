'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Package, Search, ArrowLeft, Monitor, Users, Warehouse, UserCheck, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';

interface YedekParcaAnaliziModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TransferLog {
  id: string;
  action: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber?: string;
  deviceId?: string;
  deviceName?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: Date;
  formType?: 'teknik_servis' | 'aplikasyon';
}

interface PersonalStockItem {
  id: string;
  ownerUid: string;
  ownerName: string;
  stokKodu: string;
  stokAdi: string;
  status: string;
}

interface DepoStokItem {
  id: string;
  stokKodu: string;
  stokAdi: string;
  quantity: number;
  serialNumber?: string;
}

interface PartSummary {
  stokKodu: string;
  stokAdi: string;
  usageCount: number;
}

interface PartDetail {
  totalUsageCount: number;
  devices: { deviceId: string; deviceName: string; count: number }[];
  personnel: { uid: string; name: string; count: number }[];
  depoStokCount: number;
  personnelStokCount: number;
  personnelStokByPerson: { uid: string; name: string; count: number }[];
}

export default function YedekParcaAnaliziModal({ isOpen, onClose }: YedekParcaAnaliziModalProps) {
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPart, setSelectedPart] = useState<PartSummary | null>(null);
  const [partDetail, setPartDetail] = useState<PartDetail | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, 'sparePartTransferLogs'), where('action', '==', 'use_on_device'))
        );

        setTransferLogs(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              action: data.action,
              stokKodu: data.stokKodu || '',
              stokAdi: data.stokAdi || '',
              serialNumber: data.serialNumber,
              deviceId: data.deviceId,
              deviceName: data.deviceName,
              createdByUid: data.createdByUid || '',
              createdByName: data.createdByName || 'Bilinmiyor',
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
              formType: data.formType,
            };
          })
        );
      } catch (error) {
        console.error('Yedek parça analizi veri hatası:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedPart(null);
      setPartDetail(null);
      setSearchTerm('');
    }
  }, [isOpen]);

  const partSummaries = useMemo(() => {
    const map = new Map<string, PartSummary>();
    for (const log of transferLogs) {
      if (!log.stokKodu) continue;
      const existing = map.get(log.stokKodu);
      if (existing) {
        existing.usageCount++;
      } else {
        map.set(log.stokKodu, { stokKodu: log.stokKodu, stokAdi: log.stokAdi, usageCount: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.usageCount - a.usageCount);
  }, [transferLogs]);

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return partSummaries;
    const lower = searchTerm.toLowerCase();
    return partSummaries.filter(
      (p) => p.stokKodu.toLowerCase().includes(lower) || p.stokAdi.toLowerCase().includes(lower)
    );
  }, [partSummaries, searchTerm]);

  const chartData = useMemo(() => {
    return partSummaries.slice(0, 15).map((p) => ({
      name: p.stokAdi.length > 20 ? p.stokAdi.substring(0, 20) + '...' : p.stokAdi,
      fullName: p.stokAdi,
      stokKodu: p.stokKodu,
      count: p.usageCount,
    }));
  }, [partSummaries]);

  const selectPart = useCallback(
    async (part: PartSummary) => {
      setSelectedPart(part);
      setDetailLoading(true);

      try {
        // Get usage details from the already loaded transfer logs
        const usageLogs = transferLogs.filter((l) => l.stokKodu === part.stokKodu);

        // Devices
        const deviceMap = new Map<string, { deviceId: string; deviceName: string; count: number }>();
        for (const log of usageLogs) {
          if (!log.deviceId) continue;
          const existing = deviceMap.get(log.deviceId);
          if (existing) existing.count++;
          else deviceMap.set(log.deviceId, { deviceId: log.deviceId, deviceName: log.deviceName || 'Bilinmiyor', count: 1 });
        }

        // Personnel
        const personnelMap = new Map<string, { uid: string; name: string; count: number }>();
        for (const log of usageLogs) {
          if (!log.createdByUid) continue;
          const existing = personnelMap.get(log.createdByUid);
          if (existing) existing.count++;
          else personnelMap.set(log.createdByUid, { uid: log.createdByUid, name: log.createdByName, count: 1 });
        }

        // Fetch depot stock and personnel stock
        const [depoSnap, personalSnap] = await Promise.all([
          getDocs(query(collection(db, 'yedekParcaDepoStok'), where('stokKodu', '==', part.stokKodu))),
          getDocs(
            query(collection(db, 'personalStock'), where('stokKodu', '==', part.stokKodu), where('status', '==', 'in_stock'))
          ),
        ]);

        let depoStokCount = 0;
        for (const doc of depoSnap.docs) {
          depoStokCount += doc.data().quantity || 1;
        }

        const personnelStokMap = new Map<string, { uid: string; name: string; count: number }>();
        let totalPersonnelStok = 0;
        for (const doc of personalSnap.docs) {
          const data = doc.data();
          totalPersonnelStok++;
          const existing = personnelStokMap.get(data.ownerUid);
          if (existing) existing.count++;
          else personnelStokMap.set(data.ownerUid, { uid: data.ownerUid, name: data.ownerName || 'Bilinmiyor', count: 1 });
        }

        setPartDetail({
          totalUsageCount: usageLogs.length,
          devices: Array.from(deviceMap.values()).sort((a, b) => b.count - a.count),
          personnel: Array.from(personnelMap.values()).sort((a, b) => b.count - a.count),
          depoStokCount,
          personnelStokCount: totalPersonnelStok,
          personnelStokByPerson: Array.from(personnelStokMap.values()).sort((a, b) => b.count - a.count),
        });
      } catch (error) {
        console.error('Parça detay hatası:', error);
      } finally {
        setDetailLoading(false);
      }
    },
    [transferLogs]
  );

  const renderPartList = () => (
    <>
      {/* Chart - Top 15 most changed parts */}
      {chartData.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">En Cok Degisen Yedek Parcalar (Top 15)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0]?.payload;
                      return (
                        <div className="glass-card p-3 text-sm">
                          <p className="font-semibold mb-1">{data?.fullName}</p>
                          <p className="text-muted-foreground text-xs">{data?.stokKodu}</p>
                          <p className="text-primary font-semibold mt-1">Kullanim: {data?.count}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" fill="#8884d8" name="Kullanim Sayisi" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Part List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Parca Listesi</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Stok kodu veya adi ile ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Stok Kodu</TableHead>
                <TableHead>Stok Adi</TableHead>
                <TableHead className="text-center">Kullanim Sayisi</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredParts.map((p, i) => (
                <TableRow
                  key={p.stokKodu}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => selectPart(p)}
                >
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{p.stokKodu}</TableCell>
                  <TableCell className="font-medium">{p.stokAdi}</TableCell>
                  <TableCell className="text-center font-semibold">{p.usageCount}</TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
              {filteredParts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {searchTerm ? 'Arama sonucu bulunamadi' : 'Yedek parca verisi bulunamadi'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );

  const renderPartDetail = () => {
    if (!selectedPart) return null;

    if (detailLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Parca detaylari yukleniyor...</span>
        </div>
      );
    }

    if (!partDetail) return null;

    return (
      <>
        {/* Back button and header */}
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedPart(null); setPartDetail(null); }}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Geri
          </Button>
          <div>
            <h3 className="font-semibold text-lg">{selectedPart.stokAdi}</h3>
            <p className="text-sm text-muted-foreground font-mono">{selectedPart.stokKodu}</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Toplam Kullanim</p>
                  <p className="text-xl font-bold">{partDetail.totalUsageCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Cihaz Sayisi</p>
                  <p className="text-xl font-bold">{partDetail.devices.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Depo Stok</p>
                  <p className="text-xl font-bold">{partDetail.depoStokCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-orange-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Personel Stok</p>
                  <p className="text-xl font-bold">{partDetail.personnelStokCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Devices Table */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Kullanildigi Cihazlar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cihaz</TableHead>
                  <TableHead className="text-center">Kullanim Sayisi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partDetail.devices.map((d) => (
                  <TableRow key={d.deviceId}>
                    <TableCell className="font-medium">{d.deviceName}</TableCell>
                    <TableCell className="text-center">{d.count}</TableCell>
                  </TableRow>
                ))}
                {partDetail.devices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                      Cihaz verisi yok
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Personnel Usage Table */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Personel Bazli Kullanim
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Personel</TableHead>
                  <TableHead className="text-center">Kullanim Sayisi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partDetail.personnel.map((p) => (
                  <TableRow key={p.uid}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-center">{p.count}</TableCell>
                  </TableRow>
                ))}
                {partDetail.personnel.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                      Personel verisi yok
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Personnel Stock Table */}
        {partDetail.personnelStokByPerson.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                Personel Stok Dagilimi
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Personel</TableHead>
                    <TableHead className="text-center">Elindeki Adet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partDetail.personnelStokByPerson.map((p) => (
                    <TableRow key={p.uid}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-center">{p.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Package className="h-5 w-5 text-primary" />
            Yedek Parca Analizi
          </DialogTitle>
          <DialogDescription>
            En cok degisen yedek parcalar ve detayli parca ekstresi
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Veriler yukleniyor...</span>
          </div>
        ) : (
          <ScrollArea className="flex-1 px-6 pb-6">
            {selectedPart ? renderPartDetail() : renderPartList()}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
