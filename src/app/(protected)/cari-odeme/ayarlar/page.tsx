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
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme" />
      <h1 className="text-3xl font-bold">Cari Ödeme · Ayarlar</h1>
      <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger className="text-xl">Döviz Kuru Ayarları</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-6 pt-4">
              <p className="text-muted-foreground">Uygulamada kullanılacak döviz kuru türünü seçin.</p>
              <RadioGroup value={currencyMode} onValueChange={(value: "fixed" | "live") => setCurrencyMode(value)}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="fixed" id="r-fixed" /><Label htmlFor="r-fixed">Sabit Kur</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="live" id="r-live" /><Label htmlFor="r-live">Canlı Kur (API)</Label></div>
              </RadioGroup>
              {currencyMode === "fixed" && (
                <Card className="bg-muted/40">
                  <CardHeader><CardTitle className="text-lg">Sabit Kurları Tanımla</CardTitle><CardDescription>Türk Lirası'nın (TRY) yabancı para birimleri karşısındaki değerini girin.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div><Label htmlFor="usd-fixed">1 Amerikan Doları (USD)</Label><Input id="usd-fixed" type="number" placeholder="örn. 32.50" value={fixedRates.USD || ""} onChange={(e) => handleFixedRateChange("USD", e.target.value)} /></div>
                      <div><Label htmlFor="eur-fixed">1 Euro (EUR)</Label><Input id="eur-fixed" type="number" placeholder="örn. 35.20" value={fixedRates.EUR || ""} onChange={(e) => handleFixedRateChange("EUR", e.target.value)} /></div>
                      <div><Label htmlFor="gbp-fixed">1 İngiliz Sterlini (GBP)</Label><Input id="gbp-fixed" type="number" placeholder="örn. 41.10" value={fixedRates.GBP || ""} onChange={(e) => handleFixedRateChange("GBP", e.target.value)} /></div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {currencyMode === "live" && (
                <Card className="bg-muted/40">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div><CardTitle className="text-lg">Canlı Kurlar (Frankfurter.app)</CardTitle><CardDescription>Anlık olarak güncellenen Türk Lirası (TRY) karşılıkları.</CardDescription></div>
                    <Button variant="outline" size="sm" onClick={fetchLiveRates} disabled={isLoading}>{isLoading ? "Yenileniyor..." : "Yenile"}</Button>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-4 bg-background rounded-lg"><p className="text-sm text-muted-foreground">Amerikan Doları (USD)</p><p className="text-2xl font-bold">₺{liveRates.USD?.toFixed(4) || "..."}</p></div>
                        <div className="p-4 bg-background rounded-lg"><p className="text-sm text-muted-foreground">Euro (EUR)</p><p className="text-2xl font-bold">₺{liveRates.EUR?.toFixed(4) || "..."}</p></div>
                        <div className="p-4 bg-background rounded-lg"><p className="text-sm text-muted-foreground">İngiliz Sterlini (GBP)</p><p className="text-2xl font-bold">₺{liveRates.GBP?.toFixed(4) || "..."}</p></div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              <Button onClick={handleSaveSettings}>Döviz Ayarlarını Kaydet</Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-2">
          <AccordionTrigger className="text-xl">Ödeme Yapan Banka Hesapları</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-6 pt-4">
              <p className="text-muted-foreground">Ödeme taleplerinde kullanılacak banka hesaplarını yönetin.</p>
              <Form {...bankForm}>
                <form onSubmit={bankForm.handleSubmit(onBankSubmit)} className="grid md:grid-cols-5 gap-4 mb-6 items-start">
                  <FormField control={bankForm.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Banka Adı</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="iban" render={({ field }) => (<FormItem><FormLabel>IBAN</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="accountNumber" render={({ field }) => (<FormItem><FormLabel>Hesap No</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={bankForm.control} name="branch" render={({ field }) => (<FormItem><FormLabel>Şube</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <Button type="submit" className="self-end" disabled={isBankLoading}>{isBankLoading ? "Ekleniyor..." : "Banka Ekle"}</Button>
                </form>
              </Form>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Banka Adı</TableHead><TableHead>IBAN</TableHead><TableHead>Hesap No</TableHead><TableHead>Şube</TableHead><TableHead><span className="sr-only">İşlemler</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isBankLoading ? (
                    <TableRow><TableCell colSpan={5}><Skeleton className="h-10" /></TableCell></TableRow>
                  ) : bankAccounts.length > 0 ? (
                    bankAccounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>{account.bankName}</TableCell>
                        <TableCell className="font-mono">{account.iban}</TableCell>
                        <TableCell>{account.accountNumber || "—"}</TableCell>
                        <TableCell>{account.branch || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteBankAccount(account.id)} disabled={isBankLoading}><Trash2 className="h-4 w-4" /><span className="sr-only">Sil</span></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={5} className="h-24 text-center">Henüz banka hesabı eklenmemiş.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3">
          <AccordionTrigger className="text-xl">Departman Yönetimi</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-6 pt-4">
              <p className="text-muted-foreground">Departmanları ve bütçelerini yönetin.</p>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Yeni Departman Ekle</CardTitle>
                  <Dialog open={isHistoryModalOpen} onOpenChange={setHistoryModalOpen}>
                    <DialogTrigger asChild><Button variant="outline"><History className="mr-2 h-4 w-4" />Departman Bütçe Geçmişi</Button></DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Departman Bütçe Geçmişi</DialogTitle>
                        <DialogDescription>Bir departman seçerek geçmiş bütçe değişikliklerini görüntüleyin.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <Select onValueChange={setSelectedDeptForHistory}>
                          <SelectTrigger><SelectValue placeholder="Bir departman seçin..." /></SelectTrigger>
                          <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <div className="max-h-96 overflow-y-auto">
                          <Table>
                            <TableHeader><TableRow><TableHead>Değişiklik Tarihi</TableHead><TableHead>Eski Bütçe</TableHead><TableHead>Yeni Bütçe</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {isHistoryLoading ? (
                                <TableRow><TableCell colSpan={3} className="text-center p-4"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                              ) : budgetHistory.length > 0 ? (
                                budgetHistory.map((h) => (
                                  <TableRow key={h.id}>
                                    <TableCell>{new Date(h.changedAt).toLocaleString("tr-TR")}</TableCell>
                                    <TableCell>{formatTRY(h.oldBudget)}</TableCell>
                                    <TableCell>{formatTRY(h.newBudget)}</TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow><TableCell colSpan={3} className="text-center p-8">Seçilen departman için geçmiş bulunamadı.</TableCell></TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <Form {...departmentForm}>
                    <form onSubmit={departmentForm.handleSubmit(onDepartmentSubmit)} className="grid md:grid-cols-3 gap-4 items-end">
                      <FormField control={departmentForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Departman Adı</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={departmentForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel>Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <Button type="submit" disabled={isDepartmentLoading}>{isDepartmentLoading ? "Ekleniyor..." : "Departman Ekle"}</Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Departman Adı</TableHead><TableHead>Bütçe</TableHead><TableHead className="text-right">İşlemler</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {isDepartmentLoading ? (
                    <TableRow><TableCell colSpan={3}><Skeleton className="h-10" /></TableCell></TableRow>
                  ) : departments.length > 0 ? (
                    departments.map((dep) => (
                      <TableRow key={dep.id}>
                        <TableCell>{editingDepartmentId === dep.id ? <Input value={editingData?.name ?? ""} onChange={(e) => handleEditingDataChange("name", e.target.value)} /> : dep.name}</TableCell>
                        <TableCell>{editingDepartmentId === dep.id ? <Input type="number" value={editingData?.budget ?? 0} onChange={(e) => handleEditingDataChange("budget", e.target.value)} /> : formatTRY(dep.budget)}</TableCell>
                        <TableCell className="text-right">
                          {editingDepartmentId === dep.id ? (
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="icon" onClick={handleSaveDepartment}><Check className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={handleCancelEdit}><X className="h-4 w-4" /></Button>
                            </div>
                          ) : (
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="icon" onClick={() => openBudgetUpdateModal(dep)} disabled={isDepartmentLoading}><PlusCircle className="h-4 w-4" /><span className="sr-only">Bütçe Arttır</span></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleEditDepartment(dep)} disabled={isDepartmentLoading}><Pencil className="h-4 w-4" /><span className="sr-only">Düzenle</span></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteDepartment(dep.id)} disabled={isDepartmentLoading}><Trash2 className="h-4 w-4" /><span className="sr-only">Sil</span></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={3} className="h-24 text-center">Hiç departman bulunamadı.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog open={isBudgetUpdateModalOpen} onOpenChange={setBudgetUpdateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedDepartmentForUpdate?.name} - Bütçe Artır</DialogTitle>
            <DialogDescription>Mevcut bütçe: {formatTRY(selectedDepartmentForUpdate?.budget || 0)}. Eklenecek tutarı girin.</DialogDescription>
          </DialogHeader>
          <Form {...budgetUpdateForm}>
            <form onSubmit={budgetUpdateForm.handleSubmit(onBudgetUpdateSubmit)} className="space-y-4">
              <FormField control={budgetUpdateForm.control} name="increaseAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Artış Miktarı (TRY)</FormLabel>
                  <FormControl><Input type="number" placeholder="5000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setBudgetUpdateModalOpen(false)}>Vazgeç</Button>
                <Button type="submit" disabled={isDepartmentLoading}>{isDepartmentLoading ? "Güncelleniyor..." : "Bütçeyi Güncelle"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
