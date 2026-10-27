'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getDocs, orderBy } from '../../../../../../lib/data/client';
import { ArrowLeft, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useProductCodes } from '@/hooks/useDatabaseQueries';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery, getScopedDocs } from '@/lib/document-helpers';
import { getExchangeRates } from '@/lib/exchange-rates';
import type { Currency, ProductCode } from '@/lib/types';
import { getLatestByLocation, getProductCostInCurrency, getSessionDate, type SayimSession } from '@/lib/cost-analytics';
import TrendChart from '@/components/cost-observation/TrendChart';
import { useToast } from '@/hooks/use-toast';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };

export default function BrandObservationPage() {
  const params = useParams<{ markaAdi: string }>();
  const brand = decodeURIComponent(params?.markaAdi || '');
  const searchParams = useSearchParams();
  /** Gözlem panelinden seçili dönemle gelindiyse (YYYY-MM) yalnızca o ay analiz edilir. */
  const period = /^\d{4}-\d{2}$/.test(searchParams?.get('period') || '') ? searchParams!.get('period')! : null;
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [currency, setCurrency] = useState<Currency>('TRY');
  // Gözlem paneliyle birebir aynı olsun diye kurlar da canlı çekilir; önceden
  // sabit {EUR:1,USD:1.08,TRY:38.5} idi ve TRY dışı ürünlerde toplam sapıyordu.
  const [rates, setRates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductCode>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Gözlem paneli (StokTab) ile AYNI kaynaklar: oturumlar + legacy-aware
      // ürün kodları + canlı kurlar. useProductCodes strict scope + 1 saatlik
      // önbellek kullandığından güncellenen/legacy ürün maliyetlerini yansıtmıyor,
      // bu da marka toplamının gözlem panelinden sapmasına yol açıyordu.
      const [snap, productDocs, ratesValue] = await Promise.all([
        getDocs(scopedQuery('maliyetSayimSessions', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))),
        getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
        getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
      ]);
      if (cancelled) return;
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SayimSession));
      setSessions(filterByCompanyScope(all, currentCompanyId, isSuperAdmin));
      const pMap = new Map<string, ProductCode>();
      productDocs.forEach((d) => {
        const p = { id: d.id, ...d.data() } as ProductCode;
        pMap.set(p.stokKodu, p);
      });
      setProductMap(pMap);
      setRates(ratesValue as Record<Currency, number>);
      setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [currentCompanyId, isSuperAdmin]);

  const sym = CURRENCY_SYMBOLS[currency];

  // Dönem seçiliyse yalnızca o ayın oturumları; en güncel oturum önce gelecek
  // şekilde analitik tarihe (dönem > createdAt) göre sıralanır — aşağıdaki
  // latestRows dedup'ı ilk görüneni aldığı için sıralama kritik.
  const periodSessions = useMemo(() => {
    const monthKey = (s: SayimSession) => {
      const d = getSessionDate(s);
      return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
    };
    const list = period ? sessions.filter((s) => monthKey(s) === period) : sessions;
    const createdAtMs = (s: SayimSession) => {
      const c: any = s.createdAt;
      if (!c) return 0;
      if (c.toDate) return c.toDate().getTime();
      if (c.seconds) return c.seconds * 1000;
      const d = new Date(c);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    };
    return [...list].sort((a, b) => {
      const ad = getSessionDate(a)?.getTime() ?? 0;
      const bd = getSessionDate(b)?.getTime() ?? 0;
      if (bd !== ad) return bd - ad;
      return createdAtMs(b) - createdAtMs(a);
    });
  }, [sessions, period]);

  const rows = useMemo(() => {
    return Array.from(getLatestByLocation(periodSessions).values()).flatMap((s) => s.items
      .filter((i) => (i.marka || 'Diğer') === brand)
      .map((i) => ({
        sessionId: s.id,
        locationId: s.locationId,
        locationName: s.locationName,
        locationType: s.locationType,
        date: getSessionDate(s),
        stokKodu: i.stokKodu,
        stokAdi: i.stokAdi,
        stokAdedi: i.stokAdedi,
        cihazUstuAdedi: i.cihazUstuAdedi,
        totalCost: getProductCostInCurrency(i.stokKodu, i.stokAdedi, i.cihazUstuAdedi, productMap, rates, currency, i),
      })));
  }, [periodSessions, brand, productMap, rates, currency]);

  // Gözlem panelindeki marka toplamı (getBrandCostBreakdown) her lokasyonun EN
  // GÜNCEL oturumundaki tüm kalemleri toplar; ekstra bir stok-kodu tekilleştirmesi
  // yapmaz. Marka detayı da aynı davranmalı — aksi halde aynı stoğun birden çok
  // satırı (farklı lot/ambalaj) veya aynı isimli iki lokasyon yanlışlıkla elenip
  // toplam düşük çıkıyordu (gözlem ₺40,6M vs detay ₺39,1M). getLatestByLocation
  // zaten lokasyon başına tek oturum bıraktığı için burada dedup gerekmez.
  const latestRows = rows;

  const total = latestRows.reduce((s, r) => s + r.totalCost, 0);

  const locationSummary = useMemo(() => {
    const m = new Map<string, { locationName: string; cost: number; count: number }>();
    latestRows.forEach((r) => {
      const key = `${r.locationType}-${r.locationId || r.locationName}`;
      const row = m.get(key) || { locationName: r.locationName, cost: 0, count: 0 };
      row.cost += r.totalCost;
      row.count += 1;
      m.set(key, row);
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

  const sanitizePdfText = useCallback((text: string): string => {
    return text
      .replace(/İ/g, 'I').replace(/ı/g, 'i')
      .replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o')
      .replace(/Ç/g, 'C').replace(/ç/g, 'c');
  }, []);

  const createPieChartDataUrl = useCallback((items: { label: string; value: number }[], title: string): string | null => {
    if (typeof document === 'undefined' || items.length === 0) return null;
    const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#16a34a', '#ca8a04', '#dc2626'];
    const canvas = document.createElement('canvas');
    canvas.width = 460;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 460, 300);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(title, 18, 26);
    const totalVal = items.reduce((s, i) => s + i.value, 0) || 1;
    let start = -Math.PI / 2;
    const cx = 140, cy = 160, r = 88;
    items.slice(0, 8).forEach((item, i) => {
      const end = start + (item.value / totalVal) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      start = end;
    });
    ctx.font = '12px Arial';
    items.slice(0, 6).forEach((item, i) => {
      const y = 72 + i * 28;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(260, y - 10, 10, 10);
      ctx.fillStyle = '#1e293b';
      const pct = ((item.value / totalVal) * 100).toFixed(1);
      ctx.fillText(`${sanitizePdfText(item.label)} %${pct}`, 276, y);
    });
    return canvas.toDataURL('image/png');
  }, [sanitizePdfText]);

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
      const pageH = doc.internal.pageSize.getHeight();
      const logo = await loadLogoDataUrl();
      const locationPie = createPieChartDataUrl(locationSummary.map((l) => ({ label: l.locationName, value: l.cost })), 'Konum Bazli Dagilim');

      const drawFooter = () => {
        const badgeW = 220;
        const badgeH = 32;
        const bx = pageW / 2 - badgeW / 2;
        const by = pageH - 40;
        doc.setFillColor(254, 243, 199);
        doc.roundedRect(bx, by, badgeW, badgeH, 10, 10, 'F');
        if (logo) {
          doc.addImage(logo, 'PNG', pageW / 2 - 58, by + 8, 116, 14, undefined, 'FAST');
        }
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(sanitizePdfText(`QORE Marka Gozlem - ${brand}`), pageW / 2, 38, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(sanitizePdfText(`Tarih: ${new Date().toLocaleString('tr-TR')}  Para Birimi: ${currency}`), 32, 56);

      const cardW = (pageW - 60) / 4;
      const cards = [
        { t: 'Toplam Marka Maliyeti', v: `${sym}${total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` },
        { t: 'Pareto %20', v: `%${pareto.share.toFixed(1)}` },
        { t: 'Ort. Birim Maliyet', v: `${sym}${unitCostAvg.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` },
        { t: 'Konum Sayisi', v: `${locationSummary.length}` },
      ];
      cards.forEach((c, i) => {
        const x = 20 + i * cardW;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, 70, cardW - 8, 56, 10, 10, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(sanitizePdfText(c.t), x + 10, 91);
        doc.setTextColor(199, 137, 65);
        doc.setFontSize(13);
        doc.text(sanitizePdfText(c.v), x + 10, 112);
        doc.setTextColor(0, 0, 0);
      });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(sanitizePdfText('Aylik Trend (Grafik)'), 28, 148);
      const chartX = 28; const chartY = 160; const chartW = pageW - 56; const chartH = 96;
      doc.setDrawColor(203, 213, 225);
      doc.rect(chartX, chartY, chartW, chartH);
      const maxCost = Math.max(...monthly.map((m) => m.cost), 1);
      monthly.forEach((m, i) => {
        const bw = Math.max(10, (chartW - 24) / Math.max(monthly.length, 1) - 6);
        const x = chartX + 12 + i * (bw + 6);
        const h = (m.cost / maxCost) * (chartH - 24);
        doc.setFillColor(14, 165, 233);
        doc.rect(x, chartY + chartH - 12 - h, bw, h, 'F');
        doc.setFontSize(7);
        doc.text(sanitizePdfText(m.monthLabel), x, chartY + chartH - 2);
      });

      if (locationPie) doc.addImage(locationPie, 'PNG', 28, 266, pageW - 56, 180, undefined, 'FAST');
      drawFooter();

      doc.addPage('a4', 'landscape');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(sanitizePdfText('Marka Detay Tablosu'), 28, 34);
      autoTable(doc, {
        startY: 48,
        head: [[sanitizePdfText('Urun'), sanitizePdfText('Stok Kodu'), sanitizePdfText('Konum'), sanitizePdfText('Stok'), sanitizePdfText('Cihaz Ustu'), sanitizePdfText('Maliyet')]],
        body: latestRows.slice(0, 500).map((r) => [sanitizePdfText(r.stokAdi), r.stokKodu, sanitizePdfText(r.locationName), String(r.stokAdedi), String(r.cihazUstuAdedi), `${sym}${r.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85] },
      });
      drawFooter();

      doc.save(`Marka_Gozlem_${brand}_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: 'Başarılı', description: 'PDF raporu indirildi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'PDF raporu oluşturulamadı.', variant: 'destructive' });
    }
  }, [brand, createPieChartDataUrl, currency, latestRows, loadLogoDataUrl, locationSummary, monthly, pareto.share, sanitizePdfText, sym, toast, total, unitCostAvg]);

  if (loading) {
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

        <h1 className="text-2xl font-bold text-[var(--dashboard-text)]">
          {brand} — Marka Gözlem Paneli
          {period && (
            <span className="ml-3 align-middle inline-block px-2.5 py-1 rounded-lg text-sm font-semibold bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)]">
              {new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} dönemi
            </span>
          )}
        </h1>

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
              {latestRows.slice(0, 500).map((r, idx) => (
                <tr key={`${r.sessionId}-${r.stokKodu}-${idx}`} className="border-b border-[var(--dashboard-stroke)]/50">
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
