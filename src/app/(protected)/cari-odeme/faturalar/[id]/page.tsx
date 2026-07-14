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
      <div className="space-y-6 p-4 w-full md:p-8">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 w-full md:p-8 text-center">
        <BackButton fallback="/cari-odeme/faturalar" />
        <h2 className="text-2xl font-bold mt-10">Fatura Bulunamadı</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full p-4 md:p-8">
      <div className="flex items-center gap-2 mb-4">
        <BackButton fallback="/cari-odeme/faturalar" className="border-border hover:bg-muted" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fatura Detayı</h1>
      </div>
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-card border border-border rounded-xl shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            Fatura No: {invoice.invoiceNo}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Oluşturan: {invoice.createdBy} • {format(invoice.createdAt, "dd MMM yyyy HH:mm", { locale: tr })}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "rounded-full px-3 py-1 font-medium",
            invoice.status === "taslak" ? "bg-muted text-muted-foreground" :
            invoice.status === "onaylandi" ? "bg-blue-500/10 text-blue-600" :
            invoice.status === "kismi_odendi" ? "bg-yellow-500/10 text-yellow-600" :
            invoice.status === "odendi" ? "bg-emerald-500/10 text-emerald-600" :
            "bg-red-500/10 text-red-600"
          )}
        >
          {STATUS_LABELS[invoice.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-muted/30 border border-border rounded-xl p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-muted-foreground" /> Cari Firma
          </h3>
          <p className="text-xl font-medium">{invoice.cariFirmaName}</p>
          <p className="text-sm text-muted-foreground mt-1">Firma Kimliği: {invoice.cariFirmaId}</p>
        </div>

        <div className="bg-muted/30 border border-border rounded-xl p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Calendar className="h-5 w-5 text-muted-foreground" /> Fatura Detayları
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Fatura Tipi</span>
              <span className="font-medium">{TYPE_LABELS[invoice.type]}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Fatura Tarihi</span>
              <span className="font-medium">{format(invoice.issueDate, "dd MMMM yyyy", { locale: tr })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vade Tarihi</span>
              <span className="font-medium">{format(invoice.dueDate, "dd MMMM yyyy", { locale: tr })}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border bg-muted/20">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" /> Fatura Kalemleri
          </h3>
        </div>
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-medium h-10 w-16 text-center">#</TableHead>
              <TableHead className="font-medium h-10">Açıklama</TableHead>
              <TableHead className="font-medium h-10 text-right">Miktar</TableHead>
              <TableHead className="font-medium h-10 text-right">Birim Fiyat</TableHead>
              <TableHead className="font-medium h-10 text-right">KDV %</TableHead>
              <TableHead className="font-medium h-10 text-right">KDV Tutarı</TableHead>
              <TableHead className="font-medium h-10 text-right">Toplam</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lines.map((line, idx) => (
              <TableRow key={line.lineNo} className={cn("border-border/50 hover:bg-muted/30", idx === invoice.lines.length - 1 && "border-0")}>
                <TableCell className="text-center py-3 text-muted-foreground">{line.lineNo}</TableCell>
                <TableCell className="py-3 font-medium">{line.description}</TableCell>
                <TableCell className="py-3 text-right">{line.quantity}</TableCell>
                <TableCell className="py-3 text-right">{formatCurrency(line.unitPrice)}</TableCell>
                <TableCell className="py-3 text-right text-muted-foreground">%{(line.taxRate * 100).toFixed(0)}</TableCell>
                <TableCell className="py-3 text-right text-muted-foreground">{formatCurrency(line.taxAmount)}</TableCell>
                <TableCell className="py-3 text-right font-medium">{formatCurrency(line.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="p-6 bg-muted/10 flex justify-end">
          <div className="w-full md:w-80 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ara Toplam</span>
              <span>{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">KDV Toplamı</span>
              <span>{formatCurrency(invoice.taxTotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-semibold border-t border-border pt-3 mt-1">
              <span>Genel Toplam</span>
              <span>{formatCurrency(invoice.grandTotal)}</span>
            </div>
            
            <div className="border-t border-border/50 border-dashed my-4"></div>
            
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ödenen Tutar</span>
              <span className="text-emerald-600 font-medium">{formatCurrency(invoice.paidAmount)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>Kalan Tutar</span>
              <span className={invoice.remainingAmount > 0 ? "text-destructive" : ""}>
                {formatCurrency(invoice.remainingAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-muted/30 border border-border rounded-xl p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-3">
            <FileText className="h-5 w-5 text-muted-foreground" /> Notlar
          </h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
