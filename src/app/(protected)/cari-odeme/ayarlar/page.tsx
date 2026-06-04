'use client';
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Pencil, Check, X, History, PlusCircle } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  listBankAccounts,
  createBankAccount,
  deleteBankAccount,
  createDepartment,
  listDepartments,
  deleteDepartment,
  updateDepartment,
  listBudgetHistory,
} from "@/lib/cari-odeme/firestore";
import type { BankAccount, Department, BudgetHistory } from "@/lib/cari-odeme/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

type Currency = "USD" | "EUR" | "GBP";
type Rates = { [key in Currency]?: number };

const BankAccountSchema = z.object({
  bankName: z.string().min(1, "Banka adı zorunludur."),
  iban: z.string().min(1, "IBAN zorunludur."),
  accountNumber: z.string().optional(),
  branch: z.string().optional(),
});
type BankAccountFormValues = z.infer<typeof BankAccountSchema>;

const DepartmentSchema = z.object({
  name: z.string().min(1, "Departman adı zorunludur."),
  budget: z.coerce.number().min(0, "Bütçe 0'dan büyük olmalıdır."),
});
type DepartmentFormValues = z.infer<typeof DepartmentSchema>;

const BudgetUpdateSchema = z.object({
  increaseAmount: z.coerce.number().positive("Artış miktarı pozitif olmalıdır."),
});
type BudgetUpdateFormValues = z.infer<typeof BudgetUpdateSchema>;

