"use client";
import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

import { listCariFirmalar } from "@/lib/cari-odeme/firestore";
import { createInvoice } from "@/lib/cari-odeme/invoice-firestore";
import type { CariFirma } from "@/lib/cari-odeme/types";
import type { InvoiceType } from "@/lib/cari-odeme/invoice-types";

const lineSchema = z.object({
  description: z.string().min(1, "Açıklama zorunludur"),
  quantity: z.coerce.number().min(1, "Miktar en az 1 olmalıdır"),
  unitPrice: z.coerce.number().min(0, "Birim fiyat 0'dan küçük olamaz"),
  taxRate: z.coerce.number().min(0, "KDV oranı negatif olamaz"),
});

const schema = z.object({
  invoiceNo: z.string().min(1, "Fatura numarası zorunludur"),
  type: z.enum(["alis", "satis", "alis_iade", "satis_iade"]),
  cariFirmaId: z.string().min(1, "Firma seçimi zorunludur"),
  issueDate: z.date({ required_error: "Fatura tarihi zorunludur" }),
  dueDate: z.date({ required_error: "Vade tarihi zorunludur" }),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "En az bir kalem eklemelisiniz"),
});

type FormValues = z.infer<typeof schema>;

export default function YeniFaturaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile, currentUser } = useAuth();
  
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      invoiceNo: "",
      type: "alis",
      cariFirmaId: "",
      currency: "TRY",
      lines: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0.20 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  useEffect(() => {
    const fetchFirmalar = async () => {
      const data = await listCariFirmalar({ companyId: currentCompanyId, isSuperAdmin }, { size: 1000 });
      setFirmalar(data.items);
    };
    fetchFirmalar();
  }, [currentCompanyId, isSuperAdmin]);

  const watchLines = form.watch("lines");
  const subtotal = watchLines.reduce((acc, line) => acc + (line.quantity || 0) * (line.unitPrice || 0), 0);
  const taxTotal = watchLines.reduce((acc, line) => acc + ((line.quantity || 0) * (line.unitPrice || 0) * (line.taxRate || 0)), 0);
  const grandTotal = subtotal + taxTotal;

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const selectedFirma = firmalar.find((f) => f.id === values.cariFirmaId);
      if (!selectedFirma) throw new Error("Firma bulunamadı");

      const finalLines = values.lines.map((l, i) => {
        const lineTotalKdvHaric = l.quantity * l.unitPrice;
        const taxAmount = lineTotalKdvHaric * l.taxRate;
        return {
          ...l,
          lineNo: i + 1,
          taxAmount,
          lineTotal: lineTotalKdvHaric + taxAmount,
        };
      });

      const userId = currentUser?.uid ?? "unknown";
      const userName = currentUserProfile?.name ?? currentUser?.email ?? "Bilinmeyen";

      await createInvoice(
        { companyId: currentCompanyId, isSuperAdmin },
        {
          invoiceNo: values.invoiceNo,
          type: values.type as InvoiceType,
          status: "onaylandi", // Basitlik için doğrudan onaylandı kabul ediyoruz (Faz 1)
          cariFirmaId: selectedFirma.id,
          cariFirmaName: selectedFirma.name,
          issueDate: values.issueDate,
          dueDate: values.dueDate,
          currency: values.currency,
          subtotal,
          taxTotal,
          grandTotal,
          paidAmount: 0,
          remainingAmount: grandTotal,
          notes: values.notes,
          lines: finalLines,
        },
        userId,
        userName
      );

      toast({ title: "Başarılı", description: "Fatura başarıyla oluşturuldu." });
      router.push("/cari-odeme/faturalar");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Hata", description: error?.message || "Fatura oluşturulamadı." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full p-4 md:p-8">
      <div className="flex items-center gap-2 mb-4">
        <BackButton fallback="/cari-odeme/faturalar" className="border-border hover:bg-muted" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Yeni Fatura Oluştur</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          {/* Genel Bilgiler Section */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border/50 bg-muted/20">
              <h2 className="text-lg font-semibold">Genel Bilgiler</h2>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fatura Tipi</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="alis">Alış Faturası</SelectItem>
                      <SelectItem value="satis">Satış Faturası</SelectItem>
                      <SelectItem value="alis_iade">Alış İade</SelectItem>
                      <SelectItem value="satis_iade">Satış İade</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              
              <FormField control={form.control} name="invoiceNo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fatura No</FormLabel>
                  <FormControl><Input className="rounded-xl" placeholder="Örn: INV-2026-001" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="cariFirmaId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cari Firma</FormLabel>
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

              <FormField control={form.control} name="issueDate" render={({ field }) => (
                <FormItem className="flex flex-col pt-2">
                  <FormLabel>Fatura Tarihi</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("rounded-xl pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
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

              <FormField control={form.control} name="dueDate" render={({ field }) => (
                <FormItem className="flex flex-col pt-2">
                  <FormLabel>Vade Tarihi</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("rounded-xl pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
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
          </div>

          {/* Kalemler Section */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border/50 flex flex-row justify-between items-center bg-muted/20">
              <h2 className="text-lg font-semibold">Fatura Kalemleri</h2>
              <Button type="button" variant="outline" size="sm" className="rounded-full h-8" onClick={() => append({ description: "", quantity: 1, unitPrice: 0, taxRate: 0.20 })}>
                <Plus className="h-4 w-4 mr-1" />
                Kalem Ekle
              </Button>
            </div>
            
            <div className="p-6 space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col md:flex-row gap-4 items-start bg-muted/30 border border-border/50 p-4 rounded-xl relative group transition-colors hover:bg-muted/50">
                  <div className="flex-1 space-y-4 w-full">
                    <FormField control={form.control} name={`lines.${index}.description`} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Açıklama</FormLabel>
                        <FormControl><Input className="bg-card rounded-xl" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <FormField control={form.control} name={`lines.${index}.quantity`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>Miktar</FormLabel>
                          <FormControl><Input className="bg-card rounded-xl" type="number" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`lines.${index}.unitPrice`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>Birim Fiyat</FormLabel>
                          <FormControl><Input className="bg-card rounded-xl" type="number" step="0.01" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`lines.${index}.taxRate`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>KDV Oranı</FormLabel>
                          <Select onValueChange={(val) => field.onChange(parseFloat(val))} defaultValue={field.value.toString()}>
                            <FormControl><SelectTrigger className="bg-card rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="0">0%</SelectItem>
                              <SelectItem value="0.01">1%</SelectItem>
                              <SelectItem value="0.10">10%</SelectItem>
                              <SelectItem value="0.20">20%</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  {fields.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="md:mt-8 rounded-full text-destructive hover:bg-destructive/10" onClick={() => remove(index)}>
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              ))}
              {form.formState.errors.lines?.root && (
                <p className="text-sm font-medium text-destructive">{form.formState.errors.lines.root.message}</p>
              )}
            </div>

            {/* Totals Footer */}
            <div className="p-6 flex flex-col items-end border-t border-border bg-muted/10 gap-2 text-sm">
              <div className="flex justify-between w-full md:w-64">
                <span className="text-muted-foreground">Ara Toplam:</span>
                <span>{subtotal.toLocaleString("tr-TR", { style: "currency", currency: form.watch("currency") })}</span>
              </div>
              <div className="flex justify-between w-full md:w-64">
                <span className="text-muted-foreground">KDV Toplamı:</span>
                <span>{taxTotal.toLocaleString("tr-TR", { style: "currency", currency: form.watch("currency") })}</span>
              </div>
              <div className="flex justify-between w-full md:w-64 font-bold text-lg border-t border-border/50 pt-3 mt-1">
                <span>Genel Toplam:</span>
                <span className="text-primary">{grandTotal.toLocaleString("tr-TR", { style: "currency", currency: form.watch("currency") })}</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notlar</FormLabel>
                <FormControl><Input className="rounded-xl" placeholder="Fatura ile ilgili ek notlar..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <div className="flex justify-end gap-3 pb-8">
            <Button type="button" variant="outline" className="rounded-full px-6 border-border" asChild>
              <Link href="/cari-odeme/faturalar">İptal</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-full px-6">
              {isSubmitting ? "Kaydediliyor..." : "Faturayı Kaydet"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
