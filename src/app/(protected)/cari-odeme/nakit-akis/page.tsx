"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <LineChart className="h-8 w-8 text-emerald-600" />
          Nakit Akış Projeksiyonu
        </h1>
        <p className="text-muted-foreground mt-1">
          Açık faturaların vade tarihlerine göre gelecek 6 aylık nakit akışı tahmini.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Toplam Beklenen Tahsilat</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-3xl font-bold text-green-600">{formatCurrency(totalInflow)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Toplam Beklenen Ödeme</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-3xl font-bold text-red-600">{formatCurrency(totalOutflow)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Net Nakit Akışı</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32" /> : (
              <div className={`text-3xl font-bold ${totalInflow - totalOutflow >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(totalInflow - totalOutflow)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aylık Projeksiyon</CardTitle>
          <CardDescription>Vade tarihlerine göre gruplanmış nakit giriş ve çıkışları</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dönem</TableHead>
                    <TableHead className="text-right">Nakit Girişi (Tahsilat)</TableHead>
                    <TableHead className="text-right">Nakit Çıkışı (Ödeme)</TableHead>
                    <TableHead className="text-right font-bold border-l">Net Nakit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projections.map((proj, idx) => (
                    <TableRow key={idx} className={proj.month === "Vadesi Geçmiş" ? "bg-red-50/50" : ""}>
                      <TableCell className="font-medium">{proj.month}</TableCell>
                      <TableCell className="text-right text-green-600">
                        {proj.inflow > 0 ? formatCurrency(proj.inflow) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {proj.outflow > 0 ? formatCurrency(proj.outflow) : "-"}
                      </TableCell>
                      <TableCell className={`text-right border-l font-bold ${proj.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatCurrency(proj.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
