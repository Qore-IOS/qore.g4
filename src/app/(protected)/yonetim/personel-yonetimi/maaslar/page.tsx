'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Loader2, Users, Upload, Download, Search, X, Pencil, Save } from 'lucide-react';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  writeBatch,
  onSnapshot,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Personnel, Hospital, User } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { Switch } from '@/components/ui/switch';

const COLLECTION = 'personnel';

function parseLabIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw)
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'admin_developer']);

interface FormState {
  id?: string;
  /** Eğer kullanıcıdan seçildiyse User.uid; aksi halde boş (manuel) */
  userId?: string;
  userEmail?: string;
  userRole?: string;
  adSoyad: string;
  pozisyon: string;
  assignedLabIds: string[];
  primaryLabId: string;
  aylikBrutMaas: string;
  aylikYanHaklar: string;
  currency: 'TRY' | 'EUR' | 'USD';
  aktif: boolean;
  baslamaTarihi: string;
}

const EMPTY_FORM: FormState = {
  adSoyad: '',
  pozisyon: '',
  assignedLabIds: [],
  primaryLabId: '',
  aylikBrutMaas: '',
  aylikYanHaklar: '',
  currency: 'TRY',
  aktif: true,
  baslamaTarihi: '',
};

export default function PersonelMaaslarPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();

  const [labs, setLabs] = useState<Hospital[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState({ labs: true, personnel: true, users: true });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Master data — laboratuvarlar
  useEffect(() => {
    (async () => {
      setLoading((p) => ({ ...p, labs: true }));
      try {
        const snap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc')));
        setLabs(
          filterByCompanyScope(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
      } catch (e) {
        console.error('labs fetch error', e);
        toast({ title: 'Hata', description: 'Laboratuvarlar yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading((p) => ({ ...p, labs: false }));
      }
    })();
  }, [toast, currentCompanyId, isSuperAdmin]);

  // Master data — kullanıcılar (admin rolleri hariç)
  useEffect(() => {
    (async () => {
      setLoading((p) => ({ ...p, users: true }));
      try {
        const snap = await getDocs(scopedQuery('users', currentCompanyId, isSuperAdmin));
        const all = filterByCompanyScope(
          snap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() } as User)),
          currentCompanyId,
          isSuperAdmin,
        );
        const filtered = all
          .filter((u) => !ADMIN_ROLES.has(u.role || ''))
          .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', 'tr'));
        setUsers(filtered);
      } catch (e) {
        console.error('users fetch error', e);
        toast({ title: 'Hata', description: 'Kullanıcılar yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading((p) => ({ ...p, users: false }));
      }
    })();
  }, [toast, currentCompanyId, isSuperAdmin]);

  // Personnel listener
  useEffect(() => {
    setLoading((p) => ({ ...p, personnel: true }));
    const q = scopedQuery(COLLECTION, currentCompanyId, isSuperAdmin, orderBy('adSoyad', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPersonnel(
          filterByCompanyScope(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as Personnel)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        setLoading((p) => ({ ...p, personnel: false }));
      },
      (e) => {
        console.error('personnel sub error', e);
        toast({ title: 'Hata', description: 'Personel listesi yüklenemedi.', variant: 'destructive' });
        setLoading((p) => ({ ...p, personnel: false }));
      },
    );
    return () => unsub();
  }, [toast, currentCompanyId, isSuperAdmin]);

  const labMap = useMemo(() => new Map(labs.map((l) => [l.id, l.name])), [labs]);

  const handleSave = async () => {
    const maas = parseFloat(form.aylikBrutMaas.replace(',', '.'));
    if (!form.adSoyad.trim() || form.assignedLabIds.length === 0 || isNaN(maas) || maas <= 0) {
      toast({
        title: 'Eksik Bilgi',
        description: 'Ad Soyad, en az 1 laboratuvar ve aylık maaş gereklidir.',
        variant: 'destructive',
      });
      return;
    }
    const yanHaklar = form.aylikYanHaklar.trim() ? parseFloat(form.aylikYanHaklar.replace(',', '.')) : 0;

    setIsSaving(true);
    try {
      const payload = {
        adSoyad: form.adSoyad.trim(),
        pozisyon: form.pozisyon.trim() || null,
        assignedLabIds: form.assignedLabIds,
        primaryLabId: form.primaryLabId || form.assignedLabIds[0] || null,
        aylikBrutMaas: maas,
        aylikYanHaklar: yanHaklar > 0 ? yanHaklar : 0,
        currency: form.currency,
        aktif: form.aktif,
        baslamaTarihi: form.baslamaTarihi || null,
        userId: form.userId || null,
        userEmail: form.userEmail || null,
        userRole: form.userRole || null,
        updatedAt: serverTimestamp(),
        companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
      };

      if (editingId) {
        await updateDoc(doc(db, COLLECTION, editingId), payload);
        toast({ title: 'Güncellendi', description: 'Personel güncellendi.' });
      } else {
        await addDoc(collection(db, COLLECTION), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast({ title: 'Eklendi', description: 'Personel eklendi.' });
      }
      resetForm();
    } catch (e) {
      console.error('save error', e);
      toast({ title: 'Hata', description: 'Kayıt başarısız.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (p: Personnel) => {
    setEditingId(p.id);
    const u = p.userId ? users.find((x) => x.uid === p.userId) : undefined;
    setForm({
      id: p.id,
      userId: p.userId || '',
      userEmail: u?.email || (p as any).userEmail || '',
      userRole: u?.role || (p as any).userRole || '',
      adSoyad: p.adSoyad || '',
      pozisyon: p.pozisyon || '',
      assignedLabIds: p.assignedLabIds || [],
      primaryLabId: p.primaryLabId || '',
      aylikBrutMaas: String(p.aylikBrutMaas || ''),
      aylikYanHaklar: String(p.aylikYanHaklar || ''),
      currency: (p.currency || 'TRY') as 'TRY' | 'EUR' | 'USD',
      aktif: p.aktif !== false,
      baslamaTarihi: p.baslamaTarihi || '',
    });
    // Scroll to form
    if (typeof window !== 'undefined') {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    }
  };

  /** Bir kullanıcı seçildiğinde formu doldur (yeni personel için) */
  const handleSelectUser = (u: User) => {
    // Aynı kullanıcının zaten maaş kaydı var mı?
    const existing = personnel.find((p) => p.userId === u.uid);
    if (existing) {
      handleEdit(existing);
      return;
    }
    setEditingId(null);
    setForm({
      userId: u.uid,
      userEmail: u.email || '',
      userRole: u.role || '',
      adSoyad: u.name || u.email || '',
      pozisyon: '',
      assignedLabIds: u.assignedLaboratories || [],
      primaryLabId: u.primaryLaboratories?.[0] || u.assignedLaboratories?.[0] || '',
      aylikBrutMaas: '',
      aylikYanHaklar: '',
      currency: 'TRY',
      aktif: true,
      baslamaTarihi: '',
    });
    if (typeof window !== 'undefined') {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu personeli silmek istediğinizden emin misiniz?')) return;
    try {
      await deleteDoc(doc(db, COLLECTION, id));
      toast({ title: 'Silindi', description: 'Personel silindi.' });
    } catch (e) {
      console.error('delete error', e);
      toast({ title: 'Hata', description: 'Silinemedi.', variant: 'destructive' });
    }
  };

  const toggleLab = (labId: string) => {
    setForm((cur) => ({
      ...cur,
      assignedLabIds: cur.assignedLabIds.includes(labId)
        ? cur.assignedLabIds.filter((x) => x !== labId)
        : [...cur.assignedLabIds, labId],
    }));
  };

  // Excel
  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      const dataRows = rows.slice(1).filter((r) => r && r.length >= 3 && r[0]);

      if (dataRows.length === 0) {
        toast({ title: 'Uyarı', description: 'Geçerli veri yok.', variant: 'destructive' });
        return;
      }
      const labByName = new Map(labs.map((l) => [l.name.toLowerCase(), l.id]));

      const batch = writeBatch(db);
      let added = 0;
      let skipped = 0;
      for (const r of dataRows) {
        const adSoyad = String(r[0] || '').trim();
        const pozisyon = String(r[1] || '').trim();
        const labNamesOrIds = parseLabIds(r[2]);
        const aylikBrut = parseFloat(String(r[3] || '0').replace(',', '.'));
        const yanHaklar = parseFloat(String(r[4] || '0').replace(',', '.')) || 0;
        const currency = (String(r[5] || 'TRY').toUpperCase() as 'TRY' | 'EUR' | 'USD') || 'TRY';
        const aktif = String(r[6] ?? 'true').trim().toLowerCase() !== 'false';

        if (!adSoyad || labNamesOrIds.length === 0 || isNaN(aylikBrut) || aylikBrut <= 0) {
          skipped++;
          continue;
        }

        // Lab adı veya id'sini id'ye çevir
        const labIds = labNamesOrIds
          .map((x) => labByName.get(x.toLowerCase()) || (labs.some((l) => l.id === x) ? x : null))
          .filter((x): x is string => !!x);
        if (labIds.length === 0) {
          skipped++;
          continue;
        }

        const ref = doc(collection(db, COLLECTION));
        batch.set(ref, {
          adSoyad,
          pozisyon: pozisyon || null,
          assignedLabIds: labIds,
          primaryLabId: labIds[0],
          aylikBrutMaas: aylikBrut,
          aylikYanHaklar: yanHaklar,
          currency: ['TRY', 'EUR', 'USD'].includes(currency) ? currency : 'TRY',
          aktif,
          createdAt: serverTimestamp(),
          companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
        });
        added++;
      }
      if (added > 0) await batch.commit();
      toast({
        title: 'İçe Aktarma',
        description: `${added} personel eklendi${skipped > 0 ? `, ${skipped} satır atlandı` : ''}.`,
      });
    } catch (e) {
      console.error('import error', e);
      toast({ title: 'Hata', description: 'Excel işlenemedi.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExcelExport = () => {
    const rows = personnel.map((p) => ({
      'Ad Soyad': p.adSoyad,
      'Pozisyon': p.pozisyon || '',
      'Laboratuvarlar (;)': (p.assignedLabIds || []).map((id) => labMap.get(id) || id).join(';'),
      'Aylık Brüt Maaş': p.aylikBrutMaas,
      'Aylık Yan Haklar': p.aylikYanHaklar || 0,
      'Para Birimi': p.currency || 'TRY',
      'Aktif': p.aktif ? 'true' : 'false',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Personel');
    XLSX.writeFile(wb, `personel_maaslar_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadTemplate = () => {
    const tpl = [
      {
        'Ad Soyad': 'Ahmet Yılmaz',
        'Pozisyon': 'Uzman',
        'Laboratuvarlar (;)': 'Lab 1;Lab 2',
        'Aylık Brüt Maaş': 60000,
        'Aylık Yan Haklar': 5000,
        'Para Birimi': 'TRY',
        'Aktif': 'true',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(tpl);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');
    XLSX.writeFile(wb, 'personel_sablonu.xlsx');
  };

  const filtered = useMemo(() => {
    if (!searchTerm) return personnel;
    const t = searchTerm.toLowerCase();
    return personnel.filter((p) => {
      if (p.adSoyad?.toLowerCase().includes(t)) return true;
      if (p.pozisyon?.toLowerCase().includes(t)) return true;
      if ((p.assignedLabIds || []).some((id) => (labMap.get(id) || '').toLowerCase().includes(t))) return true;
      return false;
    });
  }, [personnel, searchTerm, labMap]);

  const totals = useMemo(() => {
    const activeOnly = personnel.filter((p) => p.aktif !== false);
    const sum = activeOnly.reduce((s, p) => s + Number(p.aylikBrutMaas || 0) + Number(p.aylikYanHaklar || 0), 0);
    return { count: activeOnly.length, totalCurrency: 'TRY', total: sum };
  }, [personnel]);

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/yonetim/personel-yonetimi" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-500" />
            Personel & Maaş Yönetimi
          </CardTitle>
          <CardDescription>
            Laboratuvarda çalışan personeli, atandığı laboratuvar(lar)ı ve aylık giderini tanımlayın. Bu veri test
            bazlı maliyet hesabında personel gideri olarak kullanılır.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-4 items-center">
            <Badge variant="outline" className="px-4 py-2 text-base">
              {personnel.length} personel
            </Badge>
            <Badge variant="outline" className="px-4 py-2 text-base bg-blue-50 text-blue-700">
              Aktif: {totals.count}
            </Badge>
            <Badge variant="outline" className="px-4 py-2 text-base bg-green-50 text-green-700">
              Aylık Toplam: ₺{totals.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelImport} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting || loading.labs}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Excel ile İçe Aktar
            </Button>
            <Button variant="outline" onClick={handleExcelExport} disabled={personnel.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Excel'e Aktar
            </Button>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> Şablon İndir
            </Button>
          </div>

          {/* Kullanıcılar — mevcut kullanıcılardan seçim */}
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">Kullanıcılar</CardTitle>
              <CardDescription>
                Sistemdeki kullanıcılardan birini seçerek maaş tanımı oluşturun. Admin rolündeki kullanıcılar
                gösterilmez. Yanlarındaki "Maaş Tanımla" butonuna bastığınızda alttaki formun ilgili alanları otomatik
                doldurulur.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                {loading.users ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Kullanıcılar yükleniyor...
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    Bu firmaya bağlı (admin olmayan) kullanıcı bulunamadı.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad / E-posta</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Atanan Laboratuvarlar</TableHead>
                        <TableHead>Maaş Durumu</TableHead>
                        <TableHead className="text-right w-[160px]">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => {
                        const hasSalary = personnel.some((p) => p.userId === u.uid);
                        const labIds = u.assignedLaboratories || [];
                        return (
                          <TableRow key={u.uid}>
                            <TableCell>
                              <div className="font-medium">{u.name || '-'}</div>
                              {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {u.role || 'user'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {labIds.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {labIds.slice(0, 3).map((id) => (
                                    <Badge key={id} variant="secondary" className="text-xs">
                                      {labMap.get(id) || id}
                                    </Badge>
                                  ))}
                                  {labIds.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{labIds.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {hasSalary ? (
                                <Badge variant="outline" className="text-green-700 border-green-300">
                                  Tanımlı
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-700 border-amber-300">
                                  Eksik
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant={hasSalary ? 'outline' : 'default'} onClick={() => handleSelectUser(u)}>
                                {hasSalary ? (
                                  <>
                                    <Pencil className="h-3 w-3 mr-1" /> Düzenle
                                  </>
                                ) : (
                                  <>
                                    <Plus className="h-3 w-3 mr-1" /> Maaş Tanımla
                                  </>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Form */}
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">
                {editingId ? 'Personeli Güncelle' : form.userId ? `${form.adSoyad} için Maaş Tanımla` : 'Manuel Personel Ekle'}
              </CardTitle>
              {form.userId && (
                <CardDescription>
                  <span className="text-xs">
                    Kullanıcı: <b>{form.adSoyad}</b>
                    {form.userEmail && ` · ${form.userEmail}`}
                    {form.userRole && ` · ${form.userRole}`}
                  </span>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Ad Soyad *</label>
                <Input
                  value={form.adSoyad}
                  onChange={(e) => setForm({ ...form, adSoyad: e.target.value })}
                  disabled={!!form.userId}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Pozisyon</label>
                <Input
                  value={form.pozisyon}
                  onChange={(e) => setForm({ ...form, pozisyon: e.target.value })}
                  placeholder="Uzman / Teknisyen / vb."
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Laboratuvar(lar) *</label>
                <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {form.assignedLabIds.length === 0 ? 'Lab seçin' : `${form.assignedLabIds.length} lab`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Lab ara..." />
                      <CommandList>
                        <CommandEmpty>Lab bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {labs.map((l) => {
                            const checked = form.assignedLabIds.includes(l.id);
                            return (
                              <CommandItem key={l.id} value={l.name} onSelect={() => toggleLab(l.id)}>
                                <Check className={cn('mr-2 h-4 w-4', checked ? 'opacity-100' : 'opacity-0')} />
                                {l.name}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {form.assignedLabIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {form.assignedLabIds.map((id) => (
                      <Badge key={id} variant="secondary" className="gap-1">
                        <span className="text-xs">{labMap.get(id) || id}</span>
                        <button type="button" onClick={() => toggleLab(id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Ana Lab</label>
                <Select
                  value={form.primaryLabId || ''}
                  onValueChange={(v) => setForm({ ...form, primaryLabId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Ana lab (opsiyonel)" />
                  </SelectTrigger>
                  <SelectContent>
                    {form.assignedLabIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {labMap.get(id) || id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Aylık Brüt Maaş *</label>
                <Input
                  value={form.aylikBrutMaas}
                  onChange={(e) => setForm({ ...form, aylikBrutMaas: e.target.value })}
                  inputMode="decimal"
                  placeholder="60000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Aylık Yan Haklar</label>
                <Input
                  value={form.aylikYanHaklar}
                  onChange={(e) => setForm({ ...form, aylikYanHaklar: e.target.value })}
                  inputMode="decimal"
                  placeholder="5000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Para Birimi</label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRY">TRY (₺)</SelectItem>
                    <SelectItem value="EUR">EUR (€)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Başlama Tarihi</label>
                <Input
                  type="date"
                  value={form.baslamaTarihi}
                  onChange={(e) => setForm({ ...form, baslamaTarihi: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={form.aktif} onCheckedChange={(v) => setForm({ ...form, aktif: v })} />
                <span className="text-sm">Aktif</span>
              </div>
              <div className="md:col-span-2 lg:col-span-3 flex justify-end gap-2">
                {editingId && (
                  <Button variant="outline" onClick={resetForm}>
                    İptal
                  </Button>
                )}
                <Button onClick={handleSave} disabled={isSaving || loading.labs}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : editingId ? (
                    <Save className="h-4 w-4 mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  {editingId ? 'Güncelle' : 'Ekle'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Personel ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-lg">
                Personel Listesi
                {searchTerm && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({filtered.length}/{personnel.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {loading.personnel ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? 'Aramayla eşleşen personel yok.' : 'Henüz personel tanımı yok.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad Soyad</TableHead>
                        <TableHead>Pozisyon</TableHead>
                        <TableHead>Laboratuvar(lar)</TableHead>
                        <TableHead className="text-right">Aylık Brüt</TableHead>
                        <TableHead className="text-right">Yan Haklar</TableHead>
                        <TableHead className="text-right">Toplam</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead className="text-right w-[120px]">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((p) => {
                        const cur = p.currency || 'TRY';
                        const symbol = cur === 'TRY' ? '₺' : cur === 'EUR' ? '€' : '$';
                        const toplam = Number(p.aylikBrutMaas || 0) + Number(p.aylikYanHaklar || 0);
                        return (
                          <TableRow key={p.id} className={p.aktif === false ? 'opacity-50' : ''}>
                            <TableCell className="font-medium">{p.adSoyad}</TableCell>
                            <TableCell>{p.pozisyon || '-'}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(p.assignedLabIds || []).map((id) => (
                                  <Badge key={id} variant="outline" className="text-xs">
                                    {labMap.get(id) || id}
                                    {id === p.primaryLabId && <span className="ml-1 text-amber-600">★</span>}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {symbol}
                              {Number(p.aylikBrutMaas).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {p.aylikYanHaklar ? `${symbol}${Number(p.aylikYanHaklar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-semibold font-mono">
                              {symbol}
                              {toplam.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              {p.aktif === false ? (
                                <Badge variant="secondary">Pasif</Badge>
                              ) : (
                                <Badge variant="outline" className="text-green-700 border-green-300">
                                  Aktif
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(p)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
