'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useProductCodes } from '@/hooks/useFirebaseQueries';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import type { Currency, ProductCode } from '@/lib/types';
import { getProductCostInCurrency, getSessionDate, type SayimSession } from '@/lib/cost-analytics';
import TrendChart from '@/components/cost-observation/TrendChart';
import { useToast } from '@/hooks/use-toast';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };

export default function BrandObservationPage() {
  const params = useParams<{ markaAdi: string }>();
  const brand = decodeURIComponent(params?.markaAdi || '');
  const router = useRouter();
  const { toast } = useToast();
  const productsQuery = useProductCodes();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [currency, setCurrency] = useState<Currency>('TRY');
  const [rates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const snap = await getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc')));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SayimSession));
      setSessions(filterByCompanyScope(all, currentCompanyId, isSuperAdmin));
      setLoading(false);
    };
    run();
  }, [currentCompanyId, isSuperAdmin]);

  const productMap = useMemo(() => {
    const m = new Map<string, ProductCode>();
    (productsQuery.data || []).forEach((p) => m.set(p.stokKodu, p));
    return m;
  }, [productsQuery.data]);

  const sym = CURRENCY_SYMBOLS[currency];

  const rows = useMemo(() => {
    return sessions.flatMap((s) => s.items
      .filter((i) => (i.marka || 'Diğer') === brand)
      .map((i) => ({
        sessionId: s.id,
        locationName: s.locationName,
        locationType: s.locationType,
        date: getSessionDate(s),
        stokKodu: i.stokKodu,
        stokAdi: i.stokAdi,
        stokAdedi: i.stokAdedi,
        cihazUstuAdedi: i.cihazUstuAdedi,
        totalCost: getProductCostInCurrency(i.stokKodu, i.stokAdedi, i.cihazUstuAdedi, productMap, rates, currency),
      })));
  }, [sessions, brand, productMap, rates, currency]);

  const latestRows = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = `${r.locationType}-${r.locationName}-${r.stokKodu}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rows]);

  const total = latestRows.reduce((s, r) => s + r.totalCost, 0);

  const locationSummary = useMemo(() => {
    const m = new Map<string, { locationName: string; cost: number; count: number }>();
    latestRows.forEach((r) => {
      const row = m.get(r.locationName) || { locationName: r.locationName, cost: 0, count: 0 };
      row.cost += r.totalCost;
      row.count += 1;
      m.set(r.locationName, row);
    });
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
  }, [latestRows]);

  const monthly = useMemo(() => {
    const byMonth = new Map<string, number>();
    rows.forEach((r) => {
      if (!r.date) return;
      const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) || 0) + r.totalCost);
    });
    return Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, cost]) => ({ monthKey: k, monthLabel: k, cost }));
  }, [rows]);

  const pareto = useMemo(() => {
    const sorted = [...latestRows].sort((a, b) => b.totalCost - a.totalCost);
    const thresholdCount = Math.max(1, Math.ceil(sorted.length * 0.2));
    const top = sorted.slice(0, thresholdCount).reduce((sum, r) => sum + r.totalCost, 0);
    const share = total > 0 ? (top / total) * 100 : 0;
    return { topCost: top, share, thresholdCount };
  }, [latestRows, total]);

  const unitCostAvg = useMemo(() => {
    const totalUnits = latestRows.reduce((sum, r) => sum + r.stokAdedi + r.cihazUstuAdedi, 0);
    return totalUnits > 0 ? total / totalUnits : 0;
  }, [latestRows, total]);

  const loadLogoDataUrl = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/QORE-INV_LOGO.PNG');
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }, []);

  const handleExcelExport = useCallback(async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        [`QORE Marka Gözlem Raporu - ${brand}`],
        [`Tarih: ${new Date().toLocaleString('tr-TR')}`],
        [`Para Birimi: ${currency}`],
        [`Toplam Marka Maliyeti: ${sym}${total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`],
        [],
        ['Ürün', 'Stok Kodu', 'Konum', 'Stok', 'Cihaz Üstü', 'Maliyet'],
        ...latestRows.map((r) => [r.stokAdi, r.stokKodu, r.locationName, r.stokAdedi, r.cihazUstuAdedi, Number(r.totalCost.toFixed(2))]),
      ]);
      ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
      (ws as any)['!autofilter'] = { ref: `A6:F${latestRows.length + 6}` };
      (ws as any)['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      XLSX.utils.book_append_sheet(wb, ws, 'MarkaDetay');

      const trendWs = XLSX.utils.json_to_sheet(monthly.map((m) => ({ Ay: m.monthLabel, Maliyet: Number(m.cost.toFixed(2)) })));
      trendWs['!cols'] = [{ wch: 18 }, { wch: 18 }];
      (trendWs as any)['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      XLSX.utils.book_append_sheet(wb, trendWs, 'AylikTrend');

      XLSX.writeFile(wb, `Marka_Gozlem_${brand}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast({ title: 'Başarılı', description: 'Excel raporu indirildi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'Excel raporu oluşturulamadı.', variant: 'destructive' });
    }
  }, [brand, currency, latestRows, monthly, sym, toast, total]);

  const handlePdfExport = useCallback(async () => {
    try {
      const [jsPDFModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const jsPDF = jsPDFModule.default;
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      const pageW = doc.internal.pageSize.getWidth();
      const logo = await loadLogoDataUrl();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(`QORE Marka Gozlem - ${brand}`, 40, 34);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Tarih: ${new Date().toLocaleString('tr-TR')}`, 40, 52);
      doc.text(`Toplam Maliyet: ${sym}${total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`, 40, 66);
      if (logo) doc.addImage(logo, 'PNG', pageW - 180, 16, 140, 40, undefined, 'FAST');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Aylik Trend (Grafik)', 40, 95);
      const chartX = 40; const chartY = 106; const chartW = pageW - 80; const chartH = 95;
      doc.setDrawColor(203, 213, 225);
      doc.rect(chartX, chartY, chartW, chartH);
      const maxCost = Math.max(...monthly.map((m) => m.cost), 1);
      monthly.forEach((m, i) => {
        const bw = Math.max(10, (chartW - 20) / Math.max(monthly.length, 1) - 6);
        const x = chartX + 10 + i * (bw + 6);
        const h = (m.cost / maxCost) * (chartH - 24);
        doc.setFillColor(14, 165, 233);
        doc.rect(x, chartY + chartH - 12 - h, bw, h, 'F');
        doc.setFontSize(7);
        doc.text(m.monthLabel, x, chartY + chartH - 2);
      });

      autoTable(doc, {
        startY: 220,
        head: [['Ürün', 'Stok Kodu', 'Konum', 'Stok', 'Cihaz Üstü', 'Maliyet']],
        body: latestRows.slice(0, 300).map((r) => [r.stokAdi, r.stokKodu, r.locationName, String(r.stokAdedi), String(r.cihazUstuAdedi), `${sym}${r.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`]),
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85] },
      });

      doc.save(`Marka_Gozlem_${brand}_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: 'Başarılı', description: 'PDF raporu indirildi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'PDF raporu oluşturulamadı.', variant: 'destructive' });
    }
  }, [brand, latestRows, loadLogoDataUrl, monthly, sym, toast, total]);

  if (loading || productsQuery.isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" /></div>;
  }

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"><ArrowLeft className="w-4 h-4" /> Geri</button>
          <div className="flex gap-1 flex-wrap justify-end">
            <button onClick={handleExcelExport} className="px-2.5 py-1 rounded-lg text-xs bg-emerald-500 text-white inline-flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" />Excel</button>
            <button onClick={handlePdfExport} className="px-2.5 py-1 rounded-lg text-xs bg-blue-600 text-white inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />PDF</button>
            {(['EUR','USD','TRY'] as Currency[]).map((c) => <button key={c} onClick={() => setCurrency(c)} className={`px-2 py-1 rounded-lg text-xs ${currency===c ? 'bg-[var(--dashboard-accent)] text-white' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'}`}>{CURRENCY_SYMBOLS[c]} {c}</button>)}
          </div>
        </div>

        <h1 className="text-2xl font-bold text-[var(--dashboard-text)]">{brand} — Marka Gözlem Paneli</h1>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="cihaz-card-strong p-5">
            <p className="text-sm text-[var(--dashboard-muted)]">Toplam Marka Maliyeti</p>
            <p className="text-3xl font-bold text-[var(--dashboard-accent)]">{sym}{total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
            <p className="text-xs text-[var(--dashboard-muted)]">{latestRows.length} aktif ürün snapshot</p>
          </div>
          <div className="cihaz-card-strong p-5">
            <p className="text-sm text-[var(--dashboard-muted)]">Pareto (Top %20 Ürün)</p>
            <p className="text-xl font-bold text-[var(--dashboard-accent)]">%{pareto.share.toFixed(1)}</p>
            <p className="text-xs text-[var(--dashboard-muted)]">{pareto.thresholdCount} ürün · {sym}{pareto.topCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="cihaz-card-strong p-5">
            <p className="text-sm text-[var(--dashboard-muted)]">Birim Maliyet Ort.</p>
            <p className="text-xl font-bold text-[var(--dashboard-accent)]">{sym}{unitCostAvg.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-[var(--dashboard-muted)]">test/adet başına</p>
          </div>
          <div className="cihaz-card-strong p-5">
            <p className="text-sm text-[var(--dashboard-muted)]">Konum Sayısı</p>
            <p className="text-xl font-bold text-[var(--dashboard-accent)]">{locationSummary.length}</p>
          </div>
        </div>

        <div className="lg:col-span-2"><TrendChart data={monthly} currency={currency} /></div>

        <div className="cihaz-card-strong p-5">
          <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Konum Bazlı Dağılım</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {locationSummary.map((l) => <div key={l.locationName} className="cihaz-pressed p-3"><p className="font-semibold">{l.locationName}</p><p className="text-xs text-[var(--dashboard-muted)]">{l.count} ürün</p><p className="text-[var(--dashboard-accent)] font-bold">{sym}{l.cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p></div>)}
          </div>
        </div>

        <div className="cihaz-card-strong p-5 overflow-auto">
          <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Ürün Detay Tablosu</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)]">
                <th className="py-2 pr-3">Ürün</th><th className="py-2 pr-3">Konum</th><th className="py-2 pr-3">Stok</th><th className="py-2 pr-3">Cihaz Üstü</th><th className="py-2 pr-3">Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {latestRows.slice(0, 500).map((r) => (
                <tr key={`${r.sessionId}-${r.stokKodu}-${r.locationName}`} className="border-b border-[var(--dashboard-stroke)]/50">
                  <td className="py-2 pr-3">{r.stokAdi}<div className="text-xs text-[var(--dashboard-muted)]">{r.stokKodu}</div></td>
                  <td className="py-2 pr-3">{r.locationName}</td>
                  <td className="py-2 pr-3">{r.stokAdedi}</td>
                  <td className="py-2 pr-3">{r.cihazUstuAdedi}</td>
                  <td className="py-2 pr-3 font-semibold text-[var(--dashboard-accent)]">{sym}{r.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
