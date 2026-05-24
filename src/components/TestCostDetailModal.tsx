'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  calculateTestCost,
  calculateSystemTotal,
  type TestCostBreakdown,
  type SystemCostSummary,
} from '../lib/test-cost-calculator';
import type {
  ProductCode,
  Hospital,
  Device,
  AssignedDevice,
  Asset,
  Personnel,
  TestDefinitionGlobal,
  DepoStokItem,
  Currency,
} from '../lib/types';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useAuth } from '@/contexts/auth-context';
import { getExchangeRates } from '@/lib/exchange-rates';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testDef: TestDefinitionGlobal | null;
  /** Tüm test tanımları — full-burden hesabında diğer testlerin stoğu için gerekli */
  allTestDefs: TestDefinitionGlobal[];
}

function fmtTL(n: number): string {
  if (!isFinite(n)) return '-';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TestCostDetailModal({ open, onOpenChange, testDef, allTestDefs }: Props) {
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<TestCostBreakdown | null>(null);
  const [systemTotal, setSystemTotal] = useState<SystemCostSummary | null>(null);

  useEffect(() => {
    if (!open || !testDef) {
      setBreakdown(null);
      setSystemTotal(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [productsSnap, labsSnap, devicesSnap, assignedSnap, assetsSnap, personnelSnap, stokSnap, rates] =
          await Promise.all([
            getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin, orderBy('stokAdi', 'asc'))),
            getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'))),
            getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
            getDocs(scopedQuery('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin)),
            getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin)),
            getDocs(scopedQuery('personnel', currentCompanyId, isSuperAdmin)),
            getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin)),
            getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
          ]);

        if (cancelled) return;

        const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode));
        const labs = filterByCompanyScope(
          labsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin,
        );
        const devices = devicesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Device));
        const assignedDevices = assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AssignedDevice));
        const assets = filterByCompanyScope(
          assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)),
          currentCompanyId,
          isSuperAdmin,
        );
        const personnel = filterByCompanyScope(
          personnelSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Personnel)),
          currentCompanyId,
          isSuperAdmin,
        );
        const depoStok = depoStokSnapFilter(stokSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem)));

        const productMap = new Map<string, ProductCode>();
        products.forEach((p) => productMap.set(p.stokKodu, p));
        const deviceDefs = new Map<string, Device>();
        devices.forEach((d) => deviceDefs.set(d.id, d));

        const inputs = {
          testDef,
          allTestDefs,
          productMap,
          labs,
          assignedDevices,
          deviceDefs,
          assets,
          personnel,
          depoStok,
          rates: rates as Record<Currency, number>,
        };

        const br = calculateTestCost(inputs);
        const sys = calculateSystemTotal(inputs);

        if (!cancelled) {
          setBreakdown(br);
          setSystemTotal(sys);
          setLoading(false);
        }
      } catch (e: any) {
        console.error('cost detail load error', e);
        if (!cancelled) {
          setError(e?.message || 'Hesaplama yapılırken hata oluştu');
          setLoading(false);
        }
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [open, testDef, allTestDefs, currentCompanyId, isSuperAdmin]);

  const marjBadge = useMemo(() => {
    if (!breakdown) return null;
    const m = breakdown.marjTL;
    if (Math.abs(m) < 0.01) {
      return (
        <Badge variant="outline" className="gap-1">
          <Minus className="h-3 w-3" />
          Başabaş
        </Badge>
      );
    }
    if (m > 0) {
      return (
        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1">
          <TrendingUp className="h-3 w-3" />
          {fmtTL(m)}
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1">
        <TrendingDown className="h-3 w-3" />
        {fmtTL(m)}
      </Badge>
    );
  }, [breakdown]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {testDef ? `${testDef.sutKodu} — ${testDef.sutTestAdi}` : 'Test Maliyet Detayı'}
          </DialogTitle>
          <DialogDescription>
            Bireysel test bakışı (full burden): bu testin maliyeti = stok maliyeti + (envanter + cihaz + personel +
            diğer testlerin stoğu). Lab/sistem geneli ortak giderler tek sefer alınır.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Hesaplanıyor...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive p-4">
            <AlertCircle className="h-5 w-5" /> {error}
          </div>
        ) : !breakdown || !systemTotal ? null : (
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-4 pr-2">
              {/* Top KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <KpiCard label="Toplam Test Adedi" value={`${breakdown.totalTestUnits.toLocaleString('tr-TR')} test`} />
                <KpiCard label="Birim Test Maliyeti" value={fmtTL(breakdown.costPerTestTL)} highlight />
                <KpiCard label="Hak Ediş (SUT)" value={fmtTL(breakdown.hakEdisTL)} />
                <KpiCard
                  label="Marj (Hak Ediş − Maliyet)"
                  value={fmtTL(breakdown.marjTL)}
                  badge={marjBadge}
                />
              </div>

              {/* Stok + Ortak Giderler tablosu */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Bu Test İçin Full Burden Kırılımı</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell>Stok Maliyeti (bu testin ürünleri)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(breakdown.stockCostTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Diğer Testlerin Stok Maliyeti</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(breakdown.otherTestsStockCostTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Envanter (aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(breakdown.inventoryCostTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Cihaz Kira/Amortisman (aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(breakdown.deviceCostMonthlyTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Personel Gideri (aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(breakdown.personnelCostMonthlyTL)}</TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/40">
                        <TableCell className="font-semibold">
                          Ortak Giderler Toplamı (bu test açısından)
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {fmtTL(breakdown.ortakGiderlerTL)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-amber-50">
                        <TableCell className="font-bold">Grand Total (Full Burden)</TableCell>
                        <TableCell className="text-right font-mono font-bold text-amber-700">
                          {fmtTL(breakdown.testTotalCostTL)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Lab Kırılımı */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">
                    Laboratuvar Bazında Kırılım ({breakdown.perLab.length} lab)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lab</TableHead>
                        <TableHead className="text-right">Test Adedi</TableHead>
                        <TableHead className="text-right">Stok TL</TableHead>
                        <TableHead className="text-right">Envanter TL/ay</TableHead>
                        <TableHead className="text-right">Cihaz TL/ay</TableHead>
                        <TableHead className="text-right">Personel TL/ay</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breakdown.perLab.map((l) => (
                        <TableRow key={l.labId}>
                          <TableCell className="font-medium">{l.labName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {l.testUnits.toLocaleString('tr-TR')}
                          </TableCell>
                          <TableCell className="text-right font-mono">{fmtTL(l.stockCostTL)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtTL(l.inventoryCostTL)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtTL(l.deviceCostMonthlyTL)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtTL(l.personnelCostMonthlyTL)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Kapasite Metrikleri (cihaz TPH + lab çalışma saati varsa) */}
              {breakdown.capacity && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-base">Kapasite & Atıl Maliyet</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground mb-3">
                      Cihaz saat başına test kapasitesi ve lab çalışma saatleri üzerinden hesaplandı.
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                      <KpiBox
                        label="Aylık Kapasite (saat)"
                        value={`${Math.round(breakdown.capacity.monthlyHours)} sa`}
                      />
                      <KpiBox
                        label="Maks. Test Kapasitesi"
                        value={Math.round(breakdown.capacity.monthlyTestCapacity).toLocaleString('tr-TR')}
                      />
                      <KpiBox
                        label="Utilization"
                        value={`%${(breakdown.capacity.utilization * 100).toFixed(1)}`}
                        highlight={breakdown.capacity.utilization < 0.5}
                      />
                      <KpiBox
                        label="Atıl Maliyet"
                        value={fmtTL(breakdown.capacity.idleCostTL)}
                        warn
                      />
                    </div>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Saatlik Birim Maliyet (ortak gider/saat)</TableCell>
                          <TableCell className="text-right font-mono">{fmtTL(breakdown.capacity.costPerHourTL)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Kapasite-bazlı Birim Maliyet (ortak gider/test)</TableCell>
                          <TableCell className="text-right font-mono">
                            {fmtTL(breakdown.capacity.capacityBasedCostPerTestTL)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Gerçek Test Hacmi</TableCell>
                          <TableCell className="text-right font-mono">
                            {breakdown.capacity.actualTestVolume.toLocaleString('tr-TR')} test
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Sistem Geneli */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Sistem Geneli (Gerçek Harcama)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground mb-3">
                    Bu görünüm tek bir teste değil, lab/sistem toplamına bakar. Ortak giderler TEK SEFER alınır, üzerine
                    tüm test stoklarının maliyeti eklenir.
                  </div>
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell>Envanter (tüm labslar, aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(systemTotal.inventoryCostTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Cihaz (tüm labslar, aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(systemTotal.deviceCostMonthlyTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Personel (tüm labslar, aylık)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(systemTotal.personnelCostMonthlyTL)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Tüm Test Stokları (toplam)</TableCell>
                        <TableCell className="text-right font-mono">{fmtTL(systemTotal.allStockCostTL)}</TableCell>
                      </TableRow>
                      <TableRow className="bg-blue-50">
                        <TableCell className="font-bold">Gerçek Harcama (tek sefer)</TableCell>
                        <TableCell className="text-right font-mono font-bold text-blue-700">
                          {fmtTL(systemTotal.realTotalSpendTL)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Sayılar: {systemTotal.counts.labs} lab • {systemTotal.counts.devices} cihaz •{' '}
                    {systemTotal.counts.assets} envanter • {systemTotal.counts.personnel} personel
                  </div>
                </CardContent>
              </Card>

              {breakdown.warnings.length > 0 && (
                <Card className="border-amber-300 bg-amber-50/60">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                      <AlertCircle className="h-4 w-4" />
                      Uyarılar ({breakdown.warnings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-amber-800 space-y-1">
                    {Array.from(new Set(breakdown.warnings)).slice(0, 12).map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                    {breakdown.warnings.length > 12 && (
                      <div className="text-xs text-amber-700">
                        + {breakdown.warnings.length - 12} uyarı daha (konsola yazıldı)
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({
  label,
  value,
  highlight,
  badge,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <Card className={highlight ? 'border-amber-300 bg-amber-50/40' : undefined}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold font-mono ${highlight ? 'text-amber-700' : ''}`}>{value}</div>
        {badge && <div className="mt-1">{badge}</div>}
      </CardContent>
    </Card>
  );
}

function KpiBox({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={
        warn
          ? 'border border-red-300 bg-red-50/40 rounded-lg p-3'
          : highlight
            ? 'border border-amber-300 bg-amber-50/40 rounded-lg p-3'
            : 'border border-border rounded-lg p-3'
      }
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-base font-bold font-mono mt-1 ${
          warn ? 'text-red-700' : highlight ? 'text-amber-700' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Filtre: gerçek stok hesabında sadece labda olan (isShipped=true) stoğu kullanırız;
 * tüm satırları motora geçirip motor içinde filtrelemek de mümkün, burada erken filtre
 * uygulayarak bellek tasarrufu yapıyoruz.
 */
function depoStokSnapFilter(items: DepoStokItem[]): DepoStokItem[] {
  return items.filter((i) => i.isShipped === true);
}
