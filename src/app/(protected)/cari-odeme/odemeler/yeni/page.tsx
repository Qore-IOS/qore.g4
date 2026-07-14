'use client';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPayment, listCariFirmalar, listDepartments } from "@/lib/cari-odeme/firestore";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addDays } from "date-fns";
import { useEffect, useState } from "react";
import type { CariFirma, Department } from "@/lib/cari-odeme/types";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

const Schema = z.object({
  requesterName: z.string().min(1, "Talep eden adı zorunludur."),
  department: z.string().min(1, "Lütfen bir departman seçin."),
  cariFirmaId: z.string().min(1, "Lütfen bir firma seçin."),
  description: z.string().optional(),
  amount: z.coerce.number({ invalid_type_error: "Tutar bir sayı olmalıdır." }).positive("Tutar pozitif olmalıdır."),
  dueDate: z.date({ required_error: "Vade tarihi zorunludur." }),
  invoiceNo: z.string().optional(),
});

type FormValues = z.infer<typeof Schema>;

export default function NewPaymentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const scope = { companyId: currentCompanyId, isSuperAdmin };
    listCariFirmalar(scope, { size: 1000 }).then(({ items }) => setFirmalar(items)).catch(console.error);
    listDepartments(scope).then(setDepartments).catch(console.error);
  }, [currentCompanyId, isSuperAdmin]);

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      requesterName: currentUserProfile?.name || "",
      department: "",
      cariFirmaId: "",
      description: "",
      invoiceNo: "",
      amount: "" as any,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);
    if (!currentUser) {
      toast({ variant: "destructive", title: "Hata", description: "Ödeme oluşturmak için giriş yapmalısınız." });
      setIsLoading(false);
      return;
    }
    const selectedFirma = firmalar.find((c) => c.id === values.cariFirmaId);
    if (!selectedFirma) {
      toast({ variant: "destructive", title: "Hata", description: "Seçilen firma bulunamadı." });
      setIsLoading(false);
      return;
    }
    try {
      await createPayment(
        { companyId: currentCompanyId, isSuperAdmin },
        {
          requesterName: values.requesterName,
          department: values.department,
          cariFirmaId: values.cariFirmaId,
          description: values.description,
          amount: values.amount,
          dueDate: values.dueDate,
          invoiceNo: values.invoiceNo,
          requesterId: currentUser.uid,
          companyName: selectedFirma.name,
          currency: "TRY",
          status: "pending",
          bankName: null,
        }
      );
      toast({ title: "Başarılı", description: "Ödeme talebi oluşturuldu." });
      router.push(`/cari-odeme/odemeler`);
    } catch (error) {
      console.error("Ödeme oluşturma hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: "Ödeme talebi oluşturulamadı." });
      setIsLoading(false);
    }
  };

  const handleDueDateChange = (days: string) => {
    const numberOfDays = parseInt(days, 10);
    if (!isNaN(numberOfDays)) form.setValue("dueDate", addDays(new Date(), numberOfDays));
  };

  return (
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme/odemeler" />
      <h1 className="text-3xl font-bold">Yeni Ödeme Talebi</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="requesterName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Talep Eden</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="department" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departman</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Bir departman seçin" /></SelectTrigger></FormControl>
                      <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="cariFirmaId" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Firma</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Bir firma seçin" /></SelectTrigger></FormControl>
                      <SelectContent>{firmalar.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Açıklama</FormLabel>
                    <FormControl><Input placeholder="Ödeme nedeni" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tutar (TRY)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="100.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vade</FormLabel>
                    <Select onValueChange={handleDueDateChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Vade süresi seçin" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="30">30 Gün</SelectItem>
                        <SelectItem value="60">60 Gün</SelectItem>
                        <SelectItem value="90">90 Gün</SelectItem>
                        <SelectItem value="120">120 Gün</SelectItem>
                      </SelectContent>
                    </Select>
                    {field.value && <FormDescription>Ödeme tarihi: {format(field.value, "PPP")}</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="invoiceNo" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Fatura No (İsteğe Bağlı)</FormLabel>
                    <FormControl><Input placeholder="INV-2024-001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-2">
              <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">{isLoading ? "Kaydediliyor..." : "Ödemeyi Kaydet"}</Button>
              <Button variant="ghost" asChild className="w-full sm:w-auto"><Link href="/cari-odeme/odemeler">İptal</Link></Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
