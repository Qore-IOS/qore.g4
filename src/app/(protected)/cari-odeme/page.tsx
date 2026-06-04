"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getDashboardData } from "@/lib/cari-odeme/firestore";
import { KpiCard } from "@/components/cari-odeme/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, Wallet, FileText, ArrowRight, ArrowUpRight, ArrowDownRight, Landmark, Receipt, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// Modern, Nukleus-style gradient and glassmorphism elements

export default function CariOdemeDashboard() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!currentCompanyId && !isSuperAdmin) return;
      try {
        setLoading(true);
        const dashData = await getDashboardData({ companyId: currentCompanyId, isSuperAdmin });
        setData(dashData);
      } catch (error) {
        console.error("Dashboard veri hatası:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [currentCompanyId, isSuperAdmin]);

  const kpi = useMemo(() => {
    if (!data) return { total: 0, approved: 0, pending: 0, paid: 0, companies: 0 };
    return data.allPayments.reduce(
      (acc: any, p: any) => {
        acc.total += p.amount;
        if (p.status === "approved") acc.approved += p.amount;
        if (p.status === "pending") acc.pending += p.amount;
        if (p.status === "paid") acc.paid += p.amount;
        return acc;
      },
      { total: 0, approved: 0, pending: 0, paid: 0, companies: data.kpi?.companies || 0 }
    );
  }, [data]);

  const chartData = [
    { name: "Ocak", gelir: 4000, gider: 2400 },
    { name: "Şubat", gelir: 3000, gider: 1398 },
    { name: "Mart", gelir: 2000, gider: 9800 },
    { name: "Nisan", gelir: 2780, gider: 3908 },
    { name: "Mayıs", gelir: 1890, gider: 4800 },
    { name: "Haziran", gelir: 2390, gider: 3800 },
  ];

  if (loading) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex gap-4">
          <Skeleton className="h-32 w-1/4 rounded-2xl" />
          <Skeleton className="h-32 w-1/4 rounded-2xl" />
          <Skeleton className="h-32 w-1/4 rounded-2xl" />
          <Skeleton className="h-32 w-1/4 rounded-2xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Cari & Finans Paneli</h1>
          <p className="text-muted-foreground mt-1">
            Şirketinizin tüm finansal akışını, tahsilat ve ödemelerini buradan yönetin.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button className="bg-[#b3eb46] text-black hover:bg-[#a2d63f] rounded-xl shadow-sm" asChild>
            <Link href="/cari-odeme/faturalar/yeni">
              <FileText className="mr-2 h-4 w-4" /> Yeni Fatura
            </Link>
          </Button>
          <Button variant="outline" className="rounded-xl bg-white shadow-sm" asChild>
            <Link href="/cari-odeme/odemeler/yeni">
              <CreditCard className="mr-2 h-4 w-4" /> Yeni Ödeme
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          title="Toplam Açık Ödemeler"
          value={kpi.pending + kpi.approved}
          subtitle={`${data?.allPayments.filter((p: any) => p.status === 'pending' || p.status === 'approved').length} adet işlem`}
          icon={<ArrowDownRight className="h-5 w-5 text-red-500" />}
          trend={{ value: 12, isPositive: false }}
        />
        <KpiCard
          title="Bu Ayki Tahsilatlar"
          value={125000} // Placeholder for demo
          subtitle="Aylık hedef: 150.000 ₺"
          icon={<ArrowUpRight className="h-5 w-5 text-[#b3eb46]" />}
          trend={{ value: 8, isPositive: true }}
        />
        <KpiCard
          title="Toplam Cari Firma"
          value={kpi.companies}
          subtitle="Aktif çalışan firmalar"
          icon={<Landmark className="h-5 w-5 text-blue-500" />}
          isCurrency={false}
        />
        <KpiCard
          title="Tamamlanan Ödemeler"
          value={kpi.paid}
          subtitle="Son 30 gün"
          icon={<Receipt className="h-5 w-5 text-emerald-500" />}
          trend={{ value: 2.4, isPositive: true }}
        />
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Chart Section */}
        <Card className="lg:col-span-2 rounded-2xl border-border/40 shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Nakit Akışı Özeti
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280' }} tickFormatter={(val) => `₺${val/1000}k`} />
                  <Tooltip 
                    cursor={{fill: '#f3f4f6'}}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="gelir" fill="#b3eb46" radius={[4, 4, 0, 0]} name="Gelir" />
                  <Bar dataKey="gider" fill="#1f2937" radius={[4, 4, 0, 0]} name="Gider" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links / Navigation Cards */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg mb-4">Hızlı Erişim</h3>
          
          <Link href="/cari-odeme/odemeler" className="group block">
            <Card className="rounded-2xl border-border/40 hover:border-primary/50 hover:shadow-md transition-all bg-white cursor-pointer overflow-hidden">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium">Ödemeler Paneli</h4>
                    <p className="text-xs text-muted-foreground">Bekleyen onaylar ve transferler</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/cari-odeme/banka" className="group block">
            <Card className="rounded-2xl border-border/40 hover:border-primary/50 hover:shadow-md transition-all bg-white cursor-pointer overflow-hidden">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium">Banka & Mutabakat</h4>
                    <p className="text-xs text-muted-foreground">Ekstre yükleme ve eşleştirme</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/cari-odeme/tahsilat" className="group block">
            <Card className="rounded-2xl border-border/40 hover:border-primary/50 hover:shadow-md transition-all bg-white cursor-pointer overflow-hidden">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium">Tahsilatlar</h4>
                    <p className="text-xs text-muted-foreground">Gelen ödemeler ve nakit</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </CardContent>
            </Card>
          </Link>

        </div>
      </div>
    </div>
  );
}
