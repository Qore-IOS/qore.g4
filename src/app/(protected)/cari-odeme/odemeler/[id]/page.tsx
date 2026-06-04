'use client';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getPayment, updatePayment, listCariFirmalar, listBankAccounts, listDepartments, updatePaymentStatus, listAuditEvents } from "@/lib/cari-odeme/firestore";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Clock, User, ArrowRight, ShieldCheck, History } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { useEffect, useState, useCallback } from "react";
import type { CariFirma, Payment, PaymentStatus, BankAccount, Department } from "@/lib/cari-odeme/types";
import type { AuditEvent } from "@/lib/cari-odeme/finance-types";
import { resolveFinanceRoles, getNextStates, getTransitionLabel, STATUS_LABELS, STATUS_COLORS } from "@/lib/cari-odeme/state-machine";
import type { FinanceRole } from "@/lib/cari-odeme/finance-types";
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
  const { currentCompanyId, isSuperAdmin, currentUserProfile, currentUser } = useAuth();
  const financeRoles: FinanceRole[] = resolveFinanceRoles(
    currentUserProfile?.accessibleViews,
    isSuperAdmin
  );
  const canApprove = financeRoles.includes("approver") || financeRoles.includes("finance_admin");

  const [payment, setPayment] = useState<Payment | null>(null);
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

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

  // Load audit events
  const fetchAuditEvents = useCallback(async () => {
    try {
      const scope = { companyId: currentCompanyId, isSuperAdmin };
      const events = await listAuditEvents(scope, id, "payment");
      setAuditEvents(events);
    } catch {
      // Audit events are non-critical; fail silently
    }
  }, [id, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    if (!isPageLoading && payment) fetchAuditEvents();
  }, [isPageLoading, payment, fetchAuditEvents]);

  // State-machine status transition handler
  const handleStatusTransition = async (newStatus: PaymentStatus) => {
    if (!payment) return;
    setIsTransitioning(true);
    try {
      const scope = { companyId: currentCompanyId, isSuperAdmin };
      const userId = currentUser?.uid ?? "unknown";
      const userName = currentUserProfile?.name ?? currentUser?.email ?? "Bilinmeyen";
      await updatePaymentStatus(
        scope,
        id,
        newStatus,
        financeRoles,
        userId,
        userName,
        {
          rejectionReason: newStatus === "rejected" ? rejectionReason : undefined,
        }
      );
      toast({ title: "Başarılı", description: `Ödeme durumu "${STATUS_LABELS[newStatus]}" olarak güncellendi.` });
      // Reload payment data
      const updated = await getPayment(id);
      if (updated) setPayment(updated);
      setRejectionReason("");
      fetchAuditEvents();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Hata", description: error?.message || "Durum güncellenemedi." });
    } finally {
      setIsTransitioning(false);
    }
  };

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
                {/* Status display with state-machine transitions */}
                <FormItem>
                  <FormLabel>Durum</FormLabel>
                  <div className="flex items-center gap-2 pt-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        payment.status === "pending" && "border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950",
                        payment.status === "approved" && "border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950",
                        payment.status === "paid" && "border-green-500 text-green-600 bg-green-50 dark:bg-green-950",
                        payment.status === "rejected" && "border-red-500 text-red-600 bg-red-50 dark:bg-red-950",
                      )}
                    >
                      {STATUS_LABELS[payment.status]}
                    </Badge>
                    {payment.approvedByName && payment.status !== "rejected" && (
                      <span className="text-xs text-muted-foreground">
                        Onaylayan: {payment.approvedByName}
                      </span>
                    )}
                    {payment.paidByName && (
                      <span className="text-xs text-muted-foreground">
                        Ödeyen: {payment.paidByName}
                      </span>
                    )}
                    {payment.rejectedByName && (
                      <span className="text-xs text-muted-foreground">
                        Reddeden: {payment.rejectedByName}
                      </span>
                    )}
                  </div>
                  {payment.rejectionReason && (
                    <p className="text-xs text-red-500 mt-1">Red gerekçesi: {payment.rejectionReason}</p>
                  )}
                </FormItem>
                {/* State-machine transition buttons */}
                {canApprove && getNextStates(payment.status, financeRoles).length > 0 && (
                  <div className="md:col-span-2">
                    <FormLabel>Durum Değiştir</FormLabel>
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {getNextStates(payment.status, financeRoles).map((targetStatus) => (
                        <Button
                          key={targetStatus}
                          type="button"
                          size="sm"
                          variant={targetStatus === "rejected" ? "destructive" : "default"}
                          disabled={isTransitioning}
                          onClick={() => handleStatusTransition(targetStatus)}
                          className="gap-1"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          {getTransitionLabel(payment.status, targetStatus)}
                        </Button>
                      ))}
                    </div>
                    {/* Rejection reason input — only show when rejected is an option */}
                    {getNextStates(payment.status, financeRoles).includes("rejected") && (
                      <div className="mt-2">
                        <Input
                          placeholder="Red gerekçesi (isteğe bağlı)"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          className="max-w-md"
                        />
                      </div>
                    )}
                  </div>
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

      {/* Audit Trail */}
      <AuditTrail events={auditEvents} />
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

/** Audit Trail Timeline — shows immutable history of all status changes. */
function AuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return null;

  const actionLabels: Record<string, string> = {
    payment_created: "Ödeme oluşturuldu",
    payment_status_changed: "Durum değiştirildi",
    payment_updated: "Ödeme güncellendi",
    payment_deleted: "Ödeme silindi",
    payment_bank_assigned: "Banka atandı",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          Denetim İzi
        </CardTitle>
        <CardDescription>Bu ödeme kaydına yapılan tüm değişikliklerin kronolojik geçmişi</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-0">
          {events.map((event, idx) => (
            <div key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Timeline line */}
              {idx < events.length - 1 && (
                <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
              )}
              {/* Timeline dot */}
              <div className="relative flex-shrink-0 mt-1">
                <div className={cn(
                  "h-[30px] w-[30px] rounded-full flex items-center justify-center text-white",
                  event.action === "payment_status_changed" && event.newValue?.status === "approved" && "bg-blue-500",
                  event.action === "payment_status_changed" && event.newValue?.status === "paid" && "bg-green-500",
                  event.action === "payment_status_changed" && event.newValue?.status === "rejected" && "bg-red-500",
                  event.action === "payment_status_changed" && event.newValue?.status === "pending" && "bg-yellow-500",
                  event.action === "payment_created" && "bg-blue-500",
                  !event.action.includes("status") && event.action !== "payment_created" && "bg-gray-400",
                )}>
                  {event.action === "payment_status_changed" ? (
                    <ArrowRight className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                </div>
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {actionLabels[event.action] ?? event.action}
                  </span>
                  {event.action === "payment_status_changed" && event.previousValue?.status && event.newValue?.status && (
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABELS[event.previousValue.status as PaymentStatus] ?? event.previousValue.status}
                      {" → "}
                      {STATUS_LABELS[event.newValue.status as PaymentStatus] ?? event.newValue.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {event.userName}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {event.timestamp instanceof Date
                      ? format(event.timestamp, "dd MMM yyyy HH:mm", { locale: tr })
                      : String(event.timestamp)}
                  </span>
                </div>
                {event.newValue?.rejectionReason && (
                  <p className="text-xs text-red-500 mt-1">Gerekçe: {event.newValue.rejectionReason}</p>
                )}
                {event.reason && (
                  <p className="text-xs text-muted-foreground mt-1">{event.reason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
