'use client';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getPayment, updatePayment, listCariFirmalar, listBankAccounts, listDepartments } from "@/lib/cari-odeme/firestore";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import type { CariFirma, Payment, PaymentStatus, BankAccount, Department } from "@/lib/cari-odeme/types";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

const Schema = z.object({
  requesterName: z.string().min(1, "Talep eden adı zorunludur."),
  department: z.string().optional(),
  cariFirmaId: z.string().min(1, "Lütfen bir firma seçin."),
  description: z.string().optional(),
  amount: z.coerce.number({ invalid_type_error: "Tutar bir sayı olmalıdır." }).positive("Tutar pozitif olmalıdır."),
  dueDate: z.date({ required_error: "Vade tarihi zorunludur." }),
  invoiceNo: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "rejected"]),
  bankName: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof Schema>;

const STATUS_TEXT: Record<PaymentStatus, string> = {
  pending: "Beklemede",
  approved: "Onaylandı",
  paid: "Ödendi",
  rejected: "Reddedildi",
};

export default function PaymentDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const canApprove = isSuperAdmin || !!currentUserProfile?.accessibleViews?.includes("cari-odeme-onay");

  const [payment, setPayment] = useState<Payment | null>(null);
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      requesterName: "",
      department: "",
      cariFirmaId: "",
      description: "",
      amount: undefined,
      invoiceNo: "",
      status: "pending",
      bankName: "",
    },
  });

  useEffect(() => {
    const scope = { companyId: currentCompanyId, isSuperAdmin };
    async function fetchData() {
      setIsPageLoading(true);
      try {
        const [paymentData, firmalarData, bankAccountsData, departmentsData] = await Promise.all([
          getPayment(id),
          listCariFirmalar(scope, { size: 1000 }),
          listBankAccounts(scope),
          listDepartments(scope),
        ]);

        if (paymentData) {
          setPayment(paymentData);
          setFirmalar(firmalarData.items);
          setBankAccounts(bankAccountsData);
          setDepartments(departmentsData);
          form.reset({
            requesterName: paymentData.requesterName,
            cariFirmaId: paymentData.cariFirmaId || "",
            amount: paymentData.amount,
            dueDate: new Date(paymentData.dueDate),
            status: paymentData.status,
            department: paymentData.department || "",
            description: paymentData.description || "",
            invoiceNo: paymentData.invoiceNo || "",
            bankName: paymentData.bankName || "",
          });
        } else {
          toast({ variant: "destructive", title: "Hata", description: "Ödeme bulunamadı." });
          router.push("/cari-odeme/odemeler");
        }
      } finally {
        setIsPageLoading(false);
      }
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
      await updatePayment(id, { ...values, companyName: selectedFirma.name });
      toast({ title: "Başarılı", description: "Ödeme talebi güncellendi." });
      router.push(`/cari-odeme/odemeler`);
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Ödeme talebi güncellenemedi." });
      setIsLoading(false);
    }
  };

  if (isPageLoading) return <PageSkeleton />;
  if (!payment) return null;

  return (
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme/odemeler" />
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Ödemeyi Düzenle</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle>Ödeme Detayları</CardTitle>
              <CardDescription>
                Oluşturulma {format(new Date(payment.createdAt), "PPP")} &bull; Son güncelleme {format(new Date(payment.updatedAt), "PPP")}
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{firmalar.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
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
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem className="flex flex-col pt-2">
                    <FormLabel>Vade Tarihi</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "PPP") : <span>Tarih seçin</span>}
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
                <FormField control={form.control} name="invoiceNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fatura No</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {/* Onay alanı — yalnızca onay yetkisi olanlar değiştirebilir */}
                {canApprove ? (
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durum</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Beklemede</SelectItem>
                          <SelectItem value="approved">Onaylandı</SelectItem>
                          <SelectItem value="paid">Ödendi</SelectItem>
                          <SelectItem value="rejected">Reddedildi</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : (
                  <FormItem>
                    <FormLabel>Durum</FormLabel>
                    <div className="pt-2"><Badge variant="outline">{STATUS_TEXT[payment.status]}</Badge></div>
                  </FormItem>
                )}
                {canApprove ? (
                  <FormField control={form.control} name="bankName" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Banka</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Banka atayın" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {bankAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.bankName}>{account.bankName} - {account.iban}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Banka</FormLabel>
                    <div className="pt-2 text-sm text-muted-foreground">{payment.bankName ?? "Atanmadı"}</div>
                  </FormItem>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row justify-start gap-2">
              <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">{isLoading ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</Button>
              <Button variant="ghost" asChild className="w-full sm:w-auto"><Link href="/cari-odeme/odemeler">İptal</Link></Button>
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
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-10 w-full" /></div>
            <div className="md:col-span-2 space-y-2"><Skeleton className="h-4 w-1/6" /><Skeleton className="h-10 w-full" /></div>
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
