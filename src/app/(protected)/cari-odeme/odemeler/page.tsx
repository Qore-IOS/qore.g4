'use client';
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { listPayments, listBankAccounts, listCariFirmalar } from "@/lib/cari-odeme/firestore";
import { Pager } from "@/components/cari-odeme/Pager";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardFooter, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Payment, PaymentStatus, BankAccount, CariFirma } from "@/lib/cari-odeme/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";

function PaymentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [rows, setRows] = useState<Payment[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [requesters, setRequesters] = useState<string[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const cursor = searchParams.get("cursor");
  const status = (searchParams.get("status") as PaymentStatus) || "all";
  const bank = searchParams.get("bank") || "all";
  const cariFirmaId = searchParams.get("cariFirmaId") || "all";
  const requesterName = searchParams.get("requesterName") || "all";

  useEffect(() => {
    const scope = { companyId: currentCompanyId, isSuperAdmin };
    setLoading(true);
    (async () => {
      try {
        const [{ items, nextCursor }, bankData, firmaData] = await Promise.all([
          listPayments(scope, {
            cursor,
            status: status === "all" ? undefined : status,
            bank: bank === "all" ? undefined : bank,
            cariFirmaId: cariFirmaId === "all" ? undefined : cariFirmaId,
            requesterName: requesterName === "all" ? undefined : requesterName,
            size: 20,
          }),
          listBankAccounts(scope),
          listCariFirmalar(scope, { size: 1000 }),
        ]);
        setRows(items);
        setBankAccounts(bankData);
        setFirmalar(firmaData.items);

        const allForRequesters = await listPayments(scope, { size: 10000 });
        setRequesters([...new Set(allForRequesters.items.map((p) => p.requesterName))]);
        setNext(nextCursor);
      } catch (e) {
        console.error("Ödemeler yüklenemedi:", e);
        toast({ variant: "destructive", title: "Hata", description: "Ödemeler yüklenemedi." });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, status, bank, cariFirmaId, requesterName, currentCompanyId, isSuperAdmin]);

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("cursor");
    router.push(`?${params.toString()}`);
  };

  const handleExport = async () => {
    setExporting(true);
    toast({ title: "Dışa Aktarma Başlatıldı", description: "Ödeme verileri Excel dosyası olarak hazırlanıyor..." });
    try {
      const { items: allItems } = await listPayments(
        { companyId: currentCompanyId, isSuperAdmin },
        {
          status: status === "all" ? undefined : status,
          bank: bank === "all" ? undefined : bank,
          cariFirmaId: cariFirmaId === "all" ? undefined : cariFirmaId,
          requesterName: requesterName === "all" ? undefined : requesterName,
          size: 10000,
        }
      );

      const response = await fetch("/api/cari-odeme/export/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allItems, title: "Ödeme Listesi" }),
      });
      if (!response.ok) throw new Error(`Sunucu hatası: ${response.statusText}`);

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "odemeler.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Başarılı", description: "Excel dosyası indirildi." });
    } catch (error: any) {
      console.error("Dışa aktarma hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: error.message || "Excel dosyası oluşturulamadı." });
    } finally {
      setExporting(false);
    }
  };

  const getStatusVariant = (s: PaymentStatus) => {
    switch (s) {
      case "paid": return "default";
      case "approved": return "secondary";
      case "pending": return "outline";
      case "rejected": return "destructive";
      default: return "outline";
    }
  };

  const getStatusText = (s: PaymentStatus) => {
    switch (s) {
      case "paid": return "Ödendi";
      case "approved": return "Onaylandı";
      case "pending": return "Beklemede";
      case "rejected": return "Reddedildi";
      default: return s;
    }
  };

  return (
    <div className="space-y-6 w-full p-4 md:p-8">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <BackButton fallback="/cari-odeme" className="border-border hover:bg-muted" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ödemeler</h1>
        </div>
        <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
          <Link href="/cari-odeme/odemeler/yeni" passHref className="w-full sm:w-auto">
            <Button className="w-full rounded-full px-6 shadow-sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Yeni Ödeme
            </Button>
          </Link>
          <Button variant="outline" onClick={handleExport} disabled={exporting} className="w-full sm:w-auto rounded-full border-border shadow-sm">
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Aktarılıyor..." : "Excel'e Aktar"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-card p-2 rounded-xl border border-border shadow-sm">
        <Select value={requesterName} onValueChange={(value) => handleFilterChange("requesterName", value)}>
          <SelectTrigger className="w-full border-none bg-transparent focus:ring-0 shadow-none"><SelectValue placeholder="Tüm Talep Edenler" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Tüm Talep Edenler</SelectItem>
            {requesters.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={cariFirmaId} onValueChange={(value) => handleFilterChange("cariFirmaId", value)}>
          <SelectTrigger className="w-full border-none bg-transparent focus:ring-0 shadow-none border-t sm:border-t-0 sm:border-l border-border rounded-none"><SelectValue placeholder="Tüm Firmalar" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Tüm Firmalar</SelectItem>
            {firmalar.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => handleFilterChange("status", value)}>
          <SelectTrigger className="w-full border-none bg-transparent focus:ring-0 shadow-none border-t md:border-t-0 md:border-l border-border rounded-none"><SelectValue placeholder="Tüm Durumlar" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Tüm Durumlar</SelectItem>
            <SelectItem value="pending">Beklemede</SelectItem>
            <SelectItem value="approved">Onaylandı</SelectItem>
            <SelectItem value="paid">Ödendi</SelectItem>
            <SelectItem value="rejected">Reddedildi</SelectItem>
          </SelectContent>
        </Select>
        <Select value={bank} onValueChange={(value) => handleFilterChange("bank", value)}>
          <SelectTrigger className="w-full border-none bg-transparent focus:ring-0 shadow-none border-t sm:border-t-0 sm:border-l border-border rounded-none"><SelectValue placeholder="Tüm Bankalar" /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Tüm Bankalar</SelectItem>
            {bankAccounts.map((account) => (<SelectItem key={account.id} value={account.bankName}>{account.bankName}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      {/* Main Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Desktop View */}
        <div className="hidden md:block">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-medium h-12">Talep Eden</TableHead>
                <TableHead className="font-medium h-12">Firma</TableHead>
                <TableHead className="text-right font-medium h-12">Tutar</TableHead>
                <TableHead className="font-medium h-12">Vade Tarihi</TableHead>
                <TableHead className="font-medium h-12">Banka</TableHead>
                <TableHead className="font-medium h-12">Durum</TableHead>
                <TableHead className="h-12"><span className="sr-only">İşlemler</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50"><TableCell colSpan={7}><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                ))
              ) : rows.length > 0 ? (
                rows.map((r, index) => (
                  <TableRow key={r.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", index === rows.length - 1 && "border-0")}>
                    <TableCell className="py-4 text-muted-foreground">{r.requesterName}</TableCell>
                    <TableCell className="py-4 font-medium">{r.companyName}</TableCell>
                    <TableCell className="py-4 text-right font-semibold">{r.amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</TableCell>
                    <TableCell className="py-4 text-muted-foreground">{new Date(r.dueDate).toLocaleDateString("tr-TR")}</TableCell>
                    <TableCell className="py-4 text-muted-foreground">{r.bankName ?? "—"}</TableCell>
                    <TableCell className="py-4">
                      <Badge variant={getStatusVariant(r.status)} className="rounded-full px-3 font-medium shadow-none">
                        {getStatusText(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4 text-right">
                      <Link href={`/cari-odeme/odemeler/${r.id}`} className="text-sm text-primary hover:underline font-medium">Görüntüle</Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground border-0">Filtrelere uygun ödeme bulunamadı.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* Mobile View */}
        <div className="block md:hidden">
          <div className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4"><div className="h-24 animate-pulse bg-muted rounded-md" /></div>
              ))
            ) : rows.length > 0 ? (
              rows.map((r) => (
                <div key={r.id} className="p-4 flex flex-col gap-3 hover:bg-muted/30 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-foreground">{r.companyName}</h4>
                      <p className="text-xs text-muted-foreground mt-1">Talep: {r.requesterName}</p>
                    </div>
                    <Badge variant={getStatusVariant(r.status)} className="rounded-full shadow-none">{getStatusText(r.status)}</Badge>
                  </div>
                  <div className="flex justify-between items-end mt-2">
                    <div className="space-y-1">
                      <p className="font-semibold text-lg">{r.amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</p>
                      <p className="text-xs text-muted-foreground">{r.bankName ?? "Banka atanmadı"} • Vade: {new Date(r.dueDate).toLocaleDateString("tr-TR")}</p>
                    </div>
                    <Link href={`/cari-odeme/odemeler/${r.id}`} className="text-sm text-primary font-medium">Detay</Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center p-8 text-muted-foreground">Ödeme bulunamadı.</div>
            )}
          </div>
        </div>
      </div>

      {!loading && <Pager nextCursor={next} />}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="p-4">Yükleniyor...</div>}>
      <PaymentsPageContent />
    </Suspense>
  );
}
