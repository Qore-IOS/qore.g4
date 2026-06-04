'use client';
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  listCariFirmalar,
  createCariFirma,
  updateCariFirma,
  deleteCariFirma,
  listCariFirmaIbans,
  createCariFirmaIban,
  deleteCariFirmaIban,
} from "@/lib/cari-odeme/firestore";
import type { CariFirma, Iban } from "@/lib/cari-odeme/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Pencil, Landmark, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

const FirmaSchema = z.object({
  code: z.string().min(1, "Cari kodu zorunludur."),
  name: z.string().min(1, "Firma adı zorunludur."),
  taxId: z.string().optional(),
  taxOffice: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Geçersiz e-posta.").optional().or(z.literal("")),
  dueDay: z.coerce.number().optional(),
  address: z.string().optional(),
  budget: z.coerce.number().min(0).optional(),
});
type FirmaFormValues = z.infer<typeof FirmaSchema>;

const IbanSchema = z.object({
  bankName: z.string().min(1, "Banka adı zorunludur."),
  iban: z.string().min(1, "IBAN zorunludur."),
  accountNumber: z.string().optional(),
  branch: z.string().optional(),
});
type IbanFormValues = z.infer<typeof IbanSchema>;

const emptyFirma: FirmaFormValues = {
  code: "", name: "", taxId: "", taxOffice: "", contactName: "", phone: "", email: "", dueDay: undefined, address: "", budget: 0,
};

