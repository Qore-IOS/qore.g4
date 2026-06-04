"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getInvoice } from "@/lib/cari-odeme/invoice-firestore";
import type { Invoice, InvoiceStatus, InvoiceType } from "@/lib/cari-odeme/invoice-types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import BackButton from "@/components/BackButton";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Building2, Calendar, FileText, FileSpreadsheet, Receipt } from "lucide-react";

const TYPE_LABELS: Record<InvoiceType, string> = {
  alis: "Alış Faturası",
  satis: "Satış Faturası",
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

export default function FaturaDetayPage() {
  const params = useParams();
  const id = params.id as string;
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchInvoice() {
      setIsLoading(true);
      try {
        const data = await getInvoice(id);
        setInvoice(data);
      } catch (error) {
        console.error("Fatura yüklenemedi", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchInvoice();
  }, [id]);

  const formatCurrency = (n: number) =>
    n.toLocaleString("tr-TR", { style: "currency", currency: invoice?.currency || "TRY" });

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 max-w-5xl mx-auto text-center">
        <BackButton fallback="/cari-odeme/faturalar" />
        <h2 className="text-2xl font-bold mt-10">Fatura Bulunamadı</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">
      <BackButton fallback="/cari-odeme/faturalar" />
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            Fatura: {invoice.invoiceNo}
          </h1>
          <p className="text-muted-foreground mt-1">
            Oluşturan: {invoice.createdBy} • {format(invoice.createdAt, "dd MMM yyyy HH:mm", { locale: tr })}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={`text-sm px-3 py-1 ${
            invoice.status === "taslak" ? "bg-gray-100 text-gray-700" :
            invoice.status === "onaylandi" ? "bg-blue-100 text-blue-700" :
            invoice.status === "kismi_odendi" ? "bg-yellow-100 text-yellow-700" :
            invoice.status === "odendi" ? "bg-green-100 text-green-700" :
            "bg-red-100 text-red-700"
          }`}
        >
          {STATUS_LABELS[invoice.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Cari Firma
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-medium">{invoice.cariFirmaName}</p>
            <p className="text-sm text-muted-foreground mt-2">ID: {invoice.cariFirmaId}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Fatura Detayları
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Fatura Tipi</span>
              <span className="font-medium">{TYPE_LABELS[invoice.type]}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Fatura Tarihi</span>
              <span className="font-medium">{format(invoice.issueDate, "dd MMMM yyyy", { locale: tr })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vade Tarihi</span>
              <span className="font-medium">{format(invoice.dueDate, "dd MMMM yyyy", { locale: tr })}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Fatura Kalemleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">KDV %</TableHead>
                <TableHead className="text-right">KDV Tutarı</TableHead>
                <TableHead className="text-right">Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <TableRow key={line.lineNo}>
                  <TableCell>{line.lineNo}</TableCell>
                  <TableCell className="font-medium">{line.description}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                  <TableCell className="text-right">%{(line.taxRate * 100).toFixed(0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(line.taxAmount)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-end mt-6">
            <div className="w-full md:w-72 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ara Toplam</span>
                <span>{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">KDV Toplamı</span>
                <span>{formatCurrency(invoice.taxTotal)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Genel Toplam</span>
                <span>{formatCurrency(invoice.grandTotal)}</span>
              </div>
              
              <div className="border-t border-dashed my-4"></div>
              
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ödenen Tutar</span>
                <span className="text-green-600">{formatCurrency(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span>Kalan Tutar</span>
                <span className={invoice.remainingAmount > 0 ? "text-red-500" : ""}>
                  {formatCurrency(invoice.remainingAmount)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" /> Notlar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
