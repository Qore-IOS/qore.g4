"use client";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { listInvoices } from "@/lib/cari-odeme/invoice-firestore";
import type { Invoice } from "@/lib/cari-odeme/invoice-types";
import { format, isAfter, isBefore, startOfMonth, endOfMonth, addMonths, differenceInDays } from "date-fns";
import { tr } from "date-fns/locale";

type CashFlowProjection = {
  month: string;
  inflow: number;  // Beklenen Tahsilat (Satış Faturası)
  outflow: number; // Beklenen Ödeme (Alış Faturası)
  net: number;     // inflow - outflow
};

export default function NakitAkisPage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  
  const [isLoading, setIsLoading] = useState(true);
  const [projections, setProjections] = useState<CashFlowProjection[]>([]);
  const [totalInflow, setTotalInflow] = useState(0);
  const [totalOutflow, setTotalOutflow] = useState(0);

  useEffect(() => {
    async function fetchAndCalculate() {
      setIsLoading(true);
      try {
        const invoices = await listInvoices({ companyId: currentCompanyId, isSuperAdmin }, 5000);
        
        // Sadece açık faturaları (kalan tutarı > 0) al
        const openInvoices = invoices.filter(inv => 
          inv.remainingAmount > 0 && 
          (inv.status === "onaylandi" || inv.status === "kismi_odendi")
        );

        const now = new Date();
        const projectionMap = new Map<string, CashFlowProjection>();

        // Gelecek 6 ay için iskelet oluştur
        for (let i = 0; i < 6; i++) {
          const targetMonth = addMonths(now, i);
          const monthKey = format(targetMonth, "yyyy-MM");
          projectionMap.set(monthKey, {
            month: format(targetMonth, "MMMM yyyy", { locale: tr }),
            inflow: 0,
            outflow: 0,
            net: 0
          });
        }
        
        // "Gecikmiş" (Vadesi geçmiş) kategorisi
        projectionMap.set("gecikmis", {
          month: "Vadesi Geçmiş",
          inflow: 0,
          outflow: 0,
          net: 0
        });

        let tIn = 0;
        let tOut = 0;

        openInvoices.forEach(inv => {
          const isOverdue = isBefore(inv.dueDate, now);
          const monthKey = isOverdue ? "gecikmis" : format(inv.dueDate, "yyyy-MM");
          
          let proj = projectionMap.get(monthKey);
          if (!proj && !isOverdue) {
            // Eğer 6 aydan daha ilerideyse "İleri Tarihli" kategorisine koyabiliriz ama basitlik için yoksayalım veya ekleyelim
            // Şimdilik sadece Map'te varsa ekle
            return;
          }

          if (proj) {
            if (inv.type === "satis" || inv.type === "alis_iade") {
              proj.inflow += inv.remainingAmount;
              tIn += inv.remainingAmount;
            } else if (inv.type === "alis" || inv.type === "satis_iade") {
              proj.outflow += inv.remainingAmount;
              tOut += inv.remainingAmount;
            }
            proj.net = proj.inflow - proj.outflow;
          }
        });

        setTotalInflow(tIn);
        setTotalOutflow(tOut);
        
        // Map'i array'e çevir (Önce Gecikmiş, sonra kronolojik aylar)
        const sortedProjections = [
          projectionMap.get("gecikmis")!,
          ...Array.from(projectionMap.entries())
            .filter(([k]) => k !== "gecikmis")
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([, v]) => v)
        ];

        setProjections(sortedProjections);

      } catch (error) {
        console.error("Nakit akış verileri hesaplanamadı", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAndCalculate();
  }, [currentCompanyId, isSuperAdmin]);

  const formatCurrency = (n: number) =>
    n.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

  return (
    <div className="space-y-6 w-full p-4 md:p-8">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <LineChart className="h-6 w-6 text-primary" />
            Nakit Akış Projeksiyonu
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Açık faturaların vade tarihlerine göre gelecek 6 aylık nakit akışı tahmini.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Toplam Beklenen Tahsilat</h3>
          </div>
          <div>
            {isLoading ? <Skeleton className="h-8 w-32 rounded-md" /> : (
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(totalInflow)}</div>
            )}
          </div>
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Toplam Beklenen Ödeme</h3>
          </div>
          <div>
            {isLoading ? <Skeleton className="h-8 w-32 rounded-md" /> : (
              <div className="text-2xl font-bold text-destructive">{formatCurrency(totalOutflow)}</div>
            )}
          </div>
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Net Nakit Akışı</h3>
          </div>
          <div>
            {isLoading ? <Skeleton className="h-8 w-32 rounded-md" /> : (
              <div className={cn("text-2xl font-bold", totalInflow - totalOutflow >= 0 ? "text-emerald-600" : "text-destructive")}>
                {formatCurrency(totalInflow - totalOutflow)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm mt-8">
        <div className="p-6 border-b border-border bg-muted/20">
          <h3 className="text-base font-semibold">Aylık Projeksiyon</h3>
          <p className="text-sm text-muted-foreground mt-1">Vade tarihlerine göre gruplanmış nakit giriş ve çıkışları</p>
        </div>
        
        {isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-medium h-10">Dönem</TableHead>
                <TableHead className="font-medium h-10 text-right">Nakit Girişi (Tahsilat)</TableHead>
                <TableHead className="font-medium h-10 text-right">Nakit Çıkışı (Ödeme)</TableHead>
                <TableHead className="font-bold h-10 text-right border-l border-border/50">Net Nakit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projections.map((proj, idx) => (
                <TableRow key={idx} className={cn(
                  "border-border/50 hover:bg-muted/30 transition-colors", 
                  idx === projections.length - 1 && "border-0",
                  proj.month === "Vadesi Geçmiş" && "bg-destructive/5 hover:bg-destructive/10"
                )}>
                  <TableCell className="py-3 font-medium text-foreground">{proj.month}</TableCell>
                  <TableCell className="py-3 text-right font-medium text-emerald-600">
                    {proj.inflow > 0 ? formatCurrency(proj.inflow) : "-"}
                  </TableCell>
                  <TableCell className="py-3 text-right font-medium text-destructive">
                    {proj.outflow > 0 ? formatCurrency(proj.outflow) : "-"}
                  </TableCell>
                  <TableCell className={cn("py-3 text-right border-l border-border/50 font-bold", proj.net >= 0 ? "text-emerald-600" : "text-destructive")}>
                    {formatCurrency(proj.net)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
