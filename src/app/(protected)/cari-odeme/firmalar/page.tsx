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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Pencil, Landmark, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

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

  return (
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme" />
      <h1 className="text-3xl font-bold">Cari Firmalar</h1>

      <Card>
        <CardHeader>
          <CardTitle>Yeni Cari Firma</CardTitle>
          <CardDescription>Ödeme yapılacak firmaları (cari hesapları) tanımlayın.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreate)} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <FormField control={createForm.control} name="code" render={({ field }) => (<FormItem><FormLabel>Cari Kodu</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Firma Adı</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="taxId" render={({ field }) => (<FormItem><FormLabel>Vergi No</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="taxOffice" render={({ field }) => (<FormItem><FormLabel>Vergi Dairesi</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="contactName" render={({ field }) => (<FormItem><FormLabel>Yetkili</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Telefon</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>E-posta</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="dueDay" render={({ field }) => (<FormItem><FormLabel>Vade Günü</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel>Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={createForm.control} name="address" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Adres</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <Button type="submit" className="self-end" disabled={saving}><PlusCircle className="mr-2 h-4 w-4" />{saving ? "Ekleniyor..." : "Firma Ekle"}</Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Kayıtlı Firmalar</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cari Kodu</TableHead>
                <TableHead>Firma Adı</TableHead>
                <TableHead>Vergi No</TableHead>
                <TableHead>Yetkili</TableHead>
                <TableHead className="text-right">Bütçe</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-10" /></TableCell></TableRow>
              ) : firmalar.length > 0 ? (
                firmalar.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono">{f.code}</TableCell>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{f.taxId || "—"}</TableCell>
                    <TableCell>{f.contactName || "—"}</TableCell>
                    <TableCell className="text-right">{formatTRY(f.budget)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openIbans(f)} title="IBAN'lar"><Landmark className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(f)} title="Düzenle"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(f)} title="Sil" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Henüz cari firma eklenmemiş.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editingFirma} onOpenChange={(open) => !open && setEditingFirma(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cari Firma Düzenle</DialogTitle>
            <DialogDescription>{editingFirma?.name}</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={editForm.control} name="code" render={({ field }) => (<FormItem><FormLabel>Cari Kodu</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Firma Adı</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="taxId" render={({ field }) => (<FormItem><FormLabel>Vergi No</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="taxOffice" render={({ field }) => (<FormItem><FormLabel>Vergi Dairesi</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="contactName" render={({ field }) => (<FormItem><FormLabel>Yetkili</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Telefon</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>E-posta</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="dueDay" render={({ field }) => (<FormItem><FormLabel>Vade Günü</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="budget" render={({ field }) => (<FormItem><FormLabel>Bütçe (TRY)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="address" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Adres</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter className="md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setEditingFirma(null)}>Vazgeç</Button>
                <Button type="submit" disabled={saving}>{saving ? "Kaydediliyor..." : "Kaydet"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* IBAN dialog */}
      <Dialog open={!!ibanFirma} onOpenChange={(open) => !open && setIbanFirma(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{ibanFirma?.name} · IBAN Hesapları</DialogTitle>
            <DialogDescription>Bu cari firmaya ait banka/IBAN bilgilerini yönetin.</DialogDescription>
          </DialogHeader>
          <Form {...ibanForm}>
            <form onSubmit={ibanForm.handleSubmit(onAddIban)} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
              <FormField control={ibanForm.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Banka</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={ibanForm.control} name="iban" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>IBAN</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={ibanForm.control} name="branch" render={({ field }) => (<FormItem><FormLabel>Şube</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <Button type="submit" className="self-end">Ekle</Button>
            </form>
          </Form>
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Banka</TableHead><TableHead>IBAN</TableHead><TableHead>Şube</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {ibansLoading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton className="h-8" /></TableCell></TableRow>
                ) : ibans.length > 0 ? (
                  ibans.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.bankName}</TableCell>
                      <TableCell className="font-mono">{i.iban}</TableCell>
                      <TableCell>{i.branch || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => onDeleteIban(i.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={4} className="h-20 text-center">Bu firma için IBAN tanımlı değil.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
