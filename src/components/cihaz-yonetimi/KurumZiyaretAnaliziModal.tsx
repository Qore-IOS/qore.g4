'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Building2, Users, Wrench, FlaskConical } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';

interface KurumZiyaretAnaliziModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ActionForm {
  id: string;
  createdByUid?: string;
  createdByName: string;
  hospitalId?: string;
  labName?: string;
  formType: 'teknik_servis' | 'aplikasyon';
  createdAt: Date;
}

interface FaultReport {
  id: string;
  interventionType?: 'telefon' | 'kurum_ziyaret' | null;
  faultType: 'teknik_servis' | 'aplikasyon';
  assignedToUid?: string;
  assignedToName?: string;
  closedBy?: string;
  closedByName?: string;
  status: string;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
const BAR_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#d0ed57', '#ff8042', '#a4de6c', '#8dd1e1', '#d88884', '#ca82ca'];

export default function KurumZiyaretAnaliziModal({ isOpen, onClose }: KurumZiyaretAnaliziModalProps) {
  const [loading, setLoading] = useState(true);
  const [teknikForms, setTeknikForms] = useState<ActionForm[]>([]);
  const [aplikasyonForms, setAplikasyonForms] = useState<ActionForm[]>([]);
  const [faultReports, setFaultReports] = useState<FaultReport[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [teknikSnap, appSnap, faultSnap] = await Promise.all([
          getDocs(query(collection(db, 'teknikServisActionForms'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'aplikasyonActionForms'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'deviceFaultReports'), orderBy('openedAt', 'desc'))),
        ]);

        setTeknikForms(
          teknikSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              createdByUid: data.createdByUid,
              createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId,
              labName: data.labName,
              formType: 'teknik_servis' as const,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            };
          })
        );

        setAplikasyonForms(
          appSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              createdByUid: data.createdByUid,
              createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId,
              labName: data.labName,
              formType: 'aplikasyon' as const,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            };
          })
        );

        setFaultReports(
          faultSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              interventionType: data.interventionType,
              faultType: data.faultType,
              assignedToUid: data.assignedToUid,
              assignedToName: data.assignedToName,
              closedBy: data.closedBy,
              closedByName: data.closedByName,
              status: data.status,
            };
          })
        );
      } catch (error) {
        console.error('Kurum ziyaret analizi veri hatası:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  const analysis = useMemo(() => {
    // Action forms count as institution visits
    const teknikFormCount = teknikForms.length;
    const appFormCount = aplikasyonForms.length;

    // Fault reports resolved at institution
    const teknikFaultVisits = faultReports.filter(
      (f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'teknik_servis'
    );
    const appFaultVisits = faultReports.filter(
      (f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'aplikasyon'
    );

    const totalTeknik = teknikFormCount + teknikFaultVisits.length;
    const totalApp = appFormCount + appFaultVisits.length;

    // Personnel-based analysis
    const personnelMap = new Map<string, { name: string; teknikCount: number; appCount: number; total: number }>();

    const addToPersonnel = (uid: string | undefined, name: string, type: 'teknik_servis' | 'aplikasyon') => {
      if (!uid) return;
      const existing = personnelMap.get(uid) || { name, teknikCount: 0, appCount: 0, total: 0 };
      existing.name = name || existing.name;
      if (type === 'teknik_servis') existing.teknikCount++;
      else existing.appCount++;
      existing.total++;
      personnelMap.set(uid, existing);
    };

    teknikForms.forEach((f) => addToPersonnel(f.createdByUid, f.createdByName, 'teknik_servis'));
    aplikasyonForms.forEach((f) => addToPersonnel(f.createdByUid, f.createdByName, 'aplikasyon'));

    // Fault-based visits: use assignedToUid as the visiting person
    teknikFaultVisits.forEach((f) => addToPersonnel(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'teknik_servis'));
    appFaultVisits.forEach((f) => addToPersonnel(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'aplikasyon'));

    const personnelList = Array.from(personnelMap.entries())
      .map(([uid, data]) => ({ uid, ...data }))
      .sort((a, b) => b.total - a.total);

    const chartData = personnelList.slice(0, 15).map((p) => ({
      name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
      fullName: p.name,
      teknik: p.teknikCount,
      aplikasyon: p.appCount,
      toplam: p.total,
    }));

    return { totalTeknik, totalApp, teknikFormCount, appFormCount, teknikFaultVisitCount: teknikFaultVisits.length, appFaultVisitCount: appFaultVisits.length, personnelList, chartData };
  }, [teknikForms, aplikasyonForms, faultReports]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-5 w-5 text-primary" />
            Kurum Ziyaret Analizi
          </DialogTitle>
          <DialogDescription>
            Teknik servis ve aplikasyon personellerinin toplam kurum ziyaret sayıları
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Veriler yükleniyor...</span>
          </div>
        ) : (
          <ScrollArea className="flex-1 px-6 pb-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Wrench className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Teknik Servis Ziyaretleri</p>
                      <p className="text-2xl font-bold">{analysis.totalTeknik}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {analysis.teknikFormCount} form + {analysis.teknikFaultVisitCount} arıza
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <FlaskConical className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Aplikasyon Ziyaretleri</p>
                      <p className="text-2xl font-bold">{analysis.totalApp}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {analysis.appFormCount} form + {analysis.appFaultVisitCount} arıza
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Building2 className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Toplam Kurum Ziyareti</p>
                      <p className="text-2xl font-bold">{analysis.totalTeknik + analysis.totalApp}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-500/10">
                      <Users className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Aktif Personel</p>
                      <p className="text-2xl font-bold">{analysis.personnelList.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Chart */}
            {analysis.chartData.length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Personel Bazlı Kurum Ziyaret Sayıları</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const data = payload[0]?.payload;
                            return (
                              <div className="glass-card p-3 text-sm">
                                <p className="font-semibold mb-1">{data?.fullName}</p>
                                <p className="text-blue-400">Teknik: {data?.teknik}</p>
                                <p className="text-green-400">Aplikasyon: {data?.aplikasyon}</p>
                                <p className="font-semibold mt-1">Toplam: {data?.toplam}</p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="teknik" stackId="a" fill="#60a5fa" name="Teknik Servis" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="aplikasyon" stackId="a" fill="#34d399" name="Aplikasyon" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Personnel Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Personel Detay Tablosu</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Personel</TableHead>
                      <TableHead className="text-center">Teknik Servis</TableHead>
                      <TableHead className="text-center">Aplikasyon</TableHead>
                      <TableHead className="text-center">Toplam</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.personnelList.map((p, i) => (
                      <TableRow key={p.uid}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-center">{p.teknikCount}</TableCell>
                        <TableCell className="text-center">{p.appCount}</TableCell>
                        <TableCell className="text-center font-semibold">{p.total}</TableCell>
                      </TableRow>
                    ))}
                    {analysis.personnelList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          Kurum ziyaret verisi bulunamadı
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