export default function CariFirmalarPage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const scope = { companyId: currentCompanyId, isSuperAdmin };
  const { toast } = useToast();

  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingFirma, setEditingFirma] = useState<CariFirma | null>(null);
  const [ibanFirma, setIbanFirma] = useState<CariFirma | null>(null);
  const [ibans, setIbans] = useState<Iban[]>([]);
  const [ibansLoading, setIbansLoading] = useState(false);

  const createForm = useForm<FirmaFormValues>({ resolver: zodResolver(FirmaSchema), defaultValues: emptyFirma });
  const editForm = useForm<FirmaFormValues>({ resolver: zodResolver(FirmaSchema), defaultValues: emptyFirma });
  const ibanForm = useForm<IbanFormValues>({ resolver: zodResolver(IbanSchema), defaultValues: { bankName: "", iban: "", accountNumber: "", branch: "" } });

  const fetchFirmalar = async () => {
    setLoading(true);
    try {
      const { items } = await listCariFirmalar(scope, { size: 2000 });
      setFirmalar(items);
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "Cari firmalar yüklenemedi." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFirmalar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, isSuperAdmin]);

  const formatTRY = (n?: number) => (n ?? 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

  const onCreate = async (values: FirmaFormValues) => {
    setSaving(true);
    try {
      await createCariFirma(scope, values as Parameters<typeof createCariFirma>[1]);
      toast({ title: "Başarılı", description: "Cari firma eklendi." });
      createForm.reset(emptyFirma);
      await fetchFirmalar();
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "Cari firma eklenemedi." });
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (firma: CariFirma) => {
    setEditingFirma(firma);
    editForm.reset({
      code: firma.code ?? "",
      name: firma.name ?? "",
      taxId: firma.taxId ?? "",
      taxOffice: firma.taxOffice ?? "",
      contactName: firma.contactName ?? "",
      phone: firma.phone ?? "",
      email: firma.email ?? "",
      dueDay: firma.dueDay,
      address: firma.address ?? "",
      budget: firma.budget ?? 0,
    });
  };

  const onEdit = async (values: FirmaFormValues) => {
    if (!editingFirma) return;
    setSaving(true);
    try {
      await updateCariFirma(scope, editingFirma.id, values);
      toast({ title: "Başarılı", description: "Cari firma güncellendi." });
      setEditingFirma(null);
      await fetchFirmalar();
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "Cari firma güncellenemedi." });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (firma: CariFirma) => {
    if (!confirm(`'${firma.name}' firmasını silmek istediğinizden emin misiniz?`)) return;
    try {
      await deleteCariFirma(firma.id);
      toast({ title: "Başarılı", description: "Cari firma silindi." });
      await fetchFirmalar();
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "Cari firma silinemedi." });
    }
  };

  const openIbans = async (firma: CariFirma) => {
    setIbanFirma(firma);
    setIbansLoading(true);
    ibanForm.reset({ bankName: "", iban: "", accountNumber: "", branch: "" });
    try {
      setIbans(await listCariFirmaIbans(firma.id));
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "IBAN'lar yüklenemedi." });
    } finally {
      setIbansLoading(false);
    }
  };

  const onAddIban = async (values: IbanFormValues) => {
    if (!ibanFirma) return;
    try {
      await createCariFirmaIban(scope, ibanFirma.id, values as Parameters<typeof createCariFirmaIban>[2]);
      toast({ title: "Başarılı", description: "IBAN eklendi." });
      ibanForm.reset({ bankName: "", iban: "", accountNumber: "", branch: "" });
      setIbans(await listCariFirmaIbans(ibanFirma.id));
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "IBAN eklenemedi." });
    }
  };

  const onDeleteIban = async (ibanId: string) => {
    if (!ibanFirma) return;
    try {
      await deleteCariFirmaIban(ibanFirma.id, ibanId);
      setIbans(await listCariFirmaIbans(ibanFirma.id));
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: "IBAN silinemedi." });
    }
  };

  const [searchTerm, setSearchTerm] = useState("");
  const filteredFirmalar = firmalar.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 w-full p-4 md:p-8">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <BackButton fallback="/cari-odeme" className="border-border hover:bg-muted" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cari Firmalar</h1>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="w-full md:w-auto rounded-full px-6 shadow-sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Yeni Firma
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-medium text-lg">Yeni Cari Firma Ekle</DialogTitle>
              <DialogDescription>Ödeme yapılacak firmaları (cari hesapları) sisteme tanımlayın.</DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreate)} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start mt-4">
                <FormField control={createForm.control} name="code" render={({ field }) => (<FormItem><FormLabel>Cari Kodu</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Firma Adı</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="taxId" render={({ field }) => (<FormItem><FormLabel>Vergi No</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="taxOffice" render={({ field }) => (<FormItem><FormLabel>Vergi Dairesi</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="contactName" render={({ field }) => (<FormItem><FormLabel>Yetkili</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Telefon</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>E-posta</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="dueDay" render={({ field }) => (<FormItem><FormLabel>Vade Günü</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel>Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={createForm.control} name="address" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Adres</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
                <Button type="submit" className="md:col-start-3 self-end rounded-full" disabled={saving}>{saving ? "Ekleniyor..." : "Kaydet"}</Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/20">
          <Input 
            placeholder="Ada veya koda göre ara..." 
            value={searchTerm} 
            onChange={e => setSearchTerm(e.target.value)}
            className="max-w-md bg-card border-border rounded-full"
          />
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-medium h-12">Cari Kodu</TableHead>
              <TableHead className="font-medium h-12">Firma Adı</TableHead>
              <TableHead className="font-medium h-12">E-posta</TableHead>
              <TableHead className="font-medium h-12">Telefon</TableHead>
              <TableHead className="text-right font-medium h-12">Bütçe</TableHead>
              <TableHead className="text-right h-12"><span className="sr-only">İşlemler</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border/50"><TableCell colSpan={6}><div className="h-10 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
            ) : filteredFirmalar.length > 0 ? (
              filteredFirmalar.map((f, i) => (
                <TableRow key={f.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", i === filteredFirmalar.length - 1 && "border-0")}>
                  <TableCell className="py-4 font-mono text-muted-foreground">{f.code}</TableCell>
                  <TableCell className="py-4 font-medium">{f.name}</TableCell>
                  <TableCell className="py-4 text-muted-foreground">{f.email || "—"}</TableCell>
                  <TableCell className="py-4 text-muted-foreground">{f.phone || "—"}</TableCell>
                  <TableCell className="py-4 text-right font-semibold">{formatTRY(f.budget)}</TableCell>
                  <TableCell className="py-4 text-right">
                    <div className="flex gap-4 justify-end items-center">
                      <button onClick={() => openIbans(f)} className="text-sm font-medium text-primary hover:underline">IBAN'lar</button>
                      <button onClick={() => openEdit(f)} className="text-sm font-medium text-primary hover:underline">Düzenle</button>
                      <button onClick={() => onDelete(f)} className="text-sm font-medium text-destructive hover:underline">Sil</button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground border-0">Kayıtlı firma bulunamadı.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {/* Placeholder Pagination just like design */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-muted/20 text-sm text-muted-foreground">
          <span>Toplam {filteredFirmalar.length} firma</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-full border-border h-8 shadow-none" disabled>İlk</Button>
            <Button variant="outline" size="sm" className="rounded-full border-border h-8 shadow-none" disabled>Önceki</Button>
            <Button variant="outline" size="sm" className="rounded-full border-border h-8 shadow-none" disabled>Sonraki</Button>
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingFirma} onOpenChange={(open) => !open && setEditingFirma(null)}>
        <DialogContent className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-medium text-lg">Cari Firma Düzenle</DialogTitle>
            <DialogDescription>{editingFirma?.name}</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <FormField control={editForm.control} name="code" render={({ field }) => (<FormItem><FormLabel>Cari Kodu</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Firma Adı</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="taxId" render={({ field }) => (<FormItem><FormLabel>Vergi No</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="taxOffice" render={({ field }) => (<FormItem><FormLabel>Vergi Dairesi</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="contactName" render={({ field }) => (<FormItem><FormLabel>Yetkili</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Telefon</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>E-posta</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="dueDay" render={({ field }) => (<FormItem><FormLabel>Vade Günü</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel>Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="address" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Adres</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter className="md:col-span-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditingFirma(null)} className="rounded-full border-border">Vazgeç</Button>
                <Button type="submit" disabled={saving} className="rounded-full">{saving ? "Kaydediliyor..." : "Kaydet"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* IBAN dialog */}
      <Dialog open={!!ibanFirma} onOpenChange={(open) => !open && setIbanFirma(null)}>
        <DialogContent className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-medium text-lg">{ibanFirma?.name} · IBAN Hesapları</DialogTitle>
            <DialogDescription>Bu cari firmaya ait banka/IBAN bilgilerini yönetin.</DialogDescription>
          </DialogHeader>
          <Form {...ibanForm}>
            <form onSubmit={ibanForm.handleSubmit(onAddIban)} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mt-4">
              <FormField control={ibanForm.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Banka</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={ibanForm.control} name="iban" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>IBAN</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={ibanForm.control} name="branch" render={({ field }) => (<FormItem><FormLabel>Şube</FormLabel><FormControl><Input {...field} className="bg-transparent border-border" /></FormControl><FormMessage /></FormItem>)} />
              <Button type="submit" className="rounded-full h-10 w-full">Ekle</Button>
            </form>
          </Form>
          <div className="max-h-72 overflow-y-auto border border-border rounded-xl mt-4">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-border hover:bg-transparent"><TableHead className="font-medium h-10">Banka</TableHead><TableHead className="font-medium h-10">IBAN</TableHead><TableHead className="font-medium h-10">Şube</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {ibansLoading ? (
                  <TableRow className="border-0"><TableCell colSpan={4}><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                ) : ibans.length > 0 ? (
                  ibans.map((i, index) => (
                    <TableRow key={i.id} className={cn("border-border/50 hover:bg-muted/30", index === ibans.length - 1 && "border-0")}>
                      <TableCell className="font-medium">{i.bankName}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{i.iban}</TableCell>
                      <TableCell className="text-muted-foreground">{i.branch || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => onDeleteIban(i.id)} className="text-destructive hover:text-destructive h-8 w-8"><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground border-0">Bu firma için IBAN tanımlı değil.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
