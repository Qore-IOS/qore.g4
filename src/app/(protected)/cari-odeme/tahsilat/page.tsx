"use client";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Banknote, FileText } from "lucide-react";
import { listReceipts, createReceipt } from "@/lib/cari-odeme/receipt-firestore";
import type { Receipt, ReceiptType } from "@/lib/cari-odeme/invoice-types";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { useAuth } from "@/contexts/auth-context";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { listCariFirmalar } from "@/lib/cari-odeme/firestore";
import type { CariFirma } from "@/lib/cari-odeme/types";

const TYPE_LABELS: Record<ReceiptType, string> = {
  nakit: "Nakit",
  havale: "Havale / EFT",
  cek: "Çek",
  kredi_karti: "Kredi Kartı",
};

const schema = z.object({
  receiptNo: z.string().min(1, "Makbuz no zorunludur"),
  cariFirmaId: z.string().min(1, "Firma seçimi zorunludur"),
  type: z.enum(["nakit", "havale", "cek", "kredi_karti"]),
  amount: z.coerce.number().min(0.01, "Tutar 0'dan büyük olmalıdır"),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
  receiptDate: z.date({ required_error: "Tarih zorunludur" }),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function TahsilatPage() {
  const { currentCompanyId, isSuperAdmin, currentUserProfile, currentUser } = useAuth();
  const { toast } = useToast();
  
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      receiptNo: "",
      cariFirmaId: "",
      type: "havale",
      amount: 0,
      currency: "TRY",
      description: "",
      receiptDate: new Date(),
    },
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const data = await listReceipts({ companyId: currentCompanyId, isSuperAdmin });
      setReceipts(data);
    } catch (error) {
      console.error("Tahsilatlar yüklenemedi", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, isSuperAdmin]);

  // Modalı açınca firmaları da yükle
  useEffect(() => {
    if (isDialogOpen && firmalar.length === 0) {
      listCariFirmalar({ companyId: currentCompanyId, isSuperAdmin }, { size: 1000 }).then(res => setFirmalar(res.items));
    }
  }, [isDialogOpen, firmalar.length, currentCompanyId, isSuperAdmin]);

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const selectedFirma = firmalar.find((f) => f.id === values.cariFirmaId);
      if (!selectedFirma) throw new Error("Firma bulunamadı");

      const userId = currentUser?.uid ?? "unknown";
      const userName = currentUserProfile?.name ?? currentUser?.email ?? "Bilinmeyen";

      await createReceipt(
        { companyId: currentCompanyId, isSuperAdmin },
        {
          receiptNo: values.receiptNo,
          cariFirmaId: selectedFirma.id,
          cariFirmaName: selectedFirma.name,
          type: values.type as ReceiptType,
          amount: values.amount,
          currency: values.currency,
          receiptDate: values.receiptDate,
          description: values.description,
          allocations: [], // Faz 2'de eklenecek
        },
        userId,
        userName
      );

      toast({ title: "Başarılı", description: "Tahsilat eklendi ve cari bakiye güncellendi." });
      setIsDialogOpen(false);
      form.reset();
      fetchData();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Hata", description: error?.message || "Tahsilat eklenemedi." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (n: number, currency: string) =>
    n.toLocaleString("tr-TR", { style: "currency", currency });

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 py-4">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Banknote className="h-6 w-6 text-primary" />
            Tahsilatlar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Müşterilerden alınan ödemeleri (tahsilat makbuzlarını) buradan yönetin.
          </p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full gap-2 shadow-sm px-6">
              <Plus className="h-4 w-4" />
              Yeni Tahsilat
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] !rounded-xl">
            <DialogHeader>
              <DialogTitle>Yeni Tahsilat Ekle</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                
                <FormField control={form.control} name="cariFirmaId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cari Firma (Müşteri)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger className="rounded-xl"><SelectValue placeholder="Firma Seçin" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {firmalar.map((f) => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="receiptNo" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Makbuz No</FormLabel>
                      <FormControl><Input className="rounded-xl" placeholder="MAK-001" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ödeme Tipi</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="nakit">Nakit</SelectItem>
                          <SelectItem value="havale">Havale / EFT</SelectItem>
                          <SelectItem value="cek">Çek</SelectItem>
                          <SelectItem value="kredi_karti">Kredi Kartı</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tutar</FormLabel>
                      <FormControl><Input className="rounded-xl" type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="currency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Döviz</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="TRY">TRY</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="receiptDate" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Tahsilat Tarihi</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("rounded-xl pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "PPP", { locale: tr }) : <span>Tarih seçin</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Açıklama</FormLabel>
                    <FormControl><Input className="rounded-xl" placeholder="Örn: Ekim ayı fatura ödemesi" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-end pt-4 gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setIsDialogOpen(false)}>İptal</Button>
                  <Button type="submit" className="rounded-full" disabled={isSubmitting}>
                    {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        {isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground opacity-30 mb-4" />
            <p className="text-muted-foreground">Henüz hiç tahsilat kaydı bulunmuyor.</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-medium h-10">Tarih</TableHead>
                <TableHead className="font-medium h-10">Makbuz No</TableHead>
                <TableHead className="font-medium h-10">Firma</TableHead>
                <TableHead className="font-medium h-10">Tutar</TableHead>
                <TableHead className="font-medium h-10">Tip</TableHead>
                <TableHead className="font-medium h-10">Ekleyen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((rcpt, idx) => (
                <TableRow key={rcpt.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", idx === receipts.length - 1 && "border-0")}>
                  <TableCell className="py-3 text-muted-foreground">{format(new Date(rcpt.receiptDate), "dd.MM.yyyy")}</TableCell>
                  <TableCell className="py-3 font-medium">{rcpt.receiptNo}</TableCell>
                  <TableCell className="py-3 font-medium">{rcpt.cariFirmaName}</TableCell>
                  <TableCell className="py-3 font-semibold text-emerald-600">
                    {formatCurrency(rcpt.amount, rcpt.currency)}
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge variant="outline" className="rounded-full px-2.5 font-normal border-border bg-muted/50">
                      {TYPE_LABELS[rcpt.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {rcpt.createdBy}
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
