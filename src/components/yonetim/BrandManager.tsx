'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2, Loader2, Pencil, Mail, Phone, MapPin, Clock } from 'lucide-react';
import { collection, addDoc, deleteDoc, doc, updateDoc } from '../../lib/data/client';
import { db } from '../../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/document-helpers';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BrandDefinition } from '@/lib/types';

interface BrandDraft {
  id?: string;
  name: string;
  numara: string;
  adres: string;
  mail: string;
  tedarikGun: string;
}

const EMPTY_DRAFT: BrandDraft = { name: '', numara: '', adres: '', mail: '', tedarikGun: '' };

const BrandManager: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [items, setItems] = useState<BrandDefinition[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BrandDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await getScopedDocs('def_brands', currentCompanyId, isSuperAdmin);
      setItems(
        docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<BrandDefinition, 'id'>) }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr')),
      );
    } catch (e) {
      toast({ title: 'Hata', description: 'Markalar yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, currentCompanyId, isSuperAdmin, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isDuplicateName = (name: string, ignoreId?: string) =>
    items.some(
      item =>
        item.id !== ignoreId &&
        (item.name || '').trim().localeCompare(name, 'tr-TR', { sensitivity: 'accent' }) === 0,
    );

  const handleQuickAdd = async () => {
    const cleanName = newItemName.trim();
    if (!cleanName) return;
    if (isDuplicateName(cleanName)) {
      toast({ title: 'Bilgi', description: `${cleanName} zaten tanımlarda mevcut.` });
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'def_brands'), { name: cleanName });
      toast({ title: 'Başarılı', description: 'Marka tanımı eklendi.' });
      setNewItemName('');
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Marka eklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openNewDialog = () => {
    setDraft({ ...EMPTY_DRAFT, name: newItemName.trim() });
    setDialogOpen(true);
  };

  const openEditDialog = (brand: BrandDefinition) => {
    setDraft({
      id: brand.id,
      name: brand.name || '',
      numara: brand.numara || '',
      adres: brand.adres || '',
      mail: brand.mail || '',
      tedarikGun: brand.tedarikGun ? String(brand.tedarikGun) : '',
    });
    setDialogOpen(true);
  };

  const handleSaveDraft = async () => {
    const cleanName = draft.name.trim();
    if (!cleanName) {
      toast({ title: 'Hata', description: 'Marka adı boş olamaz.', variant: 'destructive' });
      return;
    }
    if (isDuplicateName(cleanName, draft.id)) {
      toast({ title: 'Bilgi', description: `${cleanName} zaten tanımlarda mevcut.` });
      return;
    }
    const mail = draft.mail.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      toast({ title: 'Hata', description: 'Geçerli bir e-posta adresi girin.', variant: 'destructive' });
      return;
    }

    const tedarikGunRaw = draft.tedarikGun.trim();
    const tedarikGun = tedarikGunRaw === '' ? 0 : Number(tedarikGunRaw);
    if (!Number.isFinite(tedarikGun) || tedarikGun < 0 || tedarikGun > 365) {
      toast({ title: 'Hata', description: 'Tedarik süresi 0-365 gün aralığında olmalı.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: cleanName,
        numara: draft.numara.trim(),
        adres: draft.adres.trim(),
        mail,
        tedarikGun,
      };
      if (draft.id) {
        await updateDoc(doc(db, 'def_brands', draft.id), payload);
        toast({ title: 'Başarılı', description: 'Marka bilgileri güncellendi.' });
      } else {
        await addDoc(collection(db, 'def_brands'), payload);
        toast({ title: 'Başarılı', description: 'Marka eklendi.' });
        setNewItemName('');
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Marka kaydedilemedi.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'def_brands', id));
      toast({ title: 'Silindi', description: 'Marka silindi.', variant: 'destructive' });
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Marka silinemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span>Markalar</span>
          <Button variant="outline" size="sm" onClick={openNewDialog} disabled={loading} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            Detaylı Ekle
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-2">
          <Input
            placeholder="Yeni marka adı..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(); } }}
            disabled={loading}
          />
          <Button onClick={handleQuickAdd} disabled={loading || !newItemName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Hızlı eklemede yalnızca ad kaydedilir. Numara, adres ve mail bilgisi için
          &quot;Detaylı Ekle&quot; veya satırdaki düzenle simgesini kullanın.
        </p>
        <ScrollArea className="h-48 border rounded-md p-2">
          {loading && items.length === 0 ? (
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          ) : items.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground p-4">Tanım bulunmuyor.</p>
          ) : (
            items.map(item => {
              const hasContact = !!(item.numara || item.adres || item.mail);
              return (
                <div key={item.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm block truncate">{item.name}</span>
                    {hasContact ? (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {item.mail && (
                          <span className="inline-flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{item.mail}</span>
                          </span>
                        )}
                        {item.numara && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3 shrink-0" />
                            {item.numara}
                          </span>
                        )}
                        {item.adres && (
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{item.adres}</span>
                          </span>
                        )}
                        {Number(item.tedarikGun) > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            {item.tedarikGun} gün
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">İletişim bilgisi eksik</span>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)} disabled={loading}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} disabled={loading}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Markayı Düzenle' : 'Yeni Marka'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm">Marka Adı *</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Örn. Roche"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Numara</Label>
              <Input
                value={draft.numara}
                onChange={(e) => setDraft(prev => ({ ...prev, numara: e.target.value }))}
                placeholder="Örn. 0212 000 00 00"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Mail Adresi</Label>
              <Input
                type="email"
                value={draft.mail}
                onChange={(e) => setDraft(prev => ({ ...prev, mail: e.target.value }))}
                placeholder="siparis@marka.com"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Tedarikçi siparişleri bu adrese otomatik gönderilir.
              </p>
            </div>
            <div>
              <Label className="text-sm">Tedarik Süresi (gün)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={draft.tedarikGun}
                onChange={(e) => setDraft(prev => ({ ...prev, tedarikGun: e.target.value }))}
                placeholder="Örn. 20"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Siparişin ortalama teslim süresi. Tedarikçi sipariş panelinde acil uyarı eşiğini
                belirler (tedarik süresi + 7 gün). Boş bırakılırsa 15 gün varsayılır.
              </p>
            </div>
            <div>
              <Label className="text-sm">Adres</Label>
              <Textarea
                value={draft.adres}
                onChange={(e) => setDraft(prev => ({ ...prev, adres: e.target.value }))}
                placeholder="Tedarikçi adresi"
                className="mt-1"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>İptal</Button>
            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default BrandManager;
