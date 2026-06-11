
'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Edit3, Trash2, Loader2, Building2, UserCog } from 'lucide-react';
import { collection, getDocs, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { getAuth } from 'firebase/auth';
import { db, app } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import type { Company, User } from '@/lib/types';
import BackButton from '@/components/BackButton';

const NO_RESPONSIBLE_VALUE = '__none__';

export default function FirmaPanel() {
  const { toast } = useToast();
  const { isSuperAdmin, currentUserProfile } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentCompany, setCurrentCompany] = useState<Partial<Company>>({});

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Firestore Security Rules isSuperAdmin custom claim'ini kontrol eder.
      // Token'ı zorla yenileyerek claim'lerin güncel olduğundan emin oluyoruz.
      const auth = getAuth(app);
      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
      const [companySnap, userSnap] = await Promise.all([
        getDocsResilient(collection(db, 'companies')),
        getDocsResilient(collection(db, 'users')),
      ]);
      setCompanies(companySnap.docs.map(d => ({ id: d.id, ...d.data() } as Company)));
      const users = userSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
      // Sadece admin / super_admin / admin_developer rollerindeki kullanıcılar sorumlu olarak atanabilir
      const admins = users.filter(u =>
        u.role === 'admin' || u.role === 'super_admin' || u.role === 'admin_developer'
      );
      setAdminUsers(admins);
    } catch (e) {
      toast({ title: 'Hata', description: 'Firmalar yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const adminById = useMemo(() => {
    const map = new Map<string, User>();
    adminUsers.forEach(u => map.set(u.uid, u));
    return map;
  }, [adminUsers]);

  if (!isSuperAdmin) {
    return (
      <YonetimShell>
        <YonetimHeader title="Firma Yönetimi" backHref="/yonetim/tanimlar" />
        <YonetimCard title="Yetkisiz Erişim" description="Firma yönetimi sadece Süper Admin tarafından yapılabilir.">
          <div />
        </YonetimCard>
      </YonetimShell>
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
      const responsibleUid = currentCompany.responsibleUid || '';
      const responsibleName = responsibleUid
        ? (adminById.get(responsibleUid)?.name || adminById.get(responsibleUid)?.email || '')
        : '';

      if (currentCompany.id) {
        // Editing existing
        await setDoc(doc(db, 'companies', currentCompany.id), {
          name: currentCompany.name.trim(),
          description: currentCompany.description?.trim() || '',
          responsibleUid: responsibleUid || null,
          responsibleName: responsibleName || null,
        }, { merge: true });
        toast({ title: 'Başarılı', description: 'Firma güncellendi.' });
      } else {
        // Creating new
        const newRef = doc(collection(db, 'companies'));
        await setDoc(newRef, {
          name: currentCompany.name.trim(),
          description: currentCompany.description?.trim() || '',
          responsibleUid: responsibleUid || null,
          responsibleName: responsibleName || null,
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
    <YonetimShell>
      <YonetimHeader
        title="Firma Yönetimi"
        description="Sisteme bağlı firmaları yönetin. Sadece Süper Admin firma oluşturabilir."
        backHref="/yonetim/tanimlar"
        rightAction={
          <Button onClick={() => openModal()} size="sm" disabled={isLoading} style={{ background: 'var(--mg-accent)', color: '#0a0a0c', border: 'none', fontWeight: 700 }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Firma
          </Button>
        }
      />

      <YonetimCard>
        <div style={{ padding: '10px 14px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.25)', borderRadius: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--mg-text-2)', margin: 0 }}>
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
                      <TableHead>Açıklama</TableHead>
                      <TableHead>Sorumlu</TableHead>
                      <TableHead>Oluşturan</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          Henüz firma tanımlanmamış. Tüm veriler legacy firmaya aittir.
                        </TableCell>
                      </TableRow>
                    ) : (
                      companies.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-muted-foreground">{c.description || '-'}</TableCell>
                          <TableCell>
                            {c.responsibleName ? (
                              <span className="inline-flex items-center gap-1 text-sm">
                                <UserCog className="h-3.5 w-3.5 text-indigo-500" />
                                {c.responsibleName}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">Atanmadı</span>
                            )}
                          </TableCell>
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
      </YonetimCard>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{currentCompany.id ? 'Firma Düzenle' : 'Yeni Firma'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Firma Adı</Label>
              <Input
                placeholder="Firma Adı"
                value={currentCompany.name || ''}
                onChange={(e) => setCurrentCompany({ ...currentCompany, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Input
                placeholder="Açıklama (opsiyonel)"
                value={currentCompany.description || ''}
                onChange={(e) => setCurrentCompany({ ...currentCompany, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <UserCog className="h-3.5 w-3.5 text-indigo-500" />
                Firma Sorumlusu
              </Label>
              <Select
                value={currentCompany.responsibleUid || NO_RESPONSIBLE_VALUE}
                onValueChange={(v) => setCurrentCompany({
                  ...currentCompany,
                  responsibleUid: v === NO_RESPONSIBLE_VALUE ? '' : v,
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Adminler arasından seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RESPONSIBLE_VALUE}>Sorumlu atanmadı</SelectItem>
                  {adminUsers.length === 0 ? (
                    <SelectItem value="__empty__" disabled>Admin bulunamadı</SelectItem>
                  ) : (
                    adminUsers.map((u) => (
                      <SelectItem key={u.uid} value={u.uid}>
                        {u.name || u.email || u.uid}
                        {u.role === 'super_admin' ? ' · Süper Admin' : u.role === 'admin_developer' ? ' · Admin Geliştirici' : ' · Admin'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Haftalık plan oluşturulduğunda onay isteği bu kişiye iletilir.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </YonetimShell>
  );
}
