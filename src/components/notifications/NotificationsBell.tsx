
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, AlertTriangle, CheckCircle2, Package, ClipboardList, Truck, ListChecks
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { markAsRead, buildHrefForResource } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import {
  Popover, PopoverTrigger, PopoverContent
} from '@/components/ui/popover';
import { useDock } from '@/hooks/use-dock';
import type { NotificationItem } from '@/hooks/use-dock';
import Image from 'next/image';
import { getIconSrc } from '@/hooks/useIconMappings';

type Props = {
  label?: string;
  triggerClassName?: string;
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  customIcon?: string;
};

export default function NotificationsBell({
  label = 'Bildirimler',
  triggerClassName,
  items,
  unreadCount,
  loading,
  customIcon,
}: Props) {
  const { currentUserProfile } = useAuth();
  const { markAllAsRead } = useDock();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const uid = currentUserProfile?.uid || '';

  const visibleItems = useMemo(
    () => items.filter(i => !(i.readBy || []).includes(uid)),
    [items, uid]
  );
  
  const iconFor = (t: NotificationItem['type']) => {
    switch (t) {
      case 'fefo_override': return <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />;
      case 'order_created': return <ClipboardList className="w-4 h-4 shrink-0 text-blue-500" />;
      case 'order_created_from_request': return <ClipboardList className="w-4 h-4 shrink-0 text-cyan-500" />;
      case 'transfer_to_lab': return <Truck className="w-4 h-4 shrink-0 text-indigo-500" />;
      case 'depot_count_completed': return <ListChecks className="w-4 h-4 shrink-0 text-green-500" />;
      case 'lab_count_completed': return <ListChecks className="w-4 h-4 shrink-0 text-emerald-500" />;
      case 'fault_opened': return <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />;
      case 'fault_closed': return <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />;
      default: return <Package className="w-4 h-4 shrink-0 text-foreground/70" />;
    }
  };

  const timeAgo = (ts: any) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date());
      const diffMs = Date.now() - d.getTime();
      const m = Math.floor(diffMs / 60000);
      if (m < 1) return 'şimdi';
      if (m < 60) return `${m} dk`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h} sa`;
      const day = Math.floor(h / 24);
      return `${day} g`;
    } catch { return ''; }
  };

  const handleClick = async (it: NotificationItem) => {
    if (uid) {
      markAsRead(it.id, uid);
    }
    const fallbackHref = buildHrefForResource(it.resource, {
      labId: it.meta?.labId,
      depotId: it.meta?.depotId,
      tab: it.meta?.tab,
    });
    const to = it.href || fallbackHref;
    if (to) router.push(to);
    setOpen(false);
  };

  const trigger = (
    <button
      aria-label="Bildirimler"
      onClick={() => setOpen(o => !o)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        triggerClassName ??
          'relative cursor-default dock-item-wrapper transition-colors'
      )}
    >
      {customIcon ? (
        <Image
          src={getIconSrc(customIcon)}
          alt={label}
          width={triggerClassName ? 20 : 34}
          height={triggerClassName ? 20 : 34}
          className={cn(triggerClassName ? 'w-5 h-5 object-contain' : 'dock-item-icon object-contain')}
        />
      ) : (
        <Bell className={triggerClassName ? 'w-5 h-5' : 'dock-item-icon'} />
      )}
      {unreadCount > 0 && (
        <span className={cn(
          'absolute -top-1 -right-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full px-1.5 h-4 bg-red-600 text-white min-w-[16px]',
          triggerClassName && 'translate-x-1 -translate-y-1'
        )}>
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-96 p-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="p-3 border-b flex items-center justify-between">
          <div className="text-sm font-medium">{label}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{unreadCount} okunmamış</span>
            <Button size="sm" variant="outline" onClick={markAllAsRead}>Tümünü okundu yap</Button>
          </div>
        </div>

        <ScrollArea className="h-80">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : visibleItems.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Bildirim yok.</div>
          ) : (
            <ul className="divide-y">
              {visibleItems.map(i => (
                <li key={i.id}>
                  <button
                    onClick={() => handleClick(i)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-accent/40 bg-primary/5'
                    )}
                  >
                    <span className="mt-0.5">
                      {iconFor(i.type)}
                    </span>
                    <span className="flex-1">
                      <div className="text-xs text-muted-foreground">{timeAgo(i.createdAt)}</div>
                      <div className="text-sm font-medium leading-5">{i.title}</div>
                      {i.message && <div className="text-sm text-muted-foreground line-clamp-2">{i.message}</div>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
