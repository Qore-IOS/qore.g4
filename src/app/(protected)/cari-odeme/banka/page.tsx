"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    <div className="space-y-6 p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Landmark className="h-8 w-8 text-blue-600" />
            Banka İşlemleri
          </h1>
          <p className="text-muted-foreground mt-1">
            Banka hesaplarınızı, bakiyeleri ve hareketleri yönetin.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Yeni Hareket İşle
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Manuel Banka Hareketi</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                
                <FormField control={form.control} name="bankAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hesap</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Banka Seçin" /></SelectTrigger></FormControl>
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
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
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
                          <Button variant="outline" className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
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
                    <FormControl><Input placeholder="Örn: X Firması Havale" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-end pt-4 gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>İptal</Button>
                  <Button type="submit" disabled={isSubmitting}>
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
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accounts.map(acc => (
            <Card 
              key={acc.id} 
              className={cn("cursor-pointer transition-colors hover:bg-muted/50", selectedAccountId === acc.id ? "border-blue-500 bg-blue-50/50" : "")}
              onClick={() => setSelectedAccountId(acc.id)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{acc.bankName}</CardTitle>
                <CardDescription className="font-mono text-xs truncate" title={acc.iban}>{acc.iban}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(acc.currentBalance || 0, acc.currency || "TRY")}
                </div>
                {acc.lastReconciliationDate && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Son mutabakat: {format(acc.lastReconciliationDate, "dd.MM.yyyy")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedAccountId && (
        <Card>
          <CardHeader>
            <CardTitle>Hesap Hareketleri</CardTitle>
            <CardDescription>Seçili banka hesabının işlem geçmişi</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTx ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                Bu hesap için hiç hareket bulunmuyor.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tarih</TableHead>
                      <TableHead>İşlem</TableHead>
                      <TableHead>Açıklama</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead className="text-right">Tutar</TableHead>
                      <TableHead className="text-right">Bakiye</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>{format(new Date(tx.transactionDate), "dd.MM.yyyy")}</TableCell>
                        <TableCell>
                          {tx.type === "giris" ? (
                            <Badge variant="outline" className="text-green-600 bg-green-50 border-green-200">
                              <ArrowDownRight className="mr-1 h-3 w-3" /> Giriş
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600 bg-red-50 border-red-200">
                              <ArrowUpRight className="mr-1 h-3 w-3" /> Çıkış
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={tx.description}>
                          {tx.description}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={
                            tx.reconciliationStatus === "eslesmis" ? "bg-green-100 text-green-700" :
                            tx.reconciliationStatus === "manuel_eslesmis" ? "bg-blue-100 text-blue-700" :
                            "bg-yellow-100 text-yellow-700"
                          }>
                            {tx.reconciliationStatus === "eslesmemis" ? "Eşleşmedi" : 
                             tx.reconciliationStatus === "manuel_eslesmis" ? "Manuel Eşleşti" : "Eşleşti"}
                          </Badge>
                        </TableCell>
                        <TableCell className={cn("text-right font-medium", tx.type === "giris" ? "text-green-600" : "")}>
                          {tx.type === "cikis" ? "-" : ""}{formatCurrency(tx.amount, tx.currency)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatCurrency(tx.balance, tx.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
