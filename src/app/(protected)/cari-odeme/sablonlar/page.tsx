'use client';
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { listPaymentTemplates, createPaymentFromTemplate, deletePaymentTemplate } from "@/lib/cari-odeme/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Send, Pencil, Trash2 } from "lucide-react";
import type { PaymentTemplate } from "@/lib/cari-odeme/types";
import { useToast } from "@/hooks/use-toast";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/contexts/auth-context";

function PaymentTemplatesPageContent() {
  const [templates, setTemplates] = useState<PaymentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const templateData = await listPaymentTemplates({ companyId: currentCompanyId, isSuperAdmin });
      setTemplates(templateData);
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Ödeme talimatları yüklenemedi." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, isSuperAdmin]);

  const handleSendForApproval = async (template: PaymentTemplate) => {
    if (!currentUser || !currentUserProfile) {
      toast({ variant: "destructive", title: "Hata", description: "İşlem yapmak için giriş yapmalısınız." });
      return;
    }
    setSending(template.id);
    try {
      await createPaymentFromTemplate(
        { companyId: currentCompanyId, isSuperAdmin },
        template,
        currentUser.uid,
        currentUserProfile.name || currentUser.email!
      );
      toast({ title: "Başarılı", description: `'${template.templateName}' talimatından ödeme talebi oluşturuldu ve onaya gönderildi.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Ödeme talebi oluşturulamadı." });
    } finally {
      setSending(null);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (confirm("Bu talimatı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.")) {
      try {
        await deletePaymentTemplate(templateId);
        toast({ title: "Başarılı", description: "Ödeme talimatı silindi." });
        await fetchTemplates();
      } catch (error) {
        toast({ variant: "destructive", title: "Hata", description: "Talimat silinemedi." });
      }
    }
  };

  return (
    <div className="space-y-6 p-4">
      <BackButton fallback="/cari-odeme" />
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Ödeme Talimatları</h1>
        <Link href="/cari-odeme/sablonlar/yeni" passHref>
          <Button className="w-full md:w-auto"><PlusCircle className="mr-2 h-4 w-4" />Yeni Talimat</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Kayıtlı Talimatlar</CardTitle></CardHeader>
        <CardContent>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Talimat Adı</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead className="w-[300px] text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={5}><div className="h-8 animate-pulse bg-muted rounded-md" /></TableCell></TableRow>
                  ))
                ) : templates.length > 0 ? (
                  templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.templateName}</TableCell>
                      <TableCell>{t.companyName}</TableCell>
                      <TableCell>{t.description || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{t.amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleSendForApproval(t)} disabled={sending === t.id}>
                            <Send className="mr-2 h-4 w-4" />Onaya Gönder
                          </Button>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/cari-odeme/sablonlar/${t.id}`}><Pencil className="h-4 w-4" /><span className="sr-only">Düzenle</span></Link>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" /><span className="sr-only">Sil</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={5} className="h-24 text-center">Henüz ödeme talimatı oluşturulmamış.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="block md:hidden">
            <div className="space-y-4">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><div className="h-28 animate-pulse bg-muted rounded-md" /></CardContent></Card>
                ))
              ) : templates.length > 0 ? (
                templates.map((t) => (
                  <Card key={t.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{t.templateName}</CardTitle>
                      <CardDescription>{t.companyName}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <p className="font-bold text-lg">{t.amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</p>
                      <p>{t.description || "Açıklama yok"}</p>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                      <Button variant="secondary" className="w-full" onClick={() => handleSendForApproval(t)} disabled={sending === t.id}>
                        <Send className="mr-2 h-4 w-4" />{sending === t.id ? "Gönderiliyor..." : "Onaya Gönder"}
                      </Button>
                      <div className="flex w-full gap-2">
                        <Button asChild variant="outline" className="w-full"><Link href={`/cari-odeme/sablonlar/${t.id}`}><Pencil className="mr-2 h-4 w-4" /> Düzenle</Link></Button>
                        <Button variant="destructive" className="w-full" onClick={() => handleDelete(t.id)}><Trash2 className="mr-2 h-4 w-4" /> Sil</Button>
                      </div>
                    </CardFooter>
                  </Card>
                ))
              ) : (
                <div className="text-center p-8 text-muted-foreground">Henüz ödeme talimatı oluşturulmamış.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentTemplatesPage() {
  return (
    <Suspense fallback={<div className="p-4">Yükleniyor...</div>}>
      <PaymentTemplatesPageContent />
    </Suspense>
  );
}
