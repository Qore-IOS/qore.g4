
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, Edit3, Loader2, LogOut, Save, Users, Search, Clock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  documentId,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import BackButton from '@/components/BackButton';
import { getApp } from 'firebase/app';


type AppUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  uid?: string; // Ensure uid is part of the type
};

type PersonnelGroup = {
  id: string;
  name: string;
  memberIds: string[];
  autoLogoutTime?: string; // New field
  createdAt?: any;
  createdBy?: string;
  updatedAt?: any;
  updatedBy?: string;
};

// ---- helpers: chunking for Firestore `in` queries (max 10) ----
const chunk = <T,>(arr: T[], size = 10) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

type PresenceDoc = { state?: 'online'|'offline'; lastChanged?: any };

const GRACE_MS = 2 * 60 * 1000; // 2 minutes

function computeIsOnline(p?: PresenceDoc): boolean {
  if (!p) return false;
  const lc = (p.lastChanged?.toMillis ? p.lastChanged.toMillis() : p.lastChanged) ?? 0;
  const recentlyActive = Date.now() - lc < GRACE_MS;
  // Treat as online if state is 'online' OR offline but recently active (backgrounded)
  return p.state === 'online' || recentlyActive;
}

function usePresenceMap(uids: string[]) {
  const [map, setMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!uids.length) {
      setMap({});
      return;
    }
    const unique = Array.from(new Set(uids)).filter(Boolean);
    const batches = [];
    for (let i = 0; i < unique.length; i += 10) {
      batches.push(unique.slice(i, i + 10));
    }
    const unsubs = batches.map((bucket) =>
      onSnapshot(
        query(collection(db, 'presence'), where(documentId(), 'in', bucket)),
        (snap) => {
          setMap((prev) => {
            const next = { ...prev };
            snap.forEach((d) => (next[d.id] = computeIsOnline(d.data() as PresenceDoc)));
            return next;
          });
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [uids.join('|')]); // uids.join is a stable dependency trick for arrays
  return map;
}

const FUNCTIONS_REGION = 'europe-west1'; // ⬅️ must match functions code

export default function GroupDetailPage() {
  const { isAdmin, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();
  const params = useParams();
  const groupId = Array.isArray(params?.id) ? params.id[0] : params?.id as string;
  const { toast } = useToast();

  const [group, setGroup] = useState<PersonnelGroup | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [autoLogoutTime, setAutoLogoutTime] = useState('');

  // Admin guard
  if (isAdmin === false) {
    return (
      <Card className="m-6">
        <CardHeader>
          <CardTitle className="text-xl font-headline">Yetkisiz Erişim</CardTitle>
        </CardHeader>
        <CardContent>Bu sayfaya erişim yetkiniz bulunmamaktadır.</CardContent>
      </Card>
    );
  }

  // Load group realtime
  useEffect(() => {
    if (!groupId) return;
    const d = doc(db, 'personelGruplari', groupId);
    const unsub = onSnapshot(
      d,
      (snap) => {
        if (!snap.exists()) {
          toast({ title: 'Grup bulunamadı', description: 'Silinmiş olabilir.' });
          router.replace('/yonetim/personel-yonetimi');
          return;
        }
        const data = { id: snap.id, ...(snap.data() as any) } as PersonnelGroup;
        setGroup(data);
        setSelected(new Set(data.memberIds || [])); // seed edit selection
        setAutoLogoutTime(data.autoLogoutTime || '');
        setLoadingGroup(false);
      },
      (err) => {
        toast({ title: 'Okuma hatası', description: err?.message, variant: 'destructive' });
        setLoadingGroup(false);
      }
    );
    return () => unsub();
  }, [groupId, router, toast]);

  // Load users realtime
  useEffect(() => {
    const qUsers = scopedQuery('users', currentCompanyId, isSuperAdmin, orderBy('name'));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const list: AppUser[] = [];
        snap.forEach((d) => list.push({ id: d.id, uid: d.id, ...(d.data() as any) })); // Ensure uid is mapped
        setUsers(list);
        setLoadingUsers(false);
      },
      (err) => {
        toast({ title: 'Kullanıcı yükleme hatası', description: err?.message, variant: 'destructive' });
        setLoadingUsers(false);
      }
    );
    return () => unsub();
  }, [toast]);

  const memberSet = useMemo(() => new Set(group?.memberIds || []), [group]);
  const members = useMemo(() => users.filter((u) => memberSet.has(u.id)), [users, memberSet]);
  
  const presenceMap = usePresenceMap(members.map((m) => m.id));
  const onlineCount = useMemo(() => members.filter(m => presenceMap[m.id]).length, [members, presenceMap]);


  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(s) ||
        (u.email || '').toLowerCase().includes(s) ||
        (u.role || '').toLowerCase().includes(s)
    );
  }, [q, users]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!group) return;
    if (autoLogoutTime && !/^\d{2}:\d{2}$/.test(autoLogoutTime)) {
        return toast({ title: 'Geçersiz Saat Formatı', description: 'Lütfen SS:DD formatında (örn: 17:30) girin.', variant: 'destructive'});
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'personelGruplari', group.id), {
        memberIds: Array.from(selected),
        autoLogoutTime: autoLogoutTime || null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserProfile?.uid || null,
      });
      toast({ title: 'Kaydedildi', description: 'Grup üyeleri güncellendi.' });
      setEdit(false);
    } catch (e: any) {
      toast({ title: 'Hata', description: e?.message || 'Kaydedilemedi', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  // ---- remote sign out (single or bulk) ----
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const revokeFn = httpsCallable<{ uids: string[] }, { success: boolean; processed: number; failed?: string[] }>(
    functions,
    'revokeUserSessions'
  );

  const revokeFor = async (uids: string[]) => {
    if (!uids.length) return;
    try {
      const res = await revokeFn({ uids }).then(r => r.data);
      if (!res.success && res.failed?.length) {
        throw new Error(`Bazı kullanıcılar işlenemedi: ${res.failed.join(', ')}`);
      }
      toast({
        title: 'Oturumlar sonlandırıldı',
        description: `${res.processed} hesap için işlem uygulandı.`,
      });
    } catch (e: any) {
      const msg =
        e?.message ||
        e?.code ||
        'Oturumları sonlandırırken beklenmeyen bir hata oluştu.';
      toast({ title: 'İşlem hatası', description: msg, variant: 'destructive' });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <BackButton fallback="/yonetim/personel-yonetimi" />

        {!edit && (
          <Button
            size="sm"
            variant="destructive"
            className="gap-2"
            onClick={() => revokeFor(members.map(m => m.id))}
            disabled={members.length === 0}
            title="Listedeki tüm hesapların oturumlarını geçersiz kılar"
          >
            <LogOut className="h-4 w-4" />
            Listedeki Tüm Hesaplardan Çıkış Yap
          </Button>
        )}
      </div>
      
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-2xl font-headline flex items-center gap-2">
              <Users className="h-6 w-6" />
              {loadingGroup ? 'Yükleniyor…' : group?.name || 'Grup'}
              <Badge variant="secondary" className="ml-2">
                {group?.memberIds?.length || 0} kişi
              </Badge>
              <Badge variant="secondary" className="ml-2 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                {onlineCount} online
              </Badge>
            </CardTitle>
            {group?.autoLogoutTime && !edit && (
              <div className="flex items-center gap-2 text-sm text-amber-500 font-medium">
                <Clock className="h-4 w-4"/> Otomatik Çıkış Saati: {group.autoLogoutTime}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!edit ? (
              <Button variant="default" onClick={() => setEdit(true)} className="gap-2">
                <Edit3 className="h-4 w-4" /> Düzenle
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setEdit(false); setSelected(new Set(group?.memberIds || [])); setAutoLogoutTime(group?.autoLogoutTime || ''); }}>
                  Vazgeç
                </Button>
                <Button onClick={save} className="gap-2" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin"/>}
                  <Save className="h-4 w-4" /> Kaydet
                </Button>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Search & Edit Fields */}
          {edit && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Kullanıcı Filtrele</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="İsim / e-posta / rol ara"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="flex items-end gap-3">
                 <div className="flex-1">
                    <label className="text-sm font-medium">Oto. Çıkış</label>
                    <Input type="time" value={autoLogoutTime} onChange={e => setAutoLogoutTime(e.target.value)} />
                 </div>
                <Badge variant="outline" className="h-9 flex items-center">
                  {selected.size} seçili
                </Badge>
              </div>
            </div>
          )}

          {/* List */}
          {!edit ? (
            // Readonly Members
            <div className="border rounded-xl">
              <ScrollArea className="h-[520px] p-2">
                {loadingUsers ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Üyeler yükleniyor…
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4">Bu grupta üye yok.</div>
                ) : (
                  <ul className="divide-y">
                    {members.map((m) => {
                       const online = !!presenceMap[m.id];
                       return (
                        <li key={m.id} className="flex items-center justify-between p-3">
                          <div className="leading-tight">
                            <div className="text-sm font-medium flex items-center gap-2">
                              {m.name || 'İsimsiz'}
                               {online ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-600">
                                  • online
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  offline
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{m.email || '-'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {m.role && <Badge variant="outline">{m.role}</Badge>}
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gap-2"
                              onClick={() => revokeFor([m.id])}
                              title="Bu hesabın oturumlarını geçersiz kıl"
                            >
                              <LogOut className="h-4 w-4" />
                              Oturumu Kapat
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </div>
          ) : (
            // Editable: All users with selection
            <div className="border rounded-xl">
              <ScrollArea className="h-[520px] p-2">
                <div className="space-y-1">
                  {filtered.map((u) => {
                    const checked = selected.has(u.id);
                    const online = !!presenceMap[u.id];
                    return (
                      <label
                        key={u.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-accent/50 cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox checked={checked} onCheckedChange={() => toggle(u.id)} />
                          <div className="leading-tight">
                            <div className="text-sm font-medium flex items-center gap-2">
                                {u.name || 'İsimsiz'}
                                {online ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-600">
                                    • online
                                    </span>
                                ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">{u.email || '-'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                           {u.role && <Badge variant="outline">{u.role}</Badge>}
                           {checked && <CheckCircle2 className="h-4 w-4 text-primary" />}
                        </div>
                      </label>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div className="text-sm text-muted-foreground p-4">Sonuç yok.</div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground">
            {group?.updatedAt ? 'Son güncelleme mevcut' : 'Henüz güncelleme yapılmadı.'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

