'use client';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getPaymentTemplate, updatePaymentTemplate, listCariFirmalar } from "@/lib/cari-odeme/firestore";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import type { CariFirma, PaymentTemplate } from "@/lib/cari-odeme/types";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const Schema = z.object({
  templateName: z.string().min(1, "Talimat adı zorunludur."),
  cariFirmaId: z.string().min(1, "Lütfen bir firma seçin."),
  description: z.string().optional(),
  amount: z.coerce.number({ invalid_type_error: "Tutar bir sayı olmalıdır." }).positive("Tutar pozitif olmalıdır."),
  invoiceNo: z.string().optional(),
  department: z.string().optional(),
  reminderPeriod: z.enum(["monthly", "weekly", "none"]).default("none"),
  reminderDayOfMonth: z.coerce.number().optional(),
  reminderDayOfWeek: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof Schema>;

export default function EditPaymentTemplatePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [template, setTemplate] = useState<PaymentTemplate | null>(null);
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

  const form = useForm<FormValues>({ resolver: zodResolver(Schema) });

  const reminderPeriod = form.watch("reminderPeriod");

  useEffect(() => {
    async function fetchData() {
      setIsPageLoading(true);
      const [templateData, firmalarData] = await Promise.all([
        getPaymentTemplate(id),
        listCariFirmalar({ companyId: currentCompanyId, isSuperAdmin }, { size: 1000 }),
      ]);

      if (templateData) {
        setTemplate(templateData);
        setFirmalar(firmalarData.items);
        form.reset({
          ...templateData,
          description: templateData.description || "",
          invoiceNo: templateData.invoiceNo || "",
          department: templateData.department || "",
          reminderPeriod: templateData.reminderPeriod || "none",
        });
      } else {
        toast({ variant: "destructive", title: "Hata", description: "Ödeme talimatı bulunamadı." });
        router.push("/cari-odeme/sablonlar");
      }
      setIsPageLoading(false);
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentCompanyId, isSuperAdmin]);

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);
    const selectedFirma = firmalar.find((c) => c.id === values.cariFirmaId);
    if (!selectedFirma) {
      toast({ variant: "destructive", title: "Hata", description: "Seçilen firma bulunamadı." });
      setIsLoading(false);
      return;
    }
    try {
      await updatePaymentTemplate(id, {
        ...values,
        companyName: selectedFirma.name,
        reminderDayOfMonth: values.reminderPeriod === "monthly" ? values.reminderDayOfMonth : undefined,
        reminderDayOfWeek: values.reminderPeriod === "weekly" ? values.reminderDayOfWeek : undefined,
      });
      toast({ title: "Başarılı", description: "Ödeme talimatı güncellendi." });
      router.push(`/cari-odeme/sablonlar`);
    } catch (error) {
      console.error("Talimat güncelleme hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: "Ödeme talimatı güncellenemedi." });
      setIsLoading(false);
    }
  };

  if (isPageLoading) return <PageSkeleton />;
  if (!template) return null;

  return (
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme/sablonlar" />
      <h1 className="text-3xl font-bold">Talimatı Düzenle</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{template.templateName}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="templateName" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Talimat Adı</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="cariFirmaId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Firma</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{firmalar.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="department" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departman</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Açıklama</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tutar (TRY)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="invoiceNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fatura No (İsteğe Bağlı)</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Hatırlatma Ayarları</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                <FormField control={form.control} name="reminderPeriod" render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Hatırlatma Periyodu</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1">
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="none" /></FormControl>
                          <FormLabel className="font-normal">Yok</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="monthly" /></FormControl>
                          <FormLabel className="font-normal">Aylık</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="weekly" /></FormControl>
                          <FormLabel className="font-normal">Haftalık</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {reminderPeriod === "monthly" && (
                  <FormField control={form.control} name="reminderDayOfMonth" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ayın Günü</FormLabel>
                      <Select onValueChange={(val) => field.onChange(parseInt(val))} defaultValue={field.value?.toString()}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Ayın bir gününü seçin" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={day.toString()}>{day}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                {reminderPeriod === "weekly" && (
                  <FormField control={form.control} name="reminderDayOfWeek" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Haftanın Günü</FormLabel>
                      <Select onValueChange={(val) => field.onChange(parseInt(val))} defaultValue={field.value?.toString()}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Haftanın bir gününü seçin" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="1">Pazartesi</SelectItem>
                          <SelectItem value="2">Salı</SelectItem>
                          <SelectItem value="3">Çarşamba</SelectItem>
                          <SelectItem value="4">Perşembe</SelectItem>
                          <SelectItem value="5">Cuma</SelectItem>
                          <SelectItem value="6">Cumartesi</SelectItem>
                          <SelectItem value="0">Pazar</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-2">
              <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">{isLoading ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</Button>
              <Button variant="ghost" asChild className="w-full sm:w-auto"><Link href="/cari-odeme/sablonlar">İptal</Link></Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <Skeleton className="h-10 w-48" />
      <Card>
        <CardHeader><Skeleton className="h-8 w-1/3" /></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2 space-y-2"><Skeleton className="h-4 w-1/6" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
            <div className="md:col-span-2 space-y-2"><Skeleton className="h-4 w-1/6" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
          </div>
        </CardContent>
        <CardFooter><Skeleton className="h-10 w-28" /></CardFooter>
      </Card>
    </div>
  );
}
