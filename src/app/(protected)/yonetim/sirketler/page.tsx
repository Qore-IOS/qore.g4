'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Plus, Edit3, ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useCompany } from '@/contexts/company-context';
import { useToast } from '@/hooks/use-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import type { Company } from '@/lib/types';

export default function SirketlerPage() {
  const { isAdmin, currentUser, currentUserProfile, isSuperAdmin } = useAuth();
  const { companies, isLoadingCompanies, createCompany, updateCompany, activeCompanyId, switchCompany } = useCompany();
  const { toast } = useToast();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
  });

  if (!isAdmin) {
    return (
      <Card className="shadow-lg m-6">
        <CardHeader>
          <CardTitle className="text-xl">Yetkisiz Erişim</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Bu panele erişim yetkiniz bulunmamaktadır.</p>
        </CardContent>
      </Card>
    );
  }

  const openCreate = () => {
    setFormData({ name: '', displayName: '', description: '' });
    setIsCreateModalOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      displayName: company.displayName,
      description: company.description || '',
    });
    setIsEditModalOpen(true);
  };

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.displayName.trim()) {
      toast({ title: 'Hata', description: 'Şirket kodu ve adı zorunludur.', variant: 'destructive' });
      return;
    }
    if (!/^[A-Z0-9_]+$/.test(formData.name.toUpperCase().replace(/\s/g, '_'))) {
      toast({ title: 'Hata', description: 'Şirket kodu sadece harf, rakam ve alt çizgi içerebilir.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const newId = await createCompany({
        name: formData.name.toUpperCase().replace(/\s+/g, '_'),
        displayName: formData.displayName.trim(),
        description: formData.description.trim() || undefined,
        isActive: true,
        createdBy: currentUser?.uid || 'system',
      });
      toast({ title: 'Başarılı', description: `${formData.displayName} şirketi oluşturuldu. ID: ${newId}` });
      setIsCreateModalOpen(false);
    } catch (error: any) {
      toast({ title: 'Hata', description: error.message || 'Şirket oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingCompany || !formData.displayName.trim()) return;
    setIsSaving(true);
    try {
      await updateCompany(editingCompany.id, {
        displayName: formData.displayName.trim(),
        description: formData.description.trim() || undefined,
      });
      toast({ title: 'Başarılı', description: 'Şirket bilgileri güncellendi.' });
      setIsEditModalOpen(false);
    } catch (error: any) {
      toast({ title: 'Hata', description: error.message || 'Güncelleme yapılamadı.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (company: Company) => {
    try {
      await updateCompany(company.id, { isActive: !company.isActive });
      toast({
        title: 'Güncellendi',
        description: `${company.displayName} ${company.isActive ? 'devre dışı bırakıldı' : 'aktif edildi'}.`,
      });
    } catch (error: any) {
      toast({ title: 'Hata', description: error.message, variant: 'destructive' });
    }
  };

  const handlePromoteSuperAdmin = async () => {
    if (!currentUser) return;
    setIsPromoting(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { isSuperAdmin: true });
      toast({
        title: 'Süper Admin Yetkisi Verildi',
        description: 'Sayfayı yenileyin. Artık tüm şirket verilerine erişebilirsiniz.',
      });
      setIsSuperAdminModalOpen(false);
    } catch (error: any) {
      toast({ title: 'Hata', description: error.message, variant: 'destructive' });
    } finally {
      setIsPromoting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <BackButton fallback="/yonetim" />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            Şirket Yönetimi
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Multi-tenancy sistemi ile birden fazla şirketi yönetin.
          </p>
        </div>
        <div className="flex gap-2">
          {!isSuperAdmin && (
            <Button
              variant="outline"
              onClick={() => setIsSuperAdminModalOpen(true)}
              className="border-amber-500 text-amber-500 hover:bg-amber-500/10"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Süper Admin Ol
            </Button>
          )}
          {isSuperAdmin && (
            <Badge variant="secondary" className="text-sm px-3 py-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
              <ShieldCheck className="mr-1 h-3 w-3" />
              Süper Admin
            </Badge>
          )}
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Şirket
          </Button>
        </div>
      </div>

      {/* Aktif şirket bilgisi */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Aktif Şirket</p>
              <p className="text-xs text-muted-foreground">
                {activeCompanyId} — Tüm sorgular bu şirkete ait verilerle filtreleniyor
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Şirket listesi */}
      <Card>
        <CardHeader>
          <CardTitle>Kayıtlı Şirketler</CardTitle>
          <CardDescription>
            {isSuperAdmin
              ? 'Süper admin olarak tüm şirketleri görüntülüyor ve yönetiyorsunuz.'
              : 'Kendi şirketinizi görüntülüyorsunuz.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingCompanies ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : companies.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Henüz şirket kaydı bulunamadı.</p>
              <p className="text-sm">Migration API'yi çalıştırdıktan sonra ISLAB2 şirketi görünecektir.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Şirket Kodu</TableHead>
                  <TableHead>Şirket Adı</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className={company.id === activeCompanyId ? 'bg-primary/5' : ''}
                  >
                    <TableCell className="font-mono font-medium">
                      {company.name}
                      {company.isLegacy && (
                        <Badge variant="outline" className="ml-2 text-xs">Legacy</Badge>
                      )}
                    </TableCell>
                    <TableCell>{company.displayName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{company.description || '—'}</TableCell>
                    <TableCell>
                      {company.isActive ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Aktif</Badge>
                      ) : (
                        <Badge variant="destructive" className="opacity-70">Pasif</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {isSuperAdmin && company.id !== activeCompanyId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => switchCompany(company.id)}
                          >
                            Geç
                          </Button>
                        )}
                        {company.id === activeCompanyId && (
                          <Badge variant="secondary" className="text-xs">Aktif</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(company)}
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        {!company.isLegacy && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleActive(company)}
                            className={company.isActive ? 'text-destructive hover:text-destructive' : 'text-green-500'}
                          >
                            {company.isActive ? 'Devre Dışı' : 'Aktif Et'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Migration Bilgisi */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-amber-400 flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            ISLAB2 Legacy Migration
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Mevcut tüm verileri ISLAB2 şirketine taşımak için migration API&apos;sini kullanın.
            Bu işlem geri alınamaz ve tüm mevcut belgelere <code className="bg-muted px-1 rounded">companyId: &quot;ISLAB2&quot;</code> ekler.
          </p>
          <p>
            API endpoint: <code className="bg-muted px-1 rounded">POST /api/admin/migrate-to-multitenancy</code>
          </p>
          <p className="text-amber-400">
            ⚠️ Bu işlemi sadece bir kez ve sistem bakım modunda yapın. Migration tamamlandıktan sonra tekrar çalıştırmayın.
          </p>
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Şirket Oluştur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Şirket Kodu *</Label>
              <Input
                placeholder="ACME veya ACME_CORP"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value.toUpperCase().replace(/\s+/g, '_') }))}
              />
              <p className="text-xs text-muted-foreground">Sadece büyük harf, rakam ve alt çizgi. Bu kod değiştirilemez.</p>
            </div>
            <div className="space-y-1">
              <Label>Şirket Adı *</Label>
              <Input
                placeholder="ACME Medikal Sistemler A.Ş."
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Açıklama</Label>
              <Input
                placeholder="Opsiyonel açıklama..."
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSaving}>İptal</Button>
            </DialogClose>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Şirket Düzenle: {editingCompany?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Şirket Adı *</Label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Açıklama</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSaving}>İptal</Button>
            </DialogClose>
            <Button onClick={handleEdit} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Super Admin Confirmation Modal */}
      <Dialog open={isSuperAdminModalOpen} onOpenChange={setIsSuperAdminModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <ShieldCheck className="h-5 w-5" />
              Süper Admin Yetkisi
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm">
              Kendinizi süper admin olarak atamak üzeresiniz.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Sistemdeki <strong>tüm şirketlerin</strong> verilerine erişebileceksiniz</li>
              <li>Şirketler arasında geçiş yapabileceksiniz</li>
              <li>Yeni şirket oluşturabileceksiniz</li>
              <li>Bu yetki geri alınabilir (isSuperAdmin: false)</li>
            </ul>
            <p className="text-sm text-amber-400 font-medium">
              ⚠️ Bu işlem Firestore&apos;a yazılacaktır.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPromoting}>İptal</Button>
            </DialogClose>
            <Button
              onClick={handlePromoteSuperAdmin}
              disabled={isPromoting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isPromoting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Onayla, Süper Admin Ol
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
