'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

// Use the existing printing bridge (no popups, no new tabs)
import { listPrinters, sendRawZpl, buildZplForRack } from '@/lib/archive/printing';

type PrinterInfo = { id: string; name: string };

declare global {
  interface Window {
    ArchivePrintAgent?: {
      printRack: (rackId: string) => Promise<void>;
      getSelectedPrinterId: () => string | null;
    };
  }
}

const LS_KEY = (uid: string) => `preferredBarcodePrinterId:${uid}`;

export default function ArchivePrintAgent() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || 'anon';

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);

  // keep latest printer id for event handler without re-attaching
  const printerRef = useRef<string | null>(null);
  useEffect(() => { printerRef.current = selectedPrinterId; }, [selectedPrinterId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingPrinters(true);
      try {
        const list = await listPrinters();
        if (!mounted) return;
        setPrinters(list || []);
      } catch (e) {
        console.error('[ArchivePrintAgent] listPrinters failed:', e);
        setPrinters([]);
      } finally {
        if(mounted) setLoadingPrinters(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;
    (async () => {
      const ls = typeof window !== 'undefined' ? window.localStorage.getItem(LS_KEY(uid)) : null;
      if (ls && !cancelled) setSelectedPrinterId(ls);

      try {
        const userRef = doc(db, 'users', uid);
        const snap = await getDoc(userRef);
        const cloudPref = snap.exists() ? (snap.data() as any)?.preferredBarcodePrinterId : null;
        if (!cancelled && cloudPref) {
          setSelectedPrinterId(cloudPref);
          if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY(uid), cloudPref);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, [uid]);

  const persistSelection = async (printerId: string) => {
    if (!uid) return;
    setPersisting(true);
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY(uid), printerId);
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, { preferredBarcodePrinterId: printerId });
      } else {
        await setDoc(userRef, { preferredBarcodePrinterId: printerId }, { merge: true });
      }
      setSelectedPrinterId(printerId);
    } finally {
      setPersisting(false);
    }
  };

  const printRack = async (rackId: string) => {
    if (!rackId) return;
    const pid = printerRef.current;
    if (!pid) {
      console.warn('[ArchivePrintAgent] No printer selected; skipping print for', rackId);
      return;
    }
    // 3×4 cm label; only rack ID
    const zpl = buildZplForRack(rackId, { widthMm: 30, heightMm: 40 });
    await sendRawZpl(pid, zpl);
  };

  // Attach the event listener once (stable), use printerRef inside
  useEffect(() => {
    const handler = async (evt: Event) => {
      const rackId: string | undefined = (evt as CustomEvent)?.detail?.rackId;
      if (rackId) await printRack(rackId);
    };

    window.ArchivePrintAgent = {
      printRack,
      getSelectedPrinterId: () => printerRef.current,
    };

    window.addEventListener('archive:rackSaved', handler as EventListener);
    return () => {
      window.removeEventListener('archive:rackSaved', handler as EventListener);
      if (window.ArchivePrintAgent) delete window.ArchivePrintAgent;
    };
  }, []); // <-- attach once

  const content = useMemo(() => {
    if (loadingPrinters) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Yazıcılar yükleniyor…
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Printer className="h-4 w-4 opacity-70" />
        <span className="text-sm text-muted-foreground">Barkod Yazıcı:</span>
        <Select value={selectedPrinterId ?? undefined} onValueChange={(v) => persistSelection(v)}>
          <SelectTrigger className={cn('h-8 w-[280px]')}>
            <SelectValue placeholder="Yazıcı seçin" />
          </SelectTrigger>
          <SelectContent>
            {printers.length === 0 ? (
              <SelectItem value="__none" disabled>
                Yazıcı bulunamadı
              </SelectItem>
            ) : (
              printers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {persisting && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
    );
  }, [loadingPrinters, printers, selectedPrinterId, persisting, persistSelection]);

  return (
    <div className="w-full flex justify-start pt-2 pb-1">
      <Card className="px-3 py-2 bg-background/60 border-dashed">{content}</Card>
    </div>
  );
}
