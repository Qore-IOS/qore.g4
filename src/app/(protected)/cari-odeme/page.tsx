'use client';
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getDashboardData, updatePaymentStatus, listBankAccounts, listDepartments } from "@/lib/cari-odeme/firestore";
import { resolveFinanceRoles, getNextStates, getTransitionLabel } from "@/lib/cari-odeme/state-machine";
import type { FinanceRole } from "@/lib/cari-odeme/finance-types";
import { KpiCard } from "@/components/cari-odeme/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Hourglass, Sigma, Check, CreditCard, MoreHorizontal, Expand, ArrowLeft, Calendar as CalendarIcon, X, Download, Wallet, FileText, Building2, Settings, Receipt, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Payment, BankAccount, Department } from "@/lib/cari-odeme/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { addDays, format, getMonth } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAuth } from "@/contexts/auth-context";

type DashboardData = {
  allPayments: Payment[];
  kpi: { total: number; approved: number; pending: number; paid: number; companies: number };
  departments: Department[];
};

type StatusFilter = "all" | "approved" | "paid";

type BankSelectionModalState = {
  open: boolean;
  paymentId: string | null;
  targetStatus: "approved" | "paid" | null;
};

type BankDetails = { name: string; payments: Payment[] };

const monthlyChartConfig = {
  total: { label: "Toplam Ödeme", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const departmentChartConfig = {
  bütçe: { label: "Bütçe", color: "hsl(221 83% 53%)" },
  harcama: { label: "Harcama", color: "hsl(25 95% 53%)" },
} satisfies ChartConfig;

const NAV = [
  { href: "/cari-odeme/odemeler", label: "Ödemeler", icon: Wallet },
  { href: "/cari-odeme/sablonlar", label: "Talimatlar", icon: FileText },
  { href: "/cari-odeme/firmalar", label: "Cari Firmalar", icon: Building2 },
  { href: "/cari-odeme/faturalar", label: "Faturalar", icon: Receipt },
  { href: "/cari-odeme/ekstre", label: "Cari Ekstre", icon: BookOpen },
  { href: "/cari-odeme/ayarlar", label: "Ayarlar", icon: Settings },
];

export default function Dashboard() {
  const { currentCompanyId, isSuperAdmin, currentUserProfile, currentUser } = useAuth();
  const financeRoles: FinanceRole[] = resolveFinanceRoles(
    currentUserProfile?.accessibleViews,
    isSuperAdmin
  );
  const canApprove = financeRoles.includes("approver") || financeRoles.includes("finance_admin");

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankSelectionModalState, setBankSelectionModalState] = useState<BankSelectionModalState>({ open: false, paymentId: null, targetStatus: null });
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [isBankTotalsModalOpen, setBankTotalsModalOpen] = useState(false);
  const [selectedBankDetails, setSelectedBankDetails] = useState<BankDetails | null>(null);
  const [isPendingModalOpen, setPendingModalOpen] = useState(false);
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const { toast } = useToast();

  const formatTRY = (n: number) => n.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

  const fetchDashboardData = async () => {
    const scope = { companyId: currentCompanyId, isSuperAdmin };
    try {
      const [dashboardData, banksData, departmentsData] = await Promise.all([
        getDashboardData(scope),
        listBankAccounts(scope),
        listDepartments(scope),
      ]);
      setData({ ...dashboardData, departments: departmentsData });
      setBankAccounts(banksData);
    } catch (error) {
      console.error("Veri alınırken hata oluştu:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, isSuperAdmin]);

  const kpi = useMemo(() => {
    if (!data) return { total: 0, approved: 0, pending: 0, paid: 0, companies: 0 };
    let paymentsToCalc = data.allPayments;
    if (date?.from || date?.to) {
      paymentsToCalc = paymentsToCalc.filter((p) => {
        const paymentDate = new Date(p.createdAt);
        if (date.from && paymentDate < date.from) return false;
        if (date.to && paymentDate > addDays(date.to, 1)) return false;
        return true;
      });
    }
    const calculatedKpi = paymentsToCalc.reduce(
      (acc, p) => {
        acc.total += p.amount;
        if (p.status === "approved") acc.approved += p.amount;
        if (p.status === "pending") acc.pending += p.amount;
        if (p.status === "paid") acc.paid += p.amount;
        return acc;
      },
      { total: 0, approved: 0, pending: 0, paid: 0 }
    );
    return { ...calculatedKpi, companies: data.kpi.companies };
  }, [data, date]);

  const pendingPayments = useMemo(() => {
    if (!data) return [];
    return data.allPayments.filter((p) => p.status === "pending");
  }, [data]);

  const filteredPayments = useMemo(() => {
    if (!data) return [];
    let payments = data.allPayments;
    if (date?.from || date?.to) {
      payments = payments.filter((p) => {
        const paymentDate = new Date(p.updatedAt);
        if (date.from && paymentDate < date.from) return false;
        if (date.to && paymentDate > addDays(date.to, 1)) return false;
        return true;
      });
    }
    if (statusFilter === "all") return payments.filter((p) => p.status === "approved" || p.status === "paid");
    return payments.filter((p) => p.status === statusFilter);
  }, [data, statusFilter, date]);

  const bankTotals = useMemo(() => {
    const bankTotalsMap = new Map<string, { amount: number; count: number }>();
    filteredPayments.forEach((p) => {
      if (!p.bankName) return;
      const entry = bankTotalsMap.get(p.bankName) || { amount: 0, count: 0 };
      entry.amount += p.amount;
      entry.count++;
      bankTotalsMap.set(p.bankName, entry);
    });
    return Array.from(bankTotalsMap.entries()).map(([name, d]) => ({ name, ...d }));
  }, [filteredPayments]);

  const topCompanies = useMemo(() => {
    const topMap = new Map<string, number>();
    filteredPayments.forEach((p) => {
      topMap.set(p.companyName, (topMap.get(p.companyName) || 0) + p.amount);
    });
    return Array.from(topMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [filteredPayments]);

  const monthlyPaymentData = useMemo(() => {
    if (!data) return [];
    const monthNames = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    const monthlyTotals = Array.from({ length: 12 }, () => 0);
    let paymentsToConsider = data.allPayments;
    paymentsToConsider =
      statusFilter !== "all"
        ? paymentsToConsider.filter((p) => p.status === statusFilter)
        : paymentsToConsider.filter((p) => p.status === "paid" || p.status === "approved");
    paymentsToConsider.forEach((payment) => {
      monthlyTotals[getMonth(new Date(payment.createdAt))] += payment.amount;
    });
    return monthNames.map((month, index) => ({ month, total: monthlyTotals[index] }));
  }, [data, statusFilter]);

  const departmentChartData = useMemo(() => {
    if (!data?.departments || !data?.allPayments) return [];
    const departmentSpend = new Map<string, number>();
    let paymentsToConsider = data.allPayments;
    paymentsToConsider =
      statusFilter !== "all"
        ? paymentsToConsider.filter((p) => p.status === statusFilter)
        : paymentsToConsider.filter((p) => p.status === "paid" || p.status === "approved");
    paymentsToConsider.forEach((payment) => {
      if (payment.department) departmentSpend.set(payment.department, (departmentSpend.get(payment.department) || 0) + payment.amount);
    });
    return data.departments.map((dept) => ({ name: dept.name, bütçe: dept.budget, harcama: departmentSpend.get(dept.name) || 0 }));
  }, [data, statusFilter]);

  useEffect(() => {
    if (!isBankTotalsModalOpen) setSelectedBankDetails(null);
  }, [isBankTotalsModalOpen]);

  const handleOpenBankSelection = (paymentId: string, targetStatus: "approved" | "paid") => {
    setBankSelectionModalState({ open: true, paymentId, targetStatus });
  };

  const handleConfirmBankSelection = async () => {
    const { paymentId, targetStatus } = bankSelectionModalState;
    if (!paymentId || !targetStatus || !selectedBank) {
      toast({ variant: "destructive", title: "Hata", description: "Lütfen bir banka seçin." });
      return;
    }
    try {
      const scope = { companyId: currentCompanyId, isSuperAdmin };
      const userId = currentUser?.uid ?? "unknown";
      const userName = currentUserProfile?.name ?? currentUser?.email ?? "Bilinmeyen";
      await updatePaymentStatus(
        scope,
        paymentId,
        targetStatus,
        financeRoles,
        userId,
        userName,
        { bankName: selectedBank }
      );
      toast({ title: "Başarılı", description: `Ödeme durumu güncellendi ve banka atandı.` });
      setBankSelectionModalState({ open: false, paymentId: null, targetStatus: null });
      setSelectedBank("");
      setPendingModalOpen(false);
      await fetchDashboardData();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Hata", description: error?.message || "Ödeme durumu güncellenemedi." });
    }
  };

  const handleBankRowClick = (bankName: string) => {
    const bankPayments = filteredPayments.filter((p) => p.bankName === bankName);
    setSelectedBankDetails({ name: bankName, payments: bankPayments });
  };

  const handleExportBankTotals = async () => {
    toast({ title: "Dışa Aktarma Başlatıldı", description: "Veriler Excel'e aktarılıyor..." });
    const exportData = {
      rows: bankTotals,
      title: "Banka Toplamları",
      columns: [
        { header: "Banka Adı", key: "name", width: 30 },
        { header: "İşlem Adedi", key: "count", width: 15 },
        { header: "Toplam Tutar", key: "amount", width: 20, style: { numFmt: '#,##0.00 "TRY"' } },
      ],
    };
    try {
      const response = await fetch("/api/cari-odeme/export/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.reason || `Sunucu hatası: ${response.statusText}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "banka-toplamlari.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Başarılı", description: "Excel dosyası indirildi." });
    } catch (error: any) {
      console.error("Dışa aktarma hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: error.message || "Excel dosyası oluşturulamadı." });
    }
  };

  if (loading || !data) return <DashboardSkeleton />;

  return (
    <div className="space-y-8 p-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gösterge Paneli</h1>
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button id="date" variant="outline" className={cn("w-full sm:w-auto min-w-[240px] justify-start text-left font-normal bg-card border-border hover:bg-muted/50", !date && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                {date?.from ? (
                  date.to ? (
                    <>{format(date.from, "LLL dd, y", { locale: tr })} - {format(date.to, "LLL dd, y", { locale: tr })}</>
                  ) : (
                    format(date.from, "LLL dd, y", { locale: tr })
                  )
                ) : (
                  <span>Tarih aralığı seçin</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar initialFocus mode="range" defaultMonth={date?.from} selected={date} onSelect={setDate} numberOfMonths={2} locale={tr} />
            </PopoverContent>
          </Popover>
          {date && (
            <Button variant="ghost" size="icon" onClick={() => setDate(undefined)} className="h-9 w-9">
              <X className="h-4 w-4" /><span className="sr-only">Filtreyi temizle</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <KpiCard title="Toplam Tutar" value={formatTRY(kpi.total)} icon={Sigma} />
        <KpiCard title="Onaylanmış" value={formatTRY(kpi.approved)} icon={Check} />
        
        <Dialog open={isPendingModalOpen} onOpenChange={setPendingModalOpen}>
          <DialogTrigger asChild>
            <div className="cursor-pointer h-full">
              <KpiCard title="Beklemede" value={formatTRY(kpi.pending)} icon={Hourglass} showBadge={kpi.pending > 0} />
            </div>
          </DialogTrigger>
          <DialogContent className="max-w-4xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-medium">Beklemedeki Ödemeler</DialogTitle>
              <DialogDescription>Onay veya ödeme bekleyen tüm ödemelerin listesi.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto mt-4">
              <Table className="border-b border-border">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="font-medium">Firma</TableHead>
                    <TableHead className="font-medium">Talep Eden</TableHead>
                    <TableHead className="font-medium text-right">Tutar</TableHead>
                    <TableHead className="font-medium">Vade Tarihi</TableHead>
                    <TableHead className="font-medium text-right">İşlem Yap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingPayments.length > 0 ? (
                    pendingPayments.map((payment) => (
                      <TableRow key={payment.id} className="border-border/50">
                        <TableCell className="font-medium">{payment.companyName}</TableCell>
                        <TableCell className="text-muted-foreground">{payment.requesterName}</TableCell>
                        <TableCell className="text-right font-medium">{formatTRY(payment.amount)}</TableCell>
                        <TableCell className="text-muted-foreground">{new Date(payment.dueDate).toLocaleDateString("tr-TR")}</TableCell>
                        <TableCell className="text-right">
                          {canApprove ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 hover:bg-muted/50 text-primary">İşlem <MoreHorizontal className="ml-2 h-3 w-3" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => handleOpenBankSelection(payment.id, "approved")}>Onayla</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenBankSelection(payment.id, "paid")}>Ödendi Olarak İşaretle</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-xs text-muted-foreground">Yetkisiz</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Beklemede ödeme bulunmuyor.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
        
        <KpiCard title="Ödenmiş" value={formatTRY(kpi.paid)} icon={CreditCard} />
      </div>

      {/* Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl bg-card border border-border shadow-sm flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Aylık Toplam Ödemeler</h2>
          <ChartContainer config={monthlyChartConfig} className="h-64 w-full">
            <LineChart data={monthlyPaymentData}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} fontSize={12} fill="hsl(var(--muted-foreground))" />
              <YAxis width={65} tickFormatter={(value) => formatTRY(value).replace(',00', '')} tickLine={false} axisLine={false} fontSize={12} fill="hsl(var(--muted-foreground))" />
              <Tooltip content={<ChartTooltipContent indicator="line" />} />
              <Line dataKey="total" type="monotone" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--primary))" }} activeDot={{ r: 6 }} />
            </LineChart>
          </ChartContainer>
        </div>
        
        <div className="p-5 rounded-xl bg-card border border-border shadow-sm flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Departman Bütçe vs. Harcama</h2>
          <ChartContainer config={departmentChartConfig} className="h-64 w-full">
            <BarChart data={departmentChartData} barGap={4}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={10} fontSize={12} fill="hsl(var(--muted-foreground))" />
              <YAxis width={65} tickFormatter={(value) => formatTRY(value).replace(',00', '')} tickLine={false} axisLine={false} fontSize={12} fill="hsl(var(--muted-foreground))" />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} iconType="circle" />
              <Bar dataKey="bütçe" fill="hsl(221 83% 53%)" radius={[4, 4, 0, 0]} barSize={24} />
              <Bar dataKey="harcama" fill="hsl(25 95% 53%)" radius={[4, 4, 0, 0]} barSize={12} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>

      {/* Filters (Center Aligned as requested) */}
      <div className="flex justify-center gap-2 pt-2">
        {(["all", "approved", "paid"] as StatusFilter[]).map((filter) => (
          <Button 
            key={filter} 
            variant={statusFilter === filter ? "default" : "outline"} 
            className={cn("rounded-full px-6", statusFilter !== filter && "bg-transparent border-border hover:bg-muted")}
            onClick={() => setStatusFilter(filter)}
          >
            {filter === "all" ? "Tümü" : filter === "approved" ? "Onaylanmış" : "Ödenmiş"}
          </Button>
        ))}
      </div>

      {/* Bottom Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium text-muted-foreground">Banka Toplamları</h3>
            <Dialog open={isBankTotalsModalOpen} onOpenChange={setBankTotalsModalOpen}>
              <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-8 text-primary hover:bg-primary/10">Tümünü Gör</Button></DialogTrigger>
              <DialogContent className="max-w-4xl bg-card border-border">
                {selectedBankDetails ? (
                  <>
                    <DialogHeader className="pb-4 border-b border-border/50">
                      <div className="flex items-center gap-3">
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-border hover:bg-muted" onClick={() => setSelectedBankDetails(null)}>
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div>
                          <DialogTitle className="font-medium text-lg">{selectedBankDetails.name}</DialogTitle>
                          <DialogDescription>Ödeme Detayları</DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border">
                            <TableHead className="font-medium">Firma</TableHead>
                            <TableHead className="font-medium">Talep Eden</TableHead>
                            <TableHead className="font-medium">Açıklama</TableHead>
                            <TableHead className="font-medium text-right">Tutar</TableHead>
                            <TableHead className="font-medium">Ödeme Tarihi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedBankDetails.payments.map((p) => (
                            <TableRow key={p.id} className="border-border/50">
                              <TableCell className="font-medium">{p.companyName}</TableCell>
                              <TableCell className="text-muted-foreground">{p.requesterName}</TableCell>
                              <TableCell className="text-muted-foreground text-xs truncate max-w-[150px]">{p.description || "—"}</TableCell>
                              <TableCell className="text-right font-medium">{formatTRY(p.amount)}</TableCell>
                              <TableCell className="text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString("tr-TR")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <>
                    <DialogHeader className="pb-4 border-b border-border/50">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                          <DialogTitle className="font-medium text-lg">Tüm Banka Toplamları</DialogTitle>
                          <DialogDescription>Detayları görmek için bir bankaya tıklayın.</DialogDescription>
                        </div>
                        <Button onClick={handleExportBankTotals} className="w-full sm:w-auto rounded-full bg-primary text-primary-foreground hover:bg-primary/90">
                          <Download className="mr-2 h-4 w-4" /> Excel'e Aktar
                        </Button>
                      </div>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border">
                            <TableHead className="font-medium">Banka</TableHead>
                            <TableHead className="font-medium text-right">Adet</TableHead>
                            <TableHead className="font-medium text-right">Tutar</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bankTotals.map((b) => (
                            <TableRow key={b.name} onClick={() => handleBankRowClick(b.name)} className="cursor-pointer border-border/50 hover:bg-muted/30">
                              <TableCell className="font-medium">{b.name}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{b.count}</TableCell>
                              <TableCell className="text-right font-medium">{formatTRY(b.amount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableBody>
                {bankTotals.length > 0 ? (
                  bankTotals.slice(0, 5).map((b, i) => (
                    <TableRow key={b.name} className={cn("border-border/50 hover:bg-transparent", i === bankTotals.slice(0, 5).length - 1 && "border-0")}>
                      <TableCell className="font-medium py-4">{b.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground py-4">{b.count} adet</TableCell>
                      <TableCell className="text-right font-medium py-4">{formatTRY(b.amount)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground border-0">Filtreye uygun veri yok.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium text-muted-foreground">En Çok Ödeme Yapılan Firmalar</h3>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableBody>
                {topCompanies.length > 0 ? (
                  topCompanies.map((c, i) => (
                    <TableRow key={c.name} className={cn("border-border/50 hover:bg-transparent", i === topCompanies.length - 1 && "border-0")}>
                      <TableCell className="font-medium py-4">{c.name}</TableCell>
                      <TableCell className="text-right font-medium py-4">{formatTRY(c.amount)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={2} className="h-24 text-center text-muted-foreground border-0">Filtreye uygun veri yok.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Bank Selection Modal */}
      <Dialog open={bankSelectionModalState.open} onOpenChange={(isOpen) => setBankSelectionModalState((prev) => ({ ...prev, open: isOpen }))}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-medium">Banka Seçimi</DialogTitle>
            <DialogDescription>İşlemi tamamlamak için bir banka hesabı seçin.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bank-select">Banka Hesabı</Label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger id="bank-select" className="bg-transparent border-border">
                  <SelectValue placeholder="Bir banka seçin..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.bankName}>{account.bankName} - <span className="text-muted-foreground text-xs">{account.iban}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setBankSelectionModalState({ open: false, paymentId: null, targetStatus: null })} className="rounded-full border-border">İptal</Button>
            <Button onClick={handleConfirmBankSelection} className="rounded-full">Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 p-6 w-full">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-64 bg-muted" />
        <Skeleton className="h-10 w-48 rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Skeleton className="h-28 rounded-xl bg-card border border-border" />
        <Skeleton className="h-28 rounded-xl bg-card border border-border" />
        <Skeleton className="h-28 rounded-xl bg-card border border-border" />
        <Skeleton className="h-28 rounded-xl bg-card border border-border" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-80 rounded-xl bg-card border border-border" />
        <Skeleton className="h-80 rounded-xl bg-card border border-border" />
      </div>
    </div>
  );
}
