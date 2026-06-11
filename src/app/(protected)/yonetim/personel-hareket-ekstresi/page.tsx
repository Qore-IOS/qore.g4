'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, getDocs, query, where, orderBy, limit, startAfter,
  DocumentData, Query, QueryConstraint, QueryDocumentSnapshot
} from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, History, User as UserIcon, Search, Download, ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';

type AppUser = {
  uid: string;
  name?: string;
  email?: string;
  role?: string;
  createdAt?: any;
};

type ActivityItem = {
  id: string;
  ts: Date;
  type:
    | 'MAL_KABUL'
    | 'SIPARIS_OLUSTURMA'
    | 'SIPARIS_TOPLAMA'
    | 'SIPARIS_KARSILAMA'
    | 'SEVKIYAT'
    | 'TUKETIM'
    | 'DEPO_SAYIM'
    | 'DEPO_SAYIM_CHECKPOINT'
    | 'DEPO_SAYIM_TAMAMLANDI'
    | 'MANUEL_STOK'
    | 'ARAMA'
    | 'ARIZA_ACILDI'
    | 'ARIZA_KAPANDI'
    | 'TANIMLAMA'
    | 'DIGER';
  title: string;
  subtitle?: string;
  meta?: Record<string, any>;
  ref?: { collection: string; docId?: string };
};

const TYPE_LABEL: Record<ActivityItem['type'], string> = {
  MAL_KABUL: 'Mal Kabul',
  SIPARIS_OLUSTURMA: 'Sipariş Oluşturma',
  SIPARIS_TOPLAMA: 'Sipariş Toplama Başlatma',
  SIPARIS_KARSILAMA: 'Sipariş Karşılama',
  SEVKIYAT: 'Sevkiyat / Transfer',
  TUKETIM: 'Ürün Kullanım',
  DEPO_SAYIM: 'Depo Sayım (Başlatma / Katılım)',
  DEPO_SAYIM_CHECKPOINT: 'Depo Sayım Checkpoint',
  DEPO_SAYIM_TAMAMLANDI: 'Depo Sayım Tamamlandı',
  MANUEL_STOK: 'Stok Yönetimi - Manuel Değişim',
  ARAMA: 'Arama',
  ARIZA_ACILDI: 'Arıza Kaydı Açıldı',
  ARIZA_KAPANDI: 'Arıza Kaydı Kapandı',
  TANIMLAMA: 'Yönetim Tanımlama',
  DIGER: 'Diğer',
};

const LOG_COLLECTION_CANDIDATES = ['auditLogs', 'activityLogs', 'systemLogs', 'logs'] as const;
type LogDoc = {
  userId: string;
  ts?: any;            // preferred timestamp field
  timestamp?: any;     // alt timestamp
  createdAt?: any;     // alt timestamp
  action?: string;     // e.g. 'order/create', 'order/delete', 'shipment/create', ...
  module?: string;     // e.g. 'orders', 'shipments'
  entity?: string;     // e.g. 'order'
  entityId?: string;
  details?: any;       // free-form
  title?: string;      // optional pre-rendered title
  subtitle?: string;   // optional pre-rendered subtitle
  ref?: { collection?: string; docId?: string };
};