export default function SettingsPage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const scope = { companyId: currentCompanyId, isSuperAdmin };

  const [currencyMode, setCurrencyMode] = useState<"fixed" | "live">("live");
  const [fixedRates, setFixedRates] = useState<Rates>({ USD: 32.5, EUR: 35.2, GBP: 41.1 });
  const [liveRates, setLiveRates] = useState<Rates>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isBankLoading, setBankLoading] = useState(false);
  const [isDepartmentLoading, setDepartmentLoading] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const { toast } = useToast();

  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<{ name: string; budget: number } | null>(null);

  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedDeptForHistory, setSelectedDeptForHistory] = useState<string>("");
  const [budgetHistory, setBudgetHistory] = useState<BudgetHistory[]>([]);
  const [isHistoryLoading, setHistoryLoading] = useState(false);

  const [isBudgetUpdateModalOpen, setBudgetUpdateModalOpen] = useState(false);
  const [selectedDepartmentForUpdate, setSelectedDepartmentForUpdate] = useState<Department | null>(null);

  const bankForm = useForm<BankAccountFormValues>({
    resolver: zodResolver(BankAccountSchema),
    defaultValues: { bankName: "", iban: "", accountNumber: "", branch: "" },
  });
  const departmentForm = useForm<DepartmentFormValues>({
    resolver: zodResolver(DepartmentSchema),
    defaultValues: { name: "", budget: 0 },
  });
  const budgetUpdateForm = useForm<BudgetUpdateFormValues>({
    resolver: zodResolver(BudgetUpdateSchema),
    defaultValues: { increaseAmount: 0 },
  });

  useEffect(() => {
    fetchBankAccounts();
    fetchDepartments();
    if (currencyMode === "live") fetchLiveRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyMode, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    if (selectedDeptForHistory) {
      setHistoryLoading(true);
      listBudgetHistory(selectedDeptForHistory).then((history) => {
        setBudgetHistory(history);
        setHistoryLoading(false);
      });
    } else {
      setBudgetHistory([]);
    }
  }, [selectedDeptForHistory]);

  const fetchBankAccounts = async () => {
    setBankLoading(true);
    try {
      setBankAccounts(await listBankAccounts(scope));
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Banka hesapları alınamadı." });
    }
    setBankLoading(false);
  };

  const fetchDepartments = async () => {
    setDepartmentLoading(true);
    try {
      setDepartments(await listDepartments(scope));
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Departmanlar listelenemedi." });
    }
    setDepartmentLoading(false);
  };

  const fetchLiveRates = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("https://api.frankfurter.app/latest?from=TRY&to=USD,EUR,GBP");
      if (!response.ok) throw new Error("Döviz kurları alınamadı.");
      const data = await response.json();
      setLiveRates({ USD: 1 / data.rates.USD, EUR: 1 / data.rates.EUR, GBP: 1 / data.rates.GBP });
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Canlı döviz kurları alınırken bir sorun oluştu." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFixedRateChange = (currency: Currency, value: string) => {
    const rate = parseFloat(value);
    setFixedRates((prev) => ({ ...prev, [currency]: isNaN(rate) ? undefined : rate }));
  };

  const handleSaveSettings = () => {
    toast({ title: "Ayarlar Kaydedildi", description: `Döviz kuru modu "${currencyMode === "fixed" ? "Sabit Kur" : "Canlı Kur"}" olarak ayarlandı.` });
  };

  const onBankSubmit = async (values: BankAccountFormValues) => {
    setBankLoading(true);
    try {
      await createBankAccount(scope, values as Parameters<typeof createBankAccount>[1]);
      toast({ title: "Başarılı", description: "Banka hesabı eklendi." });
      bankForm.reset();
      await fetchBankAccounts();
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Banka hesabı eklenemedi." });
    }
    setBankLoading(false);
  };

  const onDepartmentSubmit = async (values: DepartmentFormValues) => {
    setDepartmentLoading(true);
    try {
      await createDepartment(scope, values as Parameters<typeof createDepartment>[1]);
      toast({ title: "Başarılı", description: "Departman oluşturuldu." });
      departmentForm.reset();
      await fetchDepartments();
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Departman oluşturulamadı." });
    }
    setDepartmentLoading(false);
  };

  const handleDeleteBankAccount = async (id: string) => {
    if (confirm("Bu banka hesabını silmek istediğinizden emin misiniz?")) {
      setBankLoading(true);
      try {
        await deleteBankAccount(id);
        toast({ title: "Başarılı", description: "Banka hesabı silindi." });
        await fetchBankAccounts();
      } catch (error) {
        toast({ variant: "destructive", title: "Hata", description: "Banka hesabı silinemedi." });
      }
      setBankLoading(false);
    }
  };

  const handleDeleteDepartment = async (id: string) => {
    if (confirm("Bu departmanı silmek istediğinizden emin misiniz?")) {
      setDepartmentLoading(true);
      try {
        await deleteDepartment(id);
        toast({ title: "Başarılı", description: "Departman silindi." });
        await fetchDepartments();
      } catch (error) {
        toast({ variant: "destructive", title: "Hata", description: "Departman silinemedi." });
      }
      setDepartmentLoading(false);
    }
  };

  const handleEditDepartment = (dep: Department) => {
    setEditingDepartmentId(dep.id);
    setEditingData({ name: dep.name, budget: dep.budget });
  };

  const handleCancelEdit = () => {
    setEditingDepartmentId(null);
    setEditingData(null);
  };

  const handleSaveDepartment = async () => {
    if (!editingDepartmentId || !editingData) return;
    setDepartmentLoading(true);
    try {
      await updateDepartment(scope, editingDepartmentId, editingData);
      toast({ title: "Başarılı", description: "Departman güncellendi." });
      await fetchDepartments();
      handleCancelEdit();
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Departman güncellenemedi." });
    } finally {
      setDepartmentLoading(false);
    }
  };

  const handleEditingDataChange = (field: "name" | "budget", value: string) => {
    if (!editingData) return;
    setEditingData(field === "budget" ? { ...editingData, budget: Number(value) } : { ...editingData, name: value });
  };

  const openBudgetUpdateModal = (department: Department) => {
    setSelectedDepartmentForUpdate(department);
    budgetUpdateForm.reset();
    setBudgetUpdateModalOpen(true);
  };

  const onBudgetUpdateSubmit = async (values: BudgetUpdateFormValues) => {
    if (!selectedDepartmentForUpdate) return;
    setDepartmentLoading(true);
    try {
      const newBudget = selectedDepartmentForUpdate.budget + values.increaseAmount;
      await updateDepartment(scope, selectedDepartmentForUpdate.id, { budget: newBudget });
      toast({ title: "Başarılı", description: `${selectedDepartmentForUpdate.name} departmanının bütçesi güncellendi.` });
      await fetchDepartments();
      setBudgetUpdateModalOpen(false);
      setSelectedDepartmentForUpdate(null);
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Bütçe güncellenemedi." });
    } finally {
      setDepartmentLoading(false);
    }
  };

  const formatTRY = (n: number) => n.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 py-4">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <BackButton fallback="/cari-odeme" className="border-border hover:bg-muted" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ayarlar</h1>
        </div>
      </div>

      <Accordion type="single" collapsible className="w-full space-y-4" defaultValue="item-1">
        <AccordionItem value="item-1" className="border border-border bg-card rounded-xl px-4 py-2 shadow-sm">
          <AccordionTrigger className="text-lg font-medium hover:no-underline">Döviz Kuru Ayarları</AccordionTrigger>
          <AccordionContent className="pt-4 pb-2">
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <p className="text-sm text-muted-foreground">Sistem genelinde kullanılacak döviz kurunu belirleyin.</p>
                <div className="flex items-center gap-1 bg-muted p-1 rounded-full border border-border">
                  <button
                    onClick={() => setCurrencyMode("fixed")}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                      currencyMode === "fixed" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Sabit Kur
                  </button>
                  <button
                    onClick={() => setCurrencyMode("live")}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                      currencyMode === "live" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Canlı Kur (API)
                  </button>
                </div>
              </div>

              {currencyMode === "fixed" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-muted/30 p-4 rounded-xl border border-border space-y-2">
                    <Label htmlFor="usd-fixed" className="text-muted-foreground text-xs uppercase tracking-wider">USD / TRY</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">₺</span>
                      <Input id="usd-fixed" type="number" className="pl-7 bg-background border-border rounded-lg shadow-none" placeholder="32.50" value={fixedRates.USD || ""} onChange={(e) => handleFixedRateChange("USD", e.target.value)} />
                    </div>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-xl border border-border space-y-2">
                    <Label htmlFor="eur-fixed" className="text-muted-foreground text-xs uppercase tracking-wider">EUR / TRY</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">₺</span>
                      <Input id="eur-fixed" type="number" className="pl-7 bg-background border-border rounded-lg shadow-none" placeholder="35.20" value={fixedRates.EUR || ""} onChange={(e) => handleFixedRateChange("EUR", e.target.value)} />
                    </div>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-xl border border-border space-y-2">
                    <Label htmlFor="gbp-fixed" className="text-muted-foreground text-xs uppercase tracking-wider">GBP / TRY</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">₺</span>
                      <Input id="gbp-fixed" type="number" className="pl-7 bg-background border-border rounded-lg shadow-none" placeholder="41.10" value={fixedRates.GBP || ""} onChange={(e) => handleFixedRateChange("GBP", e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
              {currencyMode === "live" && (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={fetchLiveRates} disabled={isLoading} className="rounded-full shadow-none border-border">
                      {isLoading ? "Yenileniyor..." : "Güncel Kurları Çek"}
                    </Button>
                  </div>
                  {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /></div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="flex flex-col justify-center items-center p-6 bg-muted/30 rounded-xl border border-border">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">USD / TRY</p>
                        <p className="text-2xl font-bold text-foreground">₺{liveRates.USD?.toFixed(4) || "..."}</p>
                      </div>
                      <div className="flex flex-col justify-center items-center p-6 bg-muted/30 rounded-xl border border-border">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">EUR / TRY</p>
                        <p className="text-2xl font-bold text-foreground">₺{liveRates.EUR?.toFixed(4) || "..."}</p>
                      </div>
                      <div className="flex flex-col justify-center items-center p-6 bg-muted/30 rounded-xl border border-border">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">GBP / TRY</p>
                        <p className="text-2xl font-bold text-foreground">₺{liveRates.GBP?.toFixed(4) || "..."}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveSettings} className="rounded-full px-8">Kaydet</Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-2" className="border border-border bg-card rounded-xl px-4 py-2 shadow-sm">
          <AccordionTrigger className="text-lg font-medium hover:no-underline">Ödeme Yapan Banka Hesapları</AccordionTrigger>
          <AccordionContent className="pt-4 pb-2">
            <div className="space-y-6">
              <Form {...bankForm}>
                <form onSubmit={bankForm.handleSubmit(onBankSubmit)} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end p-4 bg-muted/30 rounded-xl border border-border">
                  <FormField control={bankForm.control} name="bankName" render={({ field }) => (<FormItem><FormLabel className="text-xs">Banka Adı</FormLabel><FormControl><Input {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="iban" render={({ field }) => (<FormItem><FormLabel className="text-xs">IBAN</FormLabel><FormControl><Input {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="accountNumber" render={({ field }) => (<FormItem><FormLabel className="text-xs">Hesap No</FormLabel><FormControl><Input {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="branch" render={({ field }) => (<FormItem><FormLabel className="text-xs">Şube</FormLabel><FormControl><Input {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <Button type="submit" disabled={isBankLoading} className="rounded-full">{isBankLoading ? "Ekleniyor..." : "Hesap Ekle"}</Button>
                </form>
              </Form>
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="font-medium h-10">Banka Adı</TableHead><TableHead className="font-medium h-10">IBAN</TableHead><TableHead className="font-medium h-10">Hesap No</TableHead><TableHead className="font-medium h-10">Şube</TableHead><TableHead className="h-10 text-right"><span className="sr-only">İşlemler</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isBankLoading ? (
                      <TableRow><TableCell colSpan={5}><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                    ) : bankAccounts.length > 0 ? (
                      bankAccounts.map((account, idx) => (
                        <TableRow key={account.id} className={cn("border-border/50 hover:bg-muted/30", idx === bankAccounts.length - 1 && "border-0")}>
                          <TableCell className="py-3 font-medium">{account.bankName}</TableCell>
                          <TableCell className="py-3 font-mono text-muted-foreground">{account.iban}</TableCell>
                          <TableCell className="py-3 text-muted-foreground">{account.accountNumber || "—"}</TableCell>
                          <TableCell className="py-3 text-muted-foreground">{account.branch || "—"}</TableCell>
                          <TableCell className="py-3 text-right">
                            <button onClick={() => handleDeleteBankAccount(account.id)} disabled={isBankLoading} className="text-sm font-medium text-destructive hover:underline">Sil</button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground border-0">Henüz banka hesabı eklenmemiş.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3" className="border border-border bg-card rounded-xl px-4 py-2 shadow-sm">
          <AccordionTrigger className="text-lg font-medium hover:no-underline">Departmanlar & Bütçeler</AccordionTrigger>
          <AccordionContent className="pt-4 pb-2">
            <div className="space-y-6">
              <div className="flex justify-end">
                <Dialog open={isHistoryModalOpen} onOpenChange={setHistoryModalOpen}>
                  <DialogTrigger asChild><Button variant="outline" className="rounded-full shadow-none border-border"><History className="mr-2 h-4 w-4" />Bütçe Geçmişi</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl bg-card border-border">
                    <DialogHeader>
                      <DialogTitle>Departman Bütçe Geçmişi</DialogTitle>
                      <DialogDescription>Bir departman seçerek geçmiş bütçe değişikliklerini görüntüleyin.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-2">
                      <Select onValueChange={setSelectedDeptForHistory}>
                        <SelectTrigger className="border-border bg-background"><SelectValue placeholder="Bir departman seçin..." /></SelectTrigger>
                        <SelectContent className="bg-card border-border">{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="max-h-96 overflow-y-auto border border-border rounded-xl">
                        <Table>
                          <TableHeader className="bg-muted/50"><TableRow className="border-border"><TableHead>Tarih</TableHead><TableHead>Eski Bütçe</TableHead><TableHead>Yeni Bütçe</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {isHistoryLoading ? (
                              <TableRow className="border-0"><TableCell colSpan={3} className="text-center p-4"><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                            ) : budgetHistory.length > 0 ? (
                              budgetHistory.map((h, i) => (
                                <TableRow key={h.id} className={cn("border-border/50", i === budgetHistory.length - 1 && "border-0")}>
                                  <TableCell className="text-muted-foreground text-sm">{new Date(h.changedAt).toLocaleString("tr-TR")}</TableCell>
                                  <TableCell className="font-semibold text-muted-foreground line-through">{formatTRY(h.oldBudget)}</TableCell>
                                  <TableCell className="font-semibold text-primary">{formatTRY(h.newBudget)}</TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow><TableCell colSpan={3} className="text-center p-8 text-muted-foreground border-0">Seçilen departman için geçmiş bulunamadı.</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <Form {...departmentForm}>
                <form onSubmit={departmentForm.handleSubmit(onDepartmentSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end p-4 bg-muted/30 rounded-xl border border-border">
                  <FormField control={departmentForm.control} name="name" render={({ field }) => (<FormItem><FormLabel className="text-xs">Departman Adı</FormLabel><FormControl><Input {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={departmentForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel className="text-xs">Aylık Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} className="bg-background border-border" /></FormControl><FormMessage /></FormItem>)} />
                  <Button type="submit" disabled={isDepartmentLoading} className="rounded-full">{isDepartmentLoading ? "Ekleniyor..." : "Departman Ekle"}</Button>
                </form>
              </Form>

              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="border-border hover:bg-transparent"><TableHead className="font-medium h-10">Departman Adı</TableHead><TableHead className="font-medium h-10">Bütçe</TableHead><TableHead className="text-right h-10">İşlemler</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {isDepartmentLoading ? (
                      <TableRow><TableCell colSpan={3}><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                    ) : departments.length > 0 ? (
                      departments.map((dep, idx) => (
                        <TableRow key={dep.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", idx === departments.length - 1 && "border-0")}>
                          <TableCell className="py-3">
                            {editingDepartmentId === dep.id ? <Input value={editingData?.name ?? ""} onChange={(e) => handleEditingDataChange("name", e.target.value)} className="h-8 border-border" /> : <span className="font-medium">{dep.name}</span>}
                          </TableCell>
                          <TableCell className="py-3">
                            {editingDepartmentId === dep.id ? <Input type="number" value={editingData?.budget ?? 0} onChange={(e) => handleEditingDataChange("budget", e.target.value)} className="h-8 border-border" /> : <span className="font-semibold text-muted-foreground">{formatTRY(dep.budget)}</span>}
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            {editingDepartmentId === dep.id ? (
                              <div className="flex gap-4 justify-end">
                                <button onClick={handleSaveDepartment} className="text-sm font-medium text-primary hover:underline">Kaydet</button>
                                <button onClick={handleCancelEdit} className="text-sm font-medium text-muted-foreground hover:underline">Vazgeç</button>
                              </div>
                            ) : (
                              <div className="flex gap-4 justify-end">
                                <button onClick={() => openBudgetUpdateModal(dep)} disabled={isDepartmentLoading} className="text-sm font-medium text-primary hover:underline">Bütçe Artır</button>
                                <button onClick={() => handleEditDepartment(dep)} disabled={isDepartmentLoading} className="text-sm font-medium text-primary hover:underline">Düzenle</button>
                                <button onClick={() => handleDeleteDepartment(dep.id)} disabled={isDepartmentLoading} className="text-sm font-medium text-destructive hover:underline">Sil</button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground border-0">Hiç departman bulunamadı.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog open={isBudgetUpdateModalOpen} onOpenChange={setBudgetUpdateModalOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-medium text-lg">{selectedDepartmentForUpdate?.name} - Bütçe Artır</DialogTitle>
            <DialogDescription>Mevcut bütçe: {formatTRY(selectedDepartmentForUpdate?.budget || 0)}</DialogDescription>
          </DialogHeader>
          <Form {...budgetUpdateForm}>
            <form onSubmit={budgetUpdateForm.handleSubmit(onBudgetUpdateSubmit)} className="space-y-4 mt-2">
              <FormField control={budgetUpdateForm.control} name="increaseAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Artış Miktarı (TRY)</FormLabel>
                  <FormControl><Input type="number" placeholder="5000" {...field} className="bg-transparent border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setBudgetUpdateModalOpen(false)} className="rounded-full border-border">Vazgeç</Button>
                <Button type="submit" disabled={isDepartmentLoading} className="rounded-full">{isDepartmentLoading ? "Güncelleniyor..." : "Uygula"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
