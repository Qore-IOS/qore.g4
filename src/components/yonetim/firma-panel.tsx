
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit3, Trash2, Loader2, Building2 } from 'lucide-react';
import { collection, getDocs, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import type { Company } from '@/lib/types';
import BackButton from '@/components/BackButton';

export default function FirmaPanel() {
  const { toast } = useToast();
  const { isSuperAdmin, currentUserProfile } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentCompany, setCurrentCompany] = useState<Partial<Company>>({});
  const [adminUsers, setAdminUsers] = useState<{uid: string, name: string}[]>([]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'companies'));
      setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() } as Company)));

      // Fetch admin users for the responsible selector
      const usersSnap = await getDocs(collection(db, 'users'));
      const admins = usersSnap.docs
        .map(d => ({ uid: d.id, ...d.data() } as any))
        .filter(u => u.role === 'admin')
        .map(u => ({ uid: u.uid, name: u.name || u.email || u.uid }));
      setAdminUsers(admins);
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!isSuperAdmin) {
    return (
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim/tanimlar" />
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl font-headline">Yetkisiz Erişim</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Firma yönetimi sadece Süper Admin tarafından yapılabilir.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const openModal = (company?: Company) => {
    setCurrentCompany(company || {});
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!currentCompany.name?.trim()) {
      toast({ title: 'Hata', description: 'Firma adı boş olamaz.', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      if (currentCompany.id) {
        // Editing existing
        await setDoc(doc(db, 'companies', currentCompany.id), {
          name: currentCompany.name.trim(),
          description: currentCompany.description?.trim() || '',
          responsibleUserId: currentCompany.responsibleUserId || null,
          responsibleUserName: currentCompany.responsibleUserName || null,
        }, { merge: true });
        toast({ title: 'Başarılı', description: 'Firma güncellendi.' });
      } else {
        // Creating new
        const newRef = doc(collection(db, 'companies'));
        await setDoc(newRef, {
          name: currentCompany.name.trim(),
          description: currentCompany.description?.trim() || '',
          responsibleUserId: currentCompany.responsibleUserId || null,
          responsibleUserName: currentCompany.responsibleUserName || null,
          createdAt: new Date(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
        toast({ title: 'Başarılı', description: 'Yeni firma oluşturuldu.' });
      }
      fetchData();
      setIsModalOpen(false);
    } catch (error: any) {
      toast({ title: 'Hata', description: `Kayıt sırasında bir sorun oluştu: ${error.message}`, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu firmayı silmek istediğinizden emin misiniz? Firmaya bağlı kullanıcılar legacy firmaya düşecektir.')) {
      setIsLoading(true);
      try {
        await deleteDoc(doc(db, 'companies', id));
        toast({ title: 'Silindi', description: 'Firma silindi.', variant: 'destructive' });
        fetchData();
      } catch (error: any) {
        toast({ title: 'Hata', description: `Silme sırasında bir sorun oluştu: ${error.message}`, variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim/tanimlar" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <Building2 className="mr-2 h-6 w-6 text-indigo-500" />
                Firma Yönetimi
              </CardTitle>
              <CardDescription>Sisteme bağlı firmaları yönetin. Sadece Süper Admin firma oluşturabilir.</CardDescription>
            </div>
            <Button onClick={() => openModal()} size="sm" disabled={isLoading}>
              <PlusCircle className="mr-2 h-4 w-4" />Yeni Firma
            </Button>
          </CardHeader>
          <CardContent>
            {/* Legacy firma bilgisi */}
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                <strong>Legacy Firma:</strong> Şirketi tanımlanmamış tüm kullanıcılar ve veriler otomatik olarak legacy firmaya aittir.
              </p>
            </div>

            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Firma Adı</TableHead>
                      <TableHead>Firma Sorumlusu</TableHead>
                      <TableHead>Açıklama</TableHead>
                      <TableHead>Oluşturan</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          Henüz firma tanımlanmamış. Tüm veriler legacy firmaya aittir.
                        </TableCell>
                      </TableRow>
                    ) : (
                      companies.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>{c.responsibleUserName || <span className="text-[10px] text-muted-foreground">Atanmamış</span>}</TableCell>
                          <TableCell className="text-muted-foreground">{c.description || '-'}</TableCell>
                          <TableCell>{c.createdByName || '-'}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => openModal(c)}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{currentCompany.id ? 'Firma Düzenle' : 'Yeni Firma'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Firma Adı"
              value={currentCompany.name || ''}
              onChange={(e) => setCurrentCompany({ ...currentCompany, name: e.target.value })}
            />
            <Input
              placeholder="Açıklama (opsiyonel)"
              value={currentCompany.description || ''}
              onChange={(e) => setCurrentCompany({ ...currentCompany, description: e.target.value })}
            />
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Firma Sorumlusu (Plan Onaylayacak Kişi)</label>
              <select
                className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={currentCompany.responsibleUserId || ''}
                onChange={(e) => {
                  const uid = e.target.value;
                  const name = adminUsers.find(u => u.uid === uid)?.name || '';
                  setCurrentCompany({ ...currentCompany, responsibleUserId: uid, responsibleUserName: name });
                }}
              >
                <option value="">Sorumlu Seçilmedi</option>
                {adminUsers.map(u => (
                  <option key={u.uid} value={u.uid}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
