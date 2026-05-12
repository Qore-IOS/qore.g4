'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Edit3, Trash2, Loader2, Users, Bell, ShieldAlert, Search, Building2, ShieldCheck } from 'lucide-react';
import { collection, getDocs, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { User as AppUser, Hospital, Depot, AppView, ProductCode, Company } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { VIEWS } from '@/lib/constants';
import { Checkbox } from '@/components/ui/checkbox';
import BackButton from '@/components/BackButton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { cn } from '@/lib/utils';

type NotificationTypeUI =
  | 'order_created'
  | 'order_created_from_request'
  | 'transfer_to_lab'
  | 'spare_part_transfer'
  | 'fefo_override'
  | 'fault_report'
  | 'stock_threshold'
  | 'depot_count_completed'
  | 'lab_count_completed'
  | 'fault_opened'
  | 'fault_closed'
  | 'fault_reminder'
  | 'user_request_created'
  | 'user_request_completed'
  | 'custom';

const NOTIFICATION_OPTIONS: { key: NotificationTypeUI; label: string }[] = [
  { key: 'fefo_override', label: 'FEFO/Miad Uyarısı' },
  { key: 'order_created', label: 'Yeni Sipariş' },
  { key: 'order_created_from_request', label: 'Talep Üzerinden Sipariş' },
  { key: 'transfer_to_lab', label: 'Laboratuvara Transfer' },
  { key: 'spare_part_transfer', label: 'Yedek Parça Transferi' },
  { key: 'depot_count_completed', label: 'Depo Sayımı Tamamlandı' },
  { key: 'lab_count_completed', label: 'Laboratuvar Sayımı Tamamlandı' },
  { key: 'fault_opened', label: 'Arıza Kaydı Açıldı' },
  { key: 'fault_closed', label: 'Arıza Kaydı Kapandı' },
  { key: 'fault_reminder', label: 'Arıza Müdahale Hatırlatma (4 saat+)' },
  { key: 'stock_threshold', label: 'Stok Eşik Uyarısı' },
  { key: 'user_request_created', label: 'Kullanıcı Talebi (Yeni Talep)' },
  { key: 'user_request_completed', label: 'Kullanıcı Talebi (Tamamlandı)' },
];

function cleanFirestoreData<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

const ALL_NAV_VIEW_KEYS = VIEWS.filter(v => v.type === 'nav').map(v => v.key as AppView);
const DEFAULT_ROLE_VIEW_PRESETS: Partial<Record<string, AppView[]>> = {
  super_admin: ALL_NAV_VIEW_KEYS,
  admin: ALL_NAV_VIEW_KEYS,
  admin_developer: ALL_NAV_VIEW_KEYS,
  user: ['arama', 'kullanici-talepleri'],
  teknik_servis: ['arama', 'kullanici-talepleri'],
  aplikasyon: ['arama', 'kullanici-talepleri'],
  teknisyen: ['arama', 'kullanici-talepleri'],
  teknik_lojistik: ['arama', 'kullanici-talepleri'],
  lojistik_sorumlusu: ['arama', 'kullanici-talepleri'],
  satin_alma: ['arama', 'kullanici-talepleri'],
  driver: ['arama', 'kullanici-talepleri'],
};

export default function KullaniciPanel() {
  const { toast } = useToast();
  const { signup, currentUserProfile, isSuperAdmin, currentCompanyId } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [labGroups, setLabGroups] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUser, setCurrentUser] = useState<Partial<AppUser & { notificationsEnabled?: boolean; notificationPreferences?: NotificationTypeUI[] }>>({});
  const [password, setPassword] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [uSnap, hSnap, dSnap, pSnap, cSnap, lgSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'companies')),
        getDocs(collection(db, 'def_labGroups')),
      ]);
      setUsers(filterByCompanyScope(
        uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)),
        currentCompanyId,
        isSuperAdmin
      ));
      setHospitals(filterByCompanyScope(
        hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)),
        currentCompanyId,
        isSuperAdmin
      ));
      setDepots(filterByCompanyScope(
        dSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)),
        currentCompanyId,
        isSuperAdmin
      ));
      setCompanies(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Company)));
      setLabGroups(lgSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
      const productCodes = pSnap.docs.map(d => d.data() as ProductCode);
      const uniqueBrands = Array.from(new Set(productCodes.map(p => p.marka).filter(Boolean) as string[]));
      setBrands(uniqueBrands);
    } catch {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredUsers = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((u) => {
      const roleLabel = u.role?.replaceAll('_', ' ') || '';
      const companyName = u.companyId ? companies.find(c => c.id === u.companyId)?.name || u.companyId : 'legacy';
      return [u.name, u.email, u.nfcId, roleLabel, companyName].some(v => (v || '').toLowerCase().includes(normalized));
    });
  }, [users, searchTerm, companies]);

  const openModal = (user?: AppUser) => {
    if (user) {
      setCurrentUser({
        ...user,
        primaryLaboratories: user.primaryLaboratories || [],
        assignedLabGroups: user.assignedLabGroups || [],
        notificationPreferences: (user.notificationPreferences || []) as NotificationTypeUI[],
      });
    } else {
      setCurrentUser({
        role: 'user',
        companyId: currentUserProfile?.companyId || '',
        accessibleViews: DEFAULT_ROLE_VIEW_PRESETS.user,
        notificationsEnabled: false,
        notificationPreferences: [],
        primaryLaboratories: [],
        assignedLabGroups: [],
      });
    }
    setPassword('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!currentUser.email) {
      toast({ title: 'Hata', description: 'E-posta boş olamaz.', variant: 'destructive' });
      return;
    }
    if (currentUser.role === 'admin_developer' && users.some(u => u.role === 'admin_developer' && u.uid !== currentUser.uid)) {
      toast({ title: 'Hata', description: 'Sistemde sadece 1 adet Admin-Geliştirici olabilir.', variant: 'destructive' });
      return;
    }
    if (currentUser.role === 'super_admin' && users.some(u => u.role === 'super_admin' && u.uid !== currentUser.uid)) {
      toast({ title: 'Hata', description: 'Sistemde sadece 1 adet Süper Admin olabilir.', variant: 'destructive' });
      return;
    }

    const validPrimaryLabs = (currentUser.primaryLaboratories || []).filter(
      labId => currentUser.assignedLaboratories?.includes(labId)
    );

    const userData: Partial<AppUser & { notificationsEnabled?: boolean; notificationPreferences?: NotificationTypeUI[] }> = {
      name: currentUser.name,
      role: currentUser.role || 'user',
      companyId: currentUser.companyId || '',
      nfcId: (currentUser.nfcId || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase(),
      accessibleViews: currentUser.accessibleViews || [],
      assignedLaboratories: currentUser.assignedLaboratories,
      primaryLaboratories: validPrimaryLabs,
      assignedDepots: currentUser.assignedDepots,
      assignedBrands: currentUser.assignedBrands,
      assignedLabGroups: currentUser.assignedLabGroups,
      phoneNumber: currentUser.phoneNumber || '',
      notificationsEnabled: currentUser.notificationsEnabled ?? false,
      notificationPreferences: currentUser.notificationsEnabled ? (currentUser.notificationPreferences || []) : [],
    };

    const payload = cleanFirestoreData(userData);

    setIsLoading(true);
    try {
      if (currentUser.uid) {
        await setDoc(doc(db, 'users', currentUser.uid), payload, { merge: true });
        toast({ title: 'Başarılı', description: 'Kullanıcı güncellendi.' });
      } else {
        if (!password) {
          toast({ title: 'Hata', description: 'Yeni kullanıcı için şifre zorunludur.', variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        await signup(currentUser.email, password, withCompanyScope(payload, currentUser.companyId || currentUserProfile?.companyId));
        toast({ title: 'Başarılı', description: 'Yeni kullanıcı oluşturuldu.' });
      }
      fetchData();
      setIsModalOpen(false);
    } catch (error: any) {
      toast({ title: 'Hata', description: `Kayıt sırasında bir sorun oluştu: ${error.message}`, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (uid: string) => {
    if (confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz? Bu işlem, kullanıcının sadece Firestore veritabanı kaydını siler. Girişini engellemek için Firebase Authentication panelinden de silmeniz gerekir.')) {
      await deleteDoc(doc(db, 'users', uid));
      toast({ title: 'Silindi', description: 'Kullanıcı veritabanından silindi.', variant: 'destructive' });
      fetchData();
    }
  };

  const handleCheckboxChange = (view: AppView, checked: boolean) => {
    setCurrentUser(prev => {
      const currentViews = prev.accessibleViews || [];
      if (checked) {
        if (currentViews.includes(view)) return prev;
        return { ...prev, accessibleViews: [...currentViews, view] };
      }
      return { ...prev, accessibleViews: currentViews.filter(v => v !== view) };
    });
  };

  const handleDepotCheckboxChange = (depotId: string, checked: boolean) => {
    setCurrentUser(prev => {
      const currentDepots = prev.assignedDepots || [];
      const newDepots = checked ? [...currentDepots, depotId] : currentDepots.filter(id => id !== depotId);
      return { ...prev, assignedDepots: newDepots };
    });
  };

  const handleBrandCheckboxChange = (brandName: string, checked: boolean) => {
    setCurrentUser(prev => {
      const currentBrands = prev.assignedBrands || [];
      const newBrands = checked ? [...currentBrands, brandName] : currentBrands.filter(name => name !== brandName);
      return { ...prev, assignedBrands: newBrands };
    });
  };

  const handleNfcIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setCurrentUser({ ...currentUser, nfcId: rawValue.substring(0, 8) });
  };

  const handleNotificationPrefChange = (prefKey: NotificationTypeUI, checked: boolean) => {
    setCurrentUser(prev => {
      const currentPrefs = prev.notificationPreferences || [];
      const newPrefs = checked ? [...currentPrefs, prefKey] : currentPrefs.filter(k => k !== prefKey);
      return { ...prev, notificationPreferences: newPrefs };
    });
  };

  const handleRoleChange = (role: string) => {
    setCurrentUser(prev => {
      const shouldApplyPreset = !prev.uid;
      return {
        ...prev,
        role,
        accessibleViews: shouldApplyPreset
          ? (DEFAULT_ROLE_VIEW_PRESETS[role] || DEFAULT_ROLE_VIEW_PRESETS.user || [])
          : prev.accessibleViews,
      };
    });
  };

  const selectedCompany = currentUser.companyId
    ? companies.find(c => c.id === currentUser.companyId)
    : null;

  return (
    <>
      <div className="dashboard-neu-page p-4 md:p-6 space-y-4 md:space-y-6 min-h-screen">
        <BackButton fallback="/yonetim" />

        <Card className="glass-card border-border/60 shadow-xl">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                  <Users className="h-6 w-6 text-teal-500" />
                  Kullanıcı Yönetimi
                </CardTitle>
                <CardDescription className="mt-1">
                  Kullanıcıları uygulamanın geri kalanındaki tasarıma uygun şekilde yönetin; rol, firma ve panel yetkilerini tek noktadan düzenleyin.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {currentUserProfile?.role === 'admin' && !users.some(u => u.role === 'super_admin') && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                    className="dashboard-neu-button"
                    onClick={async () => {
                      if (!currentUserProfile?.uid) return;
                      if (!confirm('Kendinizi Süper Admin olarak atamak istediğinizden emin misiniz? Bu işlem geri alınamaz ve sistemde sadece 1 Süper Admin olabilir.')) return;
                      setIsLoading(true);
                      try {
                        await setDoc(doc(db, 'users', currentUserProfile.uid), { role: 'super_admin' }, { merge: true });
                        toast({ title: 'Başarılı', description: 'Süper Admin rolü atandı. Değişikliklerin uygulanması için sayfayı yenileyin.' });
                        fetchData();
                      } catch (error: any) {
                        toast({ title: 'Hata', description: `Rol atanamadı: ${error.message}`, variant: 'destructive' });
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                  >
                    <ShieldAlert className="mr-2 h-4 w-4" />Süper Admin Ol
                  </Button>
                )}
                <Button onClick={() => openModal()} size="sm" disabled={isLoading} className="dashboard-neu-button">
                  <PlusCircle className="mr-2 h-4 w-4" />Yeni Kullanıcı
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2 relative">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  className="pl-9"
                  placeholder="Ad, e-posta, rol, firma veya NFC ID ile ara"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Card className="dashboard-kpi-mini border-border/50">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Toplam Kullanıcı</p>
                  <p className="text-xl font-semibold">{users.length}</p>
                </CardContent>
              </Card>
              <Card className="dashboard-kpi-mini border-border/50">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Filtrelenen Sonuç</p>
                  <p className="text-xl font-semibold">{filteredUsers.length}</p>
                </CardContent>
              </Card>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <div className="rounded-lg border bg-background/40 overflow-hidden">
                <ScrollArea className="h-[min(62vh,780px)]">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur">
                      <TableRow>
                        <TableHead>Adı</TableHead>
                        <TableHead>E-posta</TableHead>
                        <TableHead>Rolü</TableHead>
                        <TableHead>Firma</TableHead>
                        <TableHead>NFC ID</TableHead>
                        <TableHead className="text-right">İşlemler</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                            Arama kriterlerine uygun kullanıcı bulunamadı.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredUsers.map(u => (
                          <TableRow key={u.uid} className="hover:bg-muted/40">
                            <TableCell className="font-medium">{u.name || '-'}</TableCell>
                            <TableCell>{u.email}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize">
                                {u.role?.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {u.companyId ? companies.find(c => c.id === u.companyId)?.name || u.companyId : <span className="text-muted-foreground">Legacy</span>}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{u.nfcId || '-'}</TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button variant="ghost" size="icon" onClick={() => openModal(u)}><Edit3 className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(u.uid)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-7xl w-[96vw] p-0 overflow-hidden max-h-[92vh] flex flex-col">
          <DialogHeader className="px-6 pt-6 shrink-0">
            <DialogTitle className="text-xl">{currentUser.uid ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı Oluştur'}</DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-4 grid grid-cols-1 xl:grid-cols-3 gap-4 overflow-y-auto flex-1 min-h-0">
            <Card className="xl:col-span-1 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Temel Bilgiler</CardTitle>
                <CardDescription>Kimlik, rol ve firma atamasını bu alandan yapın.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="Adı Soyadı" value={currentUser.name || ''} onChange={(e) => setCurrentUser({ ...currentUser, name: e.target.value })} />
                <Input placeholder="E-posta" type="email" value={currentUser.email || ''} onChange={(e) => setCurrentUser({ ...currentUser, email: e.target.value })} disabled={!!currentUser.uid} />
                {!currentUser.uid && <Input placeholder="Şifre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}

                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Select value={currentUser.role || 'user'} onValueChange={handleRoleChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super_admin" disabled={!isSuperAdmin || users.some(u => u.role === 'super_admin' && u.uid !== currentUser.uid)}>
                        Süper Admin {users.some(u => u.role === 'super_admin' && u.uid !== currentUser.uid) ? '(Mevcut)' : ''}
                      </SelectItem>
                      <SelectItem value="admin_developer" disabled={users.some(u => u.role === 'admin_developer' && u.uid !== currentUser.uid)}>
                        Admin-Geliştirici {users.some(u => u.role === 'admin_developer' && u.uid !== currentUser.uid) ? '(Mevcut)' : ''}
                      </SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="lojistik_sorumlusu">Lojistik Sorumlusu</SelectItem>
                      <SelectItem value="teknik_lojistik">Teknik Lojistik</SelectItem>
                      <SelectItem value="satin_alma">Satın Alma</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
                      <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
                      <SelectItem value="driver">Driver (Şoför)</SelectItem>
                      <SelectItem value="teknisyen">Teknisyen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Firma</Label>
                  <Select value={currentUser.companyId || '__none__'} onValueChange={(value) => setCurrentUser({ ...currentUser, companyId: value === '__none__' ? '' : value })}>
                    <SelectTrigger><SelectValue placeholder="Firma Seçin (Legacy)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Legacy (Tanımsız)</SelectItem>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border p-2">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{selectedCompany ? `Seçili firma: ${selectedCompany.name}` : 'Seçili firma: Legacy (Tanımsız)'}</span>
                  </div>
                </div>

                <Input
                  placeholder="NFC Kart ID (XXXXXXXX)"
                  value={currentUser.nfcId || ''}
                  onChange={handleNfcIdChange}
                  maxLength={8}
                />

                {(currentUser.role === 'teknik_servis' || currentUser.role === 'aplikasyon' || currentUser.role === 'teknisyen') && (
                  <Input
                    placeholder="Telefon Numarası (örn: +905xxxxxxxxx)"
                    value={currentUser.phoneNumber || ''}
                    onChange={(e) => setCurrentUser({ ...currentUser, phoneNumber: e.target.value })}
                  />
                )}

                <ScrollArea className="h-40 border rounded-md p-2">
                  <h4 className="font-medium text-sm mb-2">Atanan Markalar</h4>
                  {brands.map(b => (
                    <div key={b} className="flex items-center space-x-2 mb-1">
                      <Checkbox
                        id={`brand-${b}`}
                        checked={currentUser.assignedBrands?.includes(b)}
                        onCheckedChange={(checked) => handleBrandCheckboxChange(b, !!checked)}
                      />
                      <label htmlFor={`brand-${b}`} className="text-sm">{b}</label>
                    </div>
                  ))}
                </ScrollArea>

                <Card className="border-border/60">
                  <CardHeader className="p-4">
                    <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />Bildirim Tercihleri</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="notifications-enabled"
                        checked={currentUser.notificationsEnabled}
                        onCheckedChange={(checked) => setCurrentUser({ ...currentUser, notificationsEnabled: checked })}
                      />
                      <Label htmlFor="notifications-enabled">Bildirimlere İzin Ver</Label>
                    </div>
                    <div className={!currentUser.notificationsEnabled ? 'opacity-50 pointer-events-none' : ''}>
                      <h4 className="font-medium text-sm mb-2">İzin Verilen Bildirim Türleri</h4>
                      <ScrollArea className="h-32 border rounded-md p-2">
                        {NOTIFICATION_OPTIONS.map(type => (
                          <div key={type.key} className="flex items-center space-x-2 mb-1">
                            <Checkbox
                              id={`notif-${type.key}`}
                              checked={currentUser.notificationPreferences?.includes(type.key)}
                              onCheckedChange={(checked) => handleNotificationPrefChange(type.key, !!checked)}
                              disabled={!currentUser.notificationsEnabled}
                            />
                            <label htmlFor={`notif-${type.key}`} className="text-sm">{type.label}</label>
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>

            <Card className="xl:col-span-2 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Yetkiler ve Atamalar</CardTitle>
                <CardDescription>Panel erişimleri ve kurum/depo atamalarını bu bölümden yönetin.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ScrollArea className="h-[56vh] border rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-sm">Panel İzinleri</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setCurrentUser(prev => ({
                        ...prev,
                        accessibleViews: DEFAULT_ROLE_VIEW_PRESETS[(prev.role || 'user')] || DEFAULT_ROLE_VIEW_PRESETS.user || [],
                      }))}
                    >
                      Rol Varsayılanlarını Uygula
                    </Button>
                  </div>
                  {VIEWS.filter(v => v.type === 'nav').map(view => (
                    <div key={view.key} className={cn('flex items-center space-x-2 mb-1 rounded px-1 py-1', currentUser.accessibleViews?.includes(view.key as AppView) && 'bg-muted/60')}>
                      <Checkbox
                        id={view.key}
                        checked={currentUser.accessibleViews?.includes(view.key as AppView)}
                        onCheckedChange={(checked) => handleCheckboxChange(view.key as AppView, !!checked)}
                      />
                      <label htmlFor={view.key} className="text-sm">{view.label}</label>
                    </div>
                  ))}
                </ScrollArea>

                <div className="flex flex-col gap-4 h-[56vh]">
                  <ScrollArea className="flex-1 min-h-0 border rounded-md p-2">
                    <h4 className="font-medium text-sm mb-2">Atanan Laboratuvarlar</h4>
                    {hospitals.filter(h => h.id).map(h => (
                      <div key={h.id} className="flex items-center space-x-2 mb-1">
                        <Checkbox
                          id={`lab-${h.id}`}
                          checked={currentUser.assignedLaboratories?.includes(h.id)}
                          onCheckedChange={(checked) => {
                            const currentLabs = currentUser.assignedLaboratories || [];
                            const newLabs = checked ? [...currentLabs, h.id] : currentLabs.filter(id => id !== h.id);
                            const currentPrimaryLabs = currentUser.primaryLaboratories || [];
                            const newPrimaryLabs = checked ? currentPrimaryLabs : currentPrimaryLabs.filter(id => id !== h.id);
                            setCurrentUser({ ...currentUser, assignedLaboratories: newLabs, primaryLaboratories: newPrimaryLabs });
                          }}
                        />
                        <label htmlFor={`lab-${h.id}`} className="text-sm">{h.name}</label>
                      </div>
                    ))}
                  </ScrollArea>

                  {(currentUser.role === 'teknik_servis' || currentUser.role === 'aplikasyon') && (
                    <ScrollArea className="flex-1 min-h-0 border rounded-md p-2 bg-blue-50/50 dark:bg-blue-950/20">
                      <h4 className="font-medium text-sm mb-2 text-blue-700 dark:text-blue-400">
                        Ana Sorumluluk Laboratuvarları
                        <span className="text-xs text-muted-foreground ml-1">(Performans puanı için)</span>
                      </h4>
                      {(currentUser.assignedLaboratories || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Önce atanan laboratuvarları seçin</p>
                      ) : (
                        hospitals.filter(h => currentUser.assignedLaboratories?.includes(h.id)).map(h => (
                          <div key={h.id} className="flex items-center space-x-2 mb-1">
                            <Checkbox
                              id={`primary-lab-${h.id}`}
                              checked={currentUser.primaryLaboratories?.includes(h.id)}
                              onCheckedChange={(checked) => {
                                const currentPrimaryLabs = currentUser.primaryLaboratories || [];
                                const newPrimaryLabs = checked ? [...currentPrimaryLabs, h.id] : currentPrimaryLabs.filter(id => id !== h.id);
                                setCurrentUser({ ...currentUser, primaryLaboratories: newPrimaryLabs });
                              }}
                            />
                            <label htmlFor={`primary-lab-${h.id}`} className="text-sm">{h.name}</label>
                          </div>
                        ))
                      )}
                    </ScrollArea>
                  )}

                  <ScrollArea className="flex-1 min-h-0 border rounded-md p-2">
                    <h4 className="font-medium text-sm mb-2">Atanan Depolar</h4>
                    {depots.filter(d => d.id).map(d => (
                      <div key={d.id} className="flex items-center space-x-2 mb-1">
                        <Checkbox
                          id={`depot-${d.id}`}
                          checked={currentUser.assignedDepots?.includes(d.id)}
                          onCheckedChange={(checked) => handleDepotCheckboxChange(d.id, !!checked)}
                        />
                        <label htmlFor={`depot-${d.id}`} className="text-sm">{d.name}</label>
                      </div>
                    ))}
                  </ScrollArea>

                  {currentUser.role === 'lojistik_sorumlusu' && (
                    <ScrollArea className="flex-1 min-h-0 border rounded-md p-2 bg-teal-50/50 dark:bg-teal-950/20">
                      <h4 className="font-medium text-sm mb-2 text-teal-700 dark:text-teal-400">Atanan Laboratuvar Grupları</h4>
                      {labGroups.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Henüz laboratuvar grubu tanımlanmamış</p>
                      ) : (
                        labGroups.map(lg => {
                          const checked = currentUser.assignedLabGroups?.includes(lg.name)
                            || currentUser.assignedLabGroups?.includes(lg.id);
                          return (
                            <div key={lg.id} className="flex items-center space-x-2 mb-1">
                              <Checkbox
                                id={`lg-${lg.id}`}
                                checked={checked}
                                onCheckedChange={(isChecked) => {
                                  const currentGroups = (currentUser.assignedLabGroups || [])
                                    .filter(k => k !== lg.id && k !== lg.name);
                                  const newGroups = isChecked ? [...currentGroups, lg.name] : currentGroups;
                                  setCurrentUser({ ...currentUser, assignedLabGroups: newGroups });
                                }}
                              />
                              <label htmlFor={`lg-${lg.id}`} className="text-sm">{lg.name}</label>
                            </div>
                          );
                        })
                      )}
                    </ScrollArea>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="px-6 pb-6 pt-3 shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
