"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowRight, Receipt, FileText } from "lucide-react";
import { listInvoices } from "@/lib/cari-odeme/invoice-firestore";
import type { Invoice, InvoiceStatus, InvoiceType } from "@/lib/cari-odeme/invoice-types";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<InvoiceType, string> = {
  alis: "Alış",
  satis: "Satış",
  alis_iade: "Alış İade",
  satis_iade: "Satış İade",
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  taslak: "Taslak",
  onaylandi: "Onaylandı",
  kismi_odendi: "Kısmi Ödendi",
  odendi: "Ödendi",
  iptal: "İptal",
};

export default function FaturalarPage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchInvoices() {
      setIsLoading(true);
      try {
        const data = await listInvoices({ companyId: currentCompanyId, isSuperAdmin });
        setInvoices(data);
      } catch (error) {
        console.error("Faturalar yüklenemedi", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchInvoices();
  }, [currentCompanyId, isSuperAdmin]);

  const formatCurrency = (n: number, currency: string) =>
    n.toLocaleString("tr-TR", { style: "currency", currency });

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 py-4">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            Faturalar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Alış, satış ve iade faturalarınızı buradan yönetin.
          </p>
        </div>
        <Button asChild className="rounded-full gap-2 shadow-sm px-6">
          <Link href="/cari-odeme/faturalar/yeni">
            <Plus className="h-4 w-4" />
            Yeni Fatura
          </Link>
        </Button>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        {isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground opacity-30 mb-4" />
            <p className="text-muted-foreground">Henüz hiç fatura bulunmuyor.</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-medium h-10">Tarih</TableHead>
                <TableHead className="font-medium h-10">Fatura No</TableHead>
                <TableHead className="font-medium h-10">Firma</TableHead>
                <TableHead className="font-medium h-10">Tip</TableHead>
                <TableHead className="font-medium h-10">Tutar</TableHead>
                <TableHead className="font-medium h-10">Kalan</TableHead>
                <TableHead className="font-medium h-10">Durum</TableHead>
                <TableHead className="h-10 text-right"><span className="sr-only">İşlemler</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv, idx) => (
                <TableRow key={inv.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", idx === invoices.length - 1 && "border-0")}>
                  <TableCell className="py-3 text-muted-foreground">{format(new Date(inv.issueDate), "dd.MM.yyyy")}</TableCell>
                  <TableCell className="py-3 font-medium">{inv.invoiceNo}</TableCell>
                  <TableCell className="py-3 font-medium">{inv.cariFirmaName}</TableCell>
                  <TableCell className="py-3">
                    <Badge variant="outline" className="rounded-full px-2.5 font-normal border-border bg-muted/50">
                      {TYPE_LABELS[inv.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">{formatCurrency(inv.grandTotal, inv.currency)}</TableCell>
                  <TableCell className={cn("py-3", inv.remainingAmount > 0 ? "text-destructive font-medium" : "text-muted-foreground")}>
                    {formatCurrency(inv.remainingAmount, inv.currency)}
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "rounded-full px-2.5 font-medium",
                        inv.status === "taslak" ? "bg-muted text-muted-foreground" :
                        inv.status === "onaylandi" ? "bg-blue-500/10 text-blue-600" :
                        inv.status === "kismi_odendi" ? "bg-yellow-500/10 text-yellow-600" :
                        inv.status === "odendi" ? "bg-emerald-500/10 text-emerald-600" :
                        "bg-red-500/10 text-red-600"
                      )}
                    >
                      {STATUS_LABELS[inv.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <Link href={`/cari-odeme/faturalar/${inv.id}`} className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1">
                      Görüntüle <ArrowRight className="h-3 w-3" />
                    </Link>
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
