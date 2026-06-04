"use client";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Landmark, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

import { listBankAccounts } from "@/lib/cari-odeme/firestore";
import { listBankTransactions, createBankTransaction } from "@/lib/cari-odeme/bank-firestore";
import type { BankAccount } from "@/lib/cari-odeme/types";
import type { BankTransaction } from "@/lib/cari-odeme/bank-types";

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

const schema = z.object({
  bankAccountId: z.string().min(1, "Banka hesabı seçilmelidir"),
  type: z.enum(["giris", "cikis"]),
  amount: z.coerce.number().min(0.01, "Tutar 0'dan büyük olmalıdır"),
  transactionDate: z.date({ required_error: "Tarih zorunludur" }),
  description: z.string().min(1, "Açıklama zorunludur"),
  reference: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function BankaPage() {
  const { currentCompanyId, isSuperAdmin, currentUser, currentUserProfile } = useAuth();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      bankAccountId: "",
      type: "giris",
      amount: 0,
      description: "",
      reference: "",
      transactionDate: new Date(),
    },
  });

  const fetchAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const data = await listBankAccounts({ companyId: currentCompanyId, isSuperAdmin });
      setAccounts(data.items);
      if (data.items.length > 0 && !selectedAccountId) {
        setSelectedAccountId(data.items[0].id);
        form.setValue("bankAccountId", data.items[0].id);
      }
    } catch (error) {
      console.error("Banka hesapları yüklenemedi", error);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const fetchTransactions = async (accountId: string) => {
    setIsLoadingTx(true);
    try {
      const data = await listBankTransactions({ companyId: currentCompanyId, isSuperAdmin }, accountId);
      setTransactions(data);
    } catch (error) {
      console.error("Hareketler yüklenemedi", error);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    if (selectedAccountId) {
      fetchTransactions(selectedAccountId);
    }
  }, [selectedAccountId, currentCompanyId, isSuperAdmin]);

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const account = accounts.find(a => a.id === values.bankAccountId);
      if (!account) throw new Error("Hesap bulunamadı");

      const userId = currentUser?.uid ?? "unknown";
      const userName = currentUserProfile?.name ?? currentUser?.email ?? "Bilinmeyen";

      await createBankTransaction(
        { companyId: currentCompanyId, isSuperAdmin },
        {
          bankAccountId: account.id,
          bankName: account.bankName,
          transactionDate: values.transactionDate,
          type: values.type as "giris" | "cikis",
          amount: values.amount,
          currency: account.currency || "TRY",
          description: values.description,
          reference: values.reference,
          reconciliationStatus: "eslesmemis",
        },
        userId,
        userName
      );

      toast({ title: "Başarılı", description: "Banka hareketi işlendi." });
      setIsDialogOpen(false);
      form.reset();
      fetchAccounts(); // Bakiyeyi güncellemek için
      if (selectedAccountId) fetchTransactions(selectedAccountId);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Hata", description: error?.message || "İşlem kaydedilemedi." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (n: number, currency = "TRY") =>
    n.toLocaleString("tr-TR", { style: "currency", currency });

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 py-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Landmark className="h-6 w-6 text-primary" />
            Banka İşlemleri
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Banka hesaplarınızı, bakiyeleri ve hareketleri yönetin.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full gap-2 shadow-sm px-6">
              <Plus className="h-4 w-4" />
              Yeni Hareket İşle
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] !rounded-xl">
            <DialogHeader>
              <DialogTitle>Manuel Banka Hareketi</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                
                <FormField control={form.control} name="bankAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hesap</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger className="rounded-xl"><SelectValue placeholder="Banka Seçin" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.bankName} - {a.iban}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>İşlem Yönü</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="giris">Hesaba Giriş (+)</SelectItem>
                          <SelectItem value="cikis">Hesaptan Çıkış (-)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tutar</FormLabel>
                      <FormControl><Input className="rounded-xl" type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="transactionDate" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>İşlem Tarihi</FormLabel>
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
                    <FormControl><Input className="rounded-xl" placeholder="Örn: X Firması Havale" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-end pt-4 gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setIsDialogOpen(false)}>İptal</Button>
                  <Button type="submit" className="rounded-full" disabled={isSubmitting}>
                    {isSubmitting ? "İşleniyor..." : "Kaydet"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoadingAccounts ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {accounts.map(acc => (
            <div 
              key={acc.id} 
              className={cn(
                "cursor-pointer transition-colors border rounded-xl p-6 relative overflow-hidden group", 
                selectedAccountId === acc.id 
                  ? "border-primary bg-primary/5 shadow-sm" 
                  : "border-border bg-card hover:bg-muted/30"
              )}
              onClick={() => setSelectedAccountId(acc.id)}
            >
              {selectedAccountId === acc.id && (
                <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
              )}
              <div className="pb-2">
                <h3 className="text-lg font-semibold">{acc.bankName}</h3>
                <p className="font-mono text-xs text-muted-foreground truncate mt-1" title={acc.iban}>{acc.iban}</p>
              </div>
              <div className="pt-2">
                <div className="text-2xl font-bold text-foreground">
                  {formatCurrency(acc.currentBalance || 0, acc.currency || "TRY")}
                </div>
                {acc.lastReconciliationDate && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Son mutabakat: {format(acc.lastReconciliationDate, "dd.MM.yyyy")}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedAccountId && (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm mt-8">
          <div className="p-6 border-b border-border bg-muted/20">
            <h3 className="text-base font-semibold">Hesap Hareketleri</h3>
            <p className="text-sm text-muted-foreground mt-1">Seçili banka hesabının işlem geçmişi</p>
          </div>
          
          {isLoadingTx ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16">
              <Landmark className="h-12 w-12 mx-auto text-muted-foreground opacity-30 mb-4" />
              <p className="text-muted-foreground">Bu hesap için hiç hareket bulunmuyor.</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-medium h-10">Tarih</TableHead>
                  <TableHead className="font-medium h-10">İşlem</TableHead>
                  <TableHead className="font-medium h-10">Açıklama</TableHead>
                  <TableHead className="font-medium h-10">Durum</TableHead>
                  <TableHead className="font-medium h-10 text-right">Tutar</TableHead>
                  <TableHead className="font-medium h-10 text-right">Bakiye</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, idx) => (
                  <TableRow key={tx.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", idx === transactions.length - 1 && "border-0")}>
                    <TableCell className="py-3 text-muted-foreground">{format(new Date(tx.transactionDate), "dd.MM.yyyy")}</TableCell>
                    <TableCell className="py-3">
                      {tx.type === "giris" ? (
                        <Badge variant="outline" className="rounded-full px-2.5 font-normal text-emerald-600 bg-emerald-50 border-emerald-200">
                          <ArrowDownRight className="mr-1 h-3 w-3" /> Giriş
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full px-2.5 font-normal text-destructive bg-destructive/10 border-destructive/20">
                          <ArrowUpRight className="mr-1 h-3 w-3" /> Çıkış
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-3 max-w-[200px] truncate" title={tx.description}>
                      {tx.description}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant="secondary" className={cn(
                        "rounded-full px-2.5 font-medium",
                        tx.reconciliationStatus === "eslesmis" ? "bg-emerald-500/10 text-emerald-600" :
                        tx.reconciliationStatus === "manuel_eslesmis" ? "bg-blue-500/10 text-blue-600" :
                        "bg-yellow-500/10 text-yellow-600"
                      )}>
                        {tx.reconciliationStatus === "eslesmemis" ? "Eşleşmedi" : 
                         tx.reconciliationStatus === "manuel_eslesmis" ? "Manuel Eşleşti" : "Eşleşti"}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn("py-3 text-right font-medium", tx.type === "giris" ? "text-emerald-600" : "")}>
                      {tx.type === "cikis" ? "-" : ""}{formatCurrency(tx.amount, tx.currency)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-muted-foreground">
                      {formatCurrency(tx.balance, tx.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
