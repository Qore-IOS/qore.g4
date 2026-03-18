
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Edit3, Trash2, Loader2, Users, Bell, ShieldAlert } from 'lucide-react';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { User as AppUser, Hospital, Depot, AppView, ProductCode } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { VIEWS } from '@/lib/constants';
import { Checkbox } from '@/components/ui/checkbox';
import BackButton from '@/components/BackButton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

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
    { key: 'stock_threshold', label: 'Stok Eşik Uyarısı' },
    { key: 'user_request_created', label: 'Kullanıcı Talebi (Yeni Talep)' },
    { key: 'user_request_completed', label: 'Kullanıcı Talebi (Tamamlandı)' },
];


/**
 * Removes properties with `undefined` values from an object.
 * This is useful for cleaning data before sending it to Firestore.
 */
function cleanFirestoreData<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export default function KullaniciPanel() {
  const { toast } = useToast();
  const { signup, currentUserProfile, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<Partial<AppUser & { notificationsEnabled?: boolean; notificationPreferences?: NotificationTypeUI[] }>>({});
  const [password, setPassword] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [uSnap, hSnap, dSnap, pSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes'))
      ]);
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)));
      setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setDepots(dSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      const productCodes = pSnap.docs.map(d => d.data() as ProductCode);
      const uniqueBrands = Array.from(new Set(productCodes.map(p => p.marka).filter(Boolean) as string[]));
      setBrands(uniqueBrands);

    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openModal = (user?: AppUser) => {
    if (user) {
      setCurrentUser({
        ...user,
        primaryLaboratories: user.primaryLaboratories || [],
        notificationPreferences: (user.notificationPreferences || []) as NotificationTypeUI[],
      });
    } else {
      setCurrentUser({ notificationsEnabled: false, notificationPreferences: [], primaryLaboratories: [] });
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
    // Primary laboratories should be a subset of assigned laboratories
    const validPrimaryLabs = (currentUser.primaryLaboratories || []).filter(
      labId => currentUser.assignedLaboratories?.includes(labId)
    );

    const userData: Partial<AppUser & { notificationsEnabled?: boolean; notificationPreferences?: NotificationTypeUI[] }> = {
      name: currentUser.name,
      role: currentUser.role || 'user',
      nfcId: (currentUser.nfcId || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase(),
      accessibleViews: currentUser.accessibleViews,
      assignedLaboratories: currentUser.assignedLaboratories,
      primaryLaboratories: validPrimaryLabs,
      assignedDepots: currentUser.assignedDepots,
      assignedBrands: currentUser.assignedBrands,
      phoneNumber: currentUser.phoneNumber || '',
      notificationsEnabled: currentUser.notificationsEnabled ?? false,
      notificationPreferences: currentUser.notificationsEnabled ? (currentUser.notificationPreferences || []) : [],
    };
    
    const payload = cleanFirestoreData(userData);

    setIsLoading(true);
    try {
      if (currentUser.uid) { // Editing existing user
        await setDoc(doc(db, 'users', currentUser.uid), payload, { merge: true });
        toast({ title: 'Başarılı', description: 'Kullanıcı güncellendi.' });
      } else { // Creating new user
        if (!password) {
          toast({ title: 'Hata', description: 'Yeni kullanıcı için şifre zorunludur.', variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        await signup(currentUser.email, password, payload);
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
        if(checked) {
            return {...prev, accessibleViews: [...currentViews, view]};
        } else {
            return {...prev, accessibleViews: currentViews.filter(v => v !== view)};
        }
    });
  };

  const handleDepotCheckboxChange = (depotId: string, checked: boolean) => {
    setCurrentUser(prev => {
      const currentDepots = prev.assignedDepots || [];
      const newDepots = checked ? [...currentDepots, depotId] : currentDepots.filter(id => id !== depotId);
      return {...prev, assignedDepots: newDepots};
    });
  };

  const handleBrandCheckboxChange = (brandName: string, checked: boolean) => {
    setCurrentUser(prev => {
      const currentBrands = prev.assignedBrands || [];
      const newBrands = checked ? [...currentBrands, brandName] : currentBrands.filter(name => name !== brandName);
      return {...prev, assignedBrands: newBrands};
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
        return {...prev, notificationPreferences: newPrefs };
    });
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <Users className="mr-2 h-6 w-6 text-teal-500" />
                Kullanıcı Yönetimi
              </CardTitle>
              <CardDescription>Kullanıcıları yönetin, rollerini ve erişim izinlerini ayarlayın.</CardDescription>
            </div>
            <div className="flex gap-2">
              {currentUserProfile?.role === 'admin' && !users.some(u => u.role === 'super_admin') && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isLoading}
                  className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
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
              <Button onClick={() => openModal()} size="sm" disabled={isLoading}><PlusCircle className="mr-2 h-4 w-4" />Yeni Kullanıcı</Button>
            </div>
          </CardHeader>
          <CardContent>
             {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader><TableRow><TableHead>Adı</TableHead><TableHead>E-posta</TableHead><TableHead>Rolü</TableHead><TableHead>NFC ID</TableHead><TableHead className="text-right">İşlemler</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.uid}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell className="capitalize">{u.role?.replace('_', ' ')}</TableCell>
                        <TableCell className="font-mono text-xs">{u.nfcId || '-'}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openModal(u)}><Edit3 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(u.uid)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader><DialogTitle>{currentUser.uid ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-4 md:col-span-1">
                <Input placeholder="Adı Soyadı" value={currentUser.name || ''} onChange={(e) => setCurrentUser({ ...currentUser, name: e.target.value })} />
                <Input placeholder="E-posta" type="email" value={currentUser.email || ''} onChange={(e) => setCurrentUser({ ...currentUser, email: e.target.value })} disabled={!!currentUser.uid} />
                {!currentUser.uid && <Input placeholder="Şifre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
                <Select value={currentUser.role || 'user'} onValueChange={(value) => setCurrentUser({ ...currentUser, role: value as any })}>
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
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Bell className="h-4 w-4"/>
                            Bildirim Tercihleri
                        </CardTitle>
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
            </div>
            <div className="space-y-2 md:col-span-2 grid grid-cols-2 gap-4">
                <ScrollArea className="h-[calc(70vh-100px)] border rounded-md p-2">
                    <h4 className="font-medium text-sm mb-2">Panel İzinleri</h4>
                    {VIEWS.filter(v => v.type === 'nav').map(view => (
                        <div key={view.key} className="flex items-center space-x-2 mb-1">
                            <Checkbox
                                id={view.key}
                                checked={currentUser.accessibleViews?.includes(view.key as AppView)}
                                onCheckedChange={(checked) => handleCheckboxChange(view.key as AppView, !!checked)}
                            />
                            <label htmlFor={view.key} className="text-sm">{view.label}</label>
                        </div>
                    ))}
                </ScrollArea>
                <div className="flex flex-col gap-4 h-[calc(70vh-100px)]">
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
                                        // Also remove from primaryLaboratories if unchecked
                                        const currentPrimaryLabs = currentUser.primaryLaboratories || [];
                                        const newPrimaryLabs = checked ? currentPrimaryLabs : currentPrimaryLabs.filter(id => id !== h.id);
                                        setCurrentUser({...currentUser, assignedLaboratories: newLabs, primaryLaboratories: newPrimaryLabs});
                                    }}
                                />
                                <label htmlFor={`lab-${h.id}`} className="text-sm">{h.name}</label>
                            </div>
                        ))}
                    </ScrollArea>
                    {/* Ana Sorumluluk Laboratuvarları - sadece teknik_servis ve aplikasyon için */}
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
                                                setCurrentUser({...currentUser, primaryLaboratories: newPrimaryLabs});
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
                </div>
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
