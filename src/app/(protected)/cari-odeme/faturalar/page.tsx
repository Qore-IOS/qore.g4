"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowRight, Receipt, FileText } from "lucide-react";
import { listInvoices } from "@/lib/cari-odeme/invoice-firestore";
import type { Invoice, InvoiceStatus, InvoiceType } from "@/lib/cari-odeme/invoice-types";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth-context";

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
    <div className="space-y-6 p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Receipt className="h-8 w-8 text-blue-600" />
            Faturalar
          </h1>
          <p className="text-muted-foreground mt-1">
            Alış, satış ve iade faturalarınızı buradan yönetin.
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/cari-odeme/faturalar/yeni">
            <Plus className="h-4 w-4" />
            Yeni Fatura
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fatura Listesi</CardTitle>
          <CardDescription>Sisteme kayıtlı tüm faturalar</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">Henüz hiç fatura bulunmuyor.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Fatura No</TableHead>
                    <TableHead>Firma</TableHead>
                    <TableHead>Tip</TableHead>
                    <TableHead>Tutar</TableHead>
                    <TableHead>Kalan</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{format(new Date(inv.issueDate), "dd.MM.yyyy")}</TableCell>
                      <TableCell className="font-medium">{inv.invoiceNo}</TableCell>
                      <TableCell>{inv.cariFirmaName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{TYPE_LABELS[inv.type]}</Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(inv.grandTotal, inv.currency)}</TableCell>
                      <TableCell className={inv.remainingAmount > 0 ? "text-red-500 font-medium" : ""}>
                        {formatCurrency(inv.remainingAmount, inv.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            inv.status === "taslak" ? "bg-gray-100 text-gray-700" :
                            inv.status === "onaylandi" ? "bg-blue-100 text-blue-700" :
                            inv.status === "kismi_odendi" ? "bg-yellow-100 text-yellow-700" :
                            inv.status === "odendi" ? "bg-green-100 text-green-700" :
                            "bg-red-100 text-red-700"
                          }
                        >
                          {STATUS_LABELS[inv.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/cari-odeme/faturalar/${inv.id}`}>
                            İncele <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
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