function toDateAny(v: any): Date {
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function normalizeLogToActivity(d: (LogDoc & { id: string })): ActivityItem {
  const ts = toDateAny(d.ts || d.timestamp || d.createdAt);
  const action = (d.action || `${d.module || d.entity || 'other'}/other`).toLowerCase();

  let type: ActivityItem['type'] = 'DIGER';
  let title = d.title || '';
  let subtitle = d.subtitle || '';

  const entity = (d.entity || (d.module === 'orders' ? 'order' : d.module))?.toString().toLowerCase();

  if (action.startsWith('order/create') || (entity === 'order' && action.includes('create'))) {
    type = 'SIPARIS_OLUSTURMA';
    title ||= `Sipariş oluşturdu`;
    subtitle ||= d.details?.kurumAdi || d.details?.recipientHospital || '';
  } else if (action.startsWith('order/pick') || action.includes('picking_start')) {
    type = 'SIPARIS_TOPLAMA';
    title ||= `Sipariş toplamaya başladı`;
    subtitle ||= `Sipariş: ${d.entityId || d.details?.orderId || ''}`;
  } else if (action.startsWith('order/transfer') || action.includes('fulfill') || action.includes('close')) {
    type = 'SIPARIS_KARSILAMA';
    title ||= `Siparişi karşıladı / aktardı`;
    subtitle ||= `Sipariş: ${d.entityId || d.details?.orderId || ''}`;
  } else if (action.startsWith('order/delete') || action.includes('cancel')) {
    type = 'TANIMLAMA';
    title ||= `Sipariş sildi / iptal etti`;
    subtitle ||= `Sipariş: ${d.entityId || d.details?.orderId || ''}`;
  }

  else if (action.startsWith('shipment/create') || action.startsWith('transfer/create')) {
    type = 'SEVKIYAT';
    title ||= d.details?.orderId === 'DIREKT_TRANSFER' ? `Direkt transfer yaptı` : `Sevkiyat oluşturdu`;
    subtitle ||= d.details?.recipientHospital || '';
  }

  else if (action.startsWith('consumption/create') || action.startsWith('usage/create')) {
    type = 'TUKETIM';
    title ||= `Tüketim kaydı`;
    subtitle ||= `${d.details?.stokAdi || d.details?.stokKodu || ''} | ${d.details?.laboratoryName || ''}`;
  }

  else if (action.startsWith('count/start')) {
    type = 'DEPO_SAYIM';
    title ||= `Depo sayımı başlattı`;
    subtitle ||= d.details?.depotName || '';
  } else if (action.startsWith('count/checkpoint')) {
    type = 'DEPO_SAYIM_CHECKPOINT';
    title ||= `Depo sayımı ara kayıt`;
    subtitle ||= d.details?.depotName || '';
  } else if (action.startsWith('count/finish') || action.startsWith('count/complete')) {
    type = 'DEPO_SAYIM_TAMAMLANDI';
    title ||= `Depo sayımını tamamladı`;
    subtitle ||= d.details?.depotName || '';
  }

  else if (action.startsWith('stock/manual_adjust') || action.startsWith('stock/manual')) {
    type = 'MANUEL_STOK';
    title ||= `Manuel stok değişimi`;
    subtitle ||= `${d.details?.item?.stokAdi || ''} ${d.details?.previousQuantity ?? ''} → ${d.details?.newQuantity ?? ''}`;
  }

  else if (action.startsWith('search/query')) {
    type = 'ARAMA';
    title ||= `Arama yaptı: "${d.details?.query || ''}"`;
  }

  else if (action.startsWith('fault/open')) {
    type = 'ARIZA_ACILDI';
    title ||= `Arıza kaydı açtı`;
    subtitle ||= d.details?.title || d.details?.deviceName || '';
  } else if (action.startsWith('fault/close')) {
    type = 'ARIZA_KAPANDI';
    title ||= `Arıza kaydını kapattı`;
    subtitle ||= d.details?.title || d.details?.deviceName || '';
  }

  else if (action.startsWith('intake/create') || action.startsWith('mal_kabul/create')) {
    type = 'MAL_KABUL';
    title ||= `${d.details?.stokAdi || d.details?.stokKodu || 'Mal'} stoğa eklendi`;
    subtitle ||= `Depo: ${d.details?.depotName || ''} | Seri: ${d.details?.seriNumarasi || ''}`;
  }

  else if (action.startsWith('admin/define') || action.startsWith('definition/')) {
    type = 'TANIMLAMA';
    title ||= `Yönetim tanımlaması yaptı`;
    subtitle ||= `${d.details?.key || d.details?.name || ''}`;
  }

  if (!title) title = (d.title || d.action || 'Diğer işlem');

  return {
    id: d.id,
    ts,
    type,
    title,
    subtitle,
    meta: d.details || {},
    ref: d.ref?.collection ? { collection: d.ref.collection!, docId: d.ref.docId } : undefined
  };
}

async function fetchAllLogsForUserFromCollection(
  collName: string,
  uid: string,
  currentCompanyId: string | null,
  isSuperAdmin: boolean,
  batchSize = 500,
) {
  const items: (LogDoc & { id: string })[] = [];

  try {
    let last: QueryDocumentSnapshot<DocumentData> | undefined;
    while (true) {
      const extra: QueryConstraint[] = [
        where('userId', '==', uid),
        orderBy('ts', 'desc'),
        orderBy('__name__', 'desc'),
        limit(batchSize),
      ];
      if (last) extra.push(startAfter(last));
      const qy = scopedQuery(collName, currentCompanyId, isSuperAdmin, ...extra);
      const snap = await getDocsResilient(qy);
      if (snap.empty) break;
      snap.docs.forEach(d => items.push({ id: d.id, ...(d.data() as any) }));
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < batchSize) break;
    }
    return items;
  } catch (err) {
    console.warn(`Ordered query for ${collName} failed, falling back to unordered scan.`, err);
    let last: QueryDocumentSnapshot<DocumentData> | undefined;
    while (true) {
      const extra: QueryConstraint[] = [
        where('userId', '==', uid),
        limit(batchSize),
      ];
      if (last) extra.push(startAfter(last));
      const qy = scopedQuery(collName, currentCompanyId, isSuperAdmin, ...extra);
      const snap = await getDocsResilient(qy);
      if (snap.empty) break;
      snap.docs.forEach(d => items.push({ id: d.id, ...(d.data() as any) }));
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < batchSize) break;
    }
    return items;
  }
}

export default function PersonelHareketEkstresiPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [typeFilter, setTypeFilter] = useState<ActivityItem['type'][]>([]);
  const [q, setQ] = useState('');
  const [ascending, setAscending] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      try {
        const snap = await getDocsResilient(scopedQuery('users', currentCompanyId, isSuperAdmin));
        const items = snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
          .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
        setUsers(items);
      } catch {
        toast({ title: 'Hata', description: 'Kullanıcı listesi yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    setSelectedUser(selectedUid ? users.find(u => u.uid === selectedUid) || null : null);
  }, [selectedUid, users]);

  const filtered = useMemo(() => {
    let list = activities;
    if (typeFilter.length > 0) {
      list = list.filter(a => typeFilter.includes(a.type));
    }
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(a =>
        a.title.toLowerCase().includes(t) ||
        (a.subtitle || '').toLowerCase().includes(t)
      );
    }
    const sorted = list.slice().sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return ascending ? sorted : sorted.reverse();
  }, [activities, typeFilter, q, ascending]);

  const exportExcel = () => {
    const rows = filtered.map(a => ({
      Tarih: a.ts.toLocaleString('tr-TR'),
      Tip: TYPE_LABEL[a.type],
      Baslik: a.title,
      Detay: a.subtitle || '',
      Koleksiyon: a.ref?.collection || '',
      DokumanId: a.ref?.docId || '',
    }));
    exportDataToExcel(rows, `personel_ekstre_${selectedUser?.name || selectedUser?.email || selectedUid}`, 'Ekstre', toast);
  };

  const add = (arr: ActivityItem[], item?: ActivityItem | null) => {
    if (item && item.ts.getTime() > 0) arr.push(item);
  };

  const loadActivitiesFromLogs = useCallback(async (user: AppUser) => {
    setLoading(true);
    setActivities([]);
    const uid = user.uid;
    const since = toDateAny(user.createdAt) || new Date(0);
    try {
      let all: (LogDoc & { id: string })[] = [];

      for (const name of LOG_COLLECTION_CANDIDATES) {
        try {
          const part = await fetchAllLogsForUserFromCollection(name, uid, currentCompanyId, isSuperAdmin, 500);
          if (part.length > 0) {
            all = all.concat(part.map(x => ({ ...x, _collName: name } as any)));
          }
        } catch (e) {
          console.warn(`Could not query collection: ${name}`, e);
        }
      }

      const mapped: ActivityItem[] = all.map((log: any) => {
        const a = normalizeLogToActivity({ id: log.id, ...(log as any) });
        return {
          ...a,
          ref: a.ref?.collection
            ? a.ref
            : { collection: (log._collName as string) || 'logs', docId: log.id },
        };
      });

      const final = mapped.filter(x => x.ts >= since);
      setActivities(final);
    } catch (e) {
      console.error('Log load error', e);
      toast({ title: 'Hata', description: 'Log kayıtları yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const onSelectUser = async () => {
    const u = users.find(x => x.uid === selectedUid);
    if (!u) return;
    await loadActivitiesFromLogs(u);
  };

  const typeOptions = useMemo(() => Object.keys(TYPE_LABEL) as ActivityItem['type'][], []);

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/yonetim/personel" />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Personel Hareket Ekstresi
          </CardTitle>
          <CardDescription>Veriler log koleksiyonlarından çekilir. Silme/iptal gibi hareketler dahil.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Picker & actions */}
          <div className="grid gap-3 md:grid-cols-[320px_auto] items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Personel</label>
              <Select value={selectedUid} onValueChange={setSelectedUid}>
                <SelectTrigger><SelectValue placeholder="Personel seçiniz" /></SelectTrigger>
                <SelectContent>
                  {loadingUsers ? (
                    <div className="p-2 text-sm text-muted-foreground">Yükleniyor...</div>
                  ) : users.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">Kullanıcı bulunamadı</div>
                  ) : (
                    users.map(u => (
                      <SelectItem key={u.uid} value={u.uid}>
                        {(u.name || u.email || u.uid) + (u.role ? ` • ${u.role}` : '')}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={onSelectUser} disabled={!selectedUid || loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <UserIcon className="h-4 w-4 mr-2" />}
                Seç ve Getir
              </Button>
              <Button variant="secondary" onClick={() => setAscending(v => !v)} title={ascending ? 'Yeni→Eski sırala' : 'Eski→Yeni sırala'}>
                {ascending ? <ArrowDownAZ className="h-4 w-4 mr-2" /> : <ArrowUpAZ className="h-4 w-4 mr-2" />}
                {ascending ? 'Eski → Yeni' : 'Yeni → Eski'}
              </Button>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
                <Input
                  className="pl-8"
                  placeholder="Listede ara..."
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  disabled={!activities.length}
                />
              </div>
              <Button variant="outline" onClick={exportExcel} disabled={!filtered.length}>
                <Download className="h-4 w-4 mr-2" /> Excel
              </Button>
            </div>
          </div>

          {/* Type filters */}
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium mb-2">İşlem Türleri</div>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map(t => {
                const checked = typeFilter.includes(t);
                return (
                  <label key={t} className="inline-flex items-center gap-2 border rounded-full px-3 py-1">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setTypeFilter(prev => v ? [...prev, t] : prev.filter(x => x !== t))
                      }
                    />
                    <span className="text-sm">{TYPE_LABEL[t]}</span>
                  </label>
                );
              })}
              {typeFilter.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setTypeFilter([])}>Temizle</Button>
              )}
            </div>
          </div>

          {/* Timeline */}
          <Card className="shadow-inner">
            <CardHeader>
              <CardTitle className="text-base">
                {selectedUser ? (selectedUser.name || selectedUser.email || selectedUser.uid) : 'Personel'}
              </CardTitle>
              <CardDescription>
                {selectedUser?.createdAt ? `Kayıt Tarihi: ${toDateAny(selectedUser.createdAt).toLocaleString('tr-TR')}` : 'Kayıt tarihi bulunamadı'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Yükleniyor...
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">Kayıt bulunamadı.</div>
              ) : (
                <ScrollArea className="h-[560px] border rounded-md">
                  <ul className="divide-y">
                    {filtered.map(a => (
                      <li key={`${a.type}-${a.id}-${a.ts.getTime()}`} className="p-3 hover:bg-accent/10 transition">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{TYPE_LABEL[a.type]}</Badge>
                          <span className="text-xs text-muted-foreground">{a.ts.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="font-medium mt-1">{a.title}</div>
                        {a.subtitle && <div className="text-sm text-muted-foreground">{a.subtitle}</div>}
                        {a.ref?.collection && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Ref: <span className="font-mono">{a.ref.collection}{a.ref.docId ? `/${a.ref.docId}` : ''}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Not: Kayıtlar <code>auditLogs</code>, <code>activityLogs</code> veya <code>logs</code> koleksiyonlarından çekilir.</div>
            <div>Sayfalama: <code>where('userId','==',uid)</code> + <code>orderBy('ts','desc')</code> + <code>limit</code> + <code>startAfter</code>. Gerekirse indeks yoksa sırasız taramaya düşer.</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
