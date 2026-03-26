'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Users, Search, History } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import BackButton from '@/components/BackButton';
import Link from 'next/link';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';

type AppUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
};

type PersonnelGroup = {
  id: string;
  name: string;
  memberIds: string[];
  autoLogoutTime?: string; // New field
  createdAt?: any;
  createdBy?: string;
};

export default function OturumYonetimiPage() {
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [groups, setGroups] = useState<PersonnelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Fetch users
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      const list = filterByCompanyScope(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as AppUser)),
        currentCompanyId,
        isSuperAdmin
      );
      setUsers(list);
      setLoading(false);
    }, (err) => {
        console.error(err);
        setLoading(false);
    });
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  // Fetch existing groups
  useEffect(() => {
    const q = query(collection(db, 'personelGruplari'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = filterByCompanyScope(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as PersonnelGroup)),
        currentCompanyId,
        isSuperAdmin
      );
      setGroups(list);
    });
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  return (
    <div className="p-6 space-y-6">
      <BackButton fallback="/yonetim/personel-yonetimi" />
      <div className="flex items-center justify-between">
        <CardTitle className="text-2xl font-headline flex items-center gap-2">
          <Users className="h-6 w-6" />
          Oturum ve Grup Yönetimi
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/yonetim/personel-hareket-ekstresi')}
          >
            <History className="h-4 w-4 mr-2" />
            Personel Hareket Ekstresi
          </Button>
          <GroupDialog users={users} currentUserId={currentUserProfile?.uid || ''} />
        </div>
      </div>

      <Separator />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-headline">Mevcut Gruplar</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz bir grup oluşturulmadı.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((g) => (
                <Link key={g.id} href={`/yonetim/personel/${g.id}`} className="block">
                  <Card className="bg-card/60 hover:bg-accent/30 transition-colors cursor-pointer">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{g.name}</div>
                        <Badge variant="secondary">{g.memberIds?.length || 0} kişi</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                          Oluşturan: {users.find(u => u.id === g.createdBy)?.name || g.createdBy || '-'}
                      </div>
                       {g.autoLogoutTime && (
                        <div className="text-xs text-amber-500 font-medium">
                          Otomatik Çıkış: {g.autoLogoutTime}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupDialog({ users, currentUserId }: { users: AppUser[]; currentUserId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [autoLogoutTime, setAutoLogoutTime] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(s) ||
        (u.email || '').toLowerCase().includes(s)
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

  const allChecked = filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  const someChecked = filtered.some((u) => selected.has(u.id)) && !allChecked;

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        filtered.forEach((u) => next.delete(u.id));
      } else {
        filtered.forEach((u) => next.add(u.id));
      }
      return next;
    });
  };

  const onSave = async () => {
    if (!groupName.trim()) {
      return toast({ title: 'Grup adı gerekli', description: 'Lütfen bir grup adı girin.' });
    }
    if (selected.size === 0) {
      return toast({ title: 'Üye seçilmedi', description: 'En az bir kullanıcı seçin.' });
    }
    if (autoLogoutTime && !/^d{2}:d{2}$/.test(autoLogoutTime)) {
        return toast({ title: 'Geçersiz Saat Formatı', description: 'Lütfen SS:DD formatında (örn: 17:30) girin.', variant: 'destructive'});
    }
    try {
      setSaving(true);
      await addDoc(collection(db, 'personelGruplari'), withCompanyScope({
        name: groupName.trim(),
        memberIds: Array.from(selected),
        autoLogoutTime: autoLogoutTime || null,
        createdAt: serverTimestamp(),
        createdBy: currentUserId || null,
      }, currentCompanyId));
      setSaving(false);
      setOpen(false);
      setGroupName('');
      setAutoLogoutTime('');
      setSelected(new Set());
      toast({
        title: 'Gruplandırma kaydedildi',
        description: 'Grup başarıyla oluşturuldu.',
      });
    } catch (e: any) {
      setSaving(false);
      toast({
        title: 'Hata',
        description: e?.message || 'Grup kaydetme sırasında bir hata oluştu.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" variant="default">
          <Plus className="h-4 w-4" />
          Personel Gruplandır
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yeni Grup Oluştur</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Grup Adı</label>
              <Input
                placeholder="Örn: Ameliyathane Ekibi"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
             <div>
              <label className="text-sm font-medium">Otomatik Çıkış Saati (opsiyonel)</label>
              <Input
                type="time"
                value={autoLogoutTime}
                onChange={(e) => setAutoLogoutTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Kullanıcı Ara</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="İsim veya e-posta"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              checked={allChecked}
              onCheckedChange={toggleAll}
              aria-checked={allChecked ? 'true' : someChecked ? 'mixed' : 'false'}
            />
            <span className="text-sm">Filtrelenmiş hepsini seç</span>
            <Badge variant="secondary">{selected.size} seçili</Badge>
          </div>

          <div className="border rounded-xl">
            <ScrollArea className="h-72 p-2">
              <div className="space-y-1">
                {filtered.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-accent/50 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selected.has(u.id)}
                        onCheckedChange={() => toggle(u.id)}
                      />
                      <div className="leading-tight">
                        <div className="text-sm font-medium">{u.name || 'İsimsiz'}</div>
                        <div className="text-xs text-muted-foreground">{u.email || '-'}</div>
                      </div>
                    </div>
                    {u.role && <Badge variant="outline">{u.role}</Badge>}
                  </label>
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm text-muted-foreground p-4">Sonuç yok.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
