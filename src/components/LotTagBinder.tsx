'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, SmartphoneNfc, Link as LinkIcon } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  getDocs,
} from 'firebase/firestore';

type Props = {
  depotId: string;
  productCode: string;
  lot: string;
  miad?: string;
  onSaved?: () => void;
};

// --- Utils ---
function normalizeUidFromAny(raw: string): string | null {
  const hex = (raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 16 ? hex : null;
}
function prettyHex(hex16: string): string {
  return hex16.match(/.{1,2}/g)!.join(':');
}
function suffix6FromHex(hex16: string): string {
  const last12 = hex16.slice(-12);
  return last12.match(/.{1,2}/g)!.join(':');
}

export default function LotTagBinder({ depotId, productCode, lot, miad, onSaved }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [webNfcSupported, setWebNfcSupported] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [uidHex, setUidHex] = useState<string | null>(null);
  const [uidPretty, setUidPretty] = useState('');
  const [suffix6, setSuffix6] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [existing, setExisting] = useState<Array<{ id: string; exampleUid?: string; createdAt?: any }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWebNfcSupported(typeof window !== 'undefined' && 'NDEFReader' in window);
  }, []);

  const fetchExisting = async () => {
    if (!productCode || !lot) return;
    try {
      setLoadingList(true);
      const colRef = collection(db, 'products', productCode, 'lots', lot, 'nfcSignatures');
      const q = query(colRef);
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setExisting(items);
    } catch (e) {
        console.error("Error fetching existing signatures:", e);
        setExisting([]);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setRawInput('');
      setUidHex(null);
      setUidPretty('');
      setSuffix6('');
      setExisting([]);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);
    void fetchExisting();
  }, [open, productCode, lot]);

  useEffect(() => {
    const hex = normalizeUidFromAny(rawInput);
    setUidHex(hex);
    setUidPretty(hex ? prettyHex(hex) : '');
    setSuffix6(hex ? suffix6FromHex(hex) : '');
  }, [rawInput]);

  async function scanWithWebNFC() {
    if (!webNfcSupported) {
      toast({
        title: 'Web NFC not available',
        description: 'Use Android Chrome over HTTPS, or paste the UID manually.',
        variant: 'destructive',
      });
      return;
    }
    try {
      // @ts-ignore
      const ndef = new NDEFReader();
      await ndef.scan();
      toast({ title: 'Ready', description: 'Hold the tag near the top/back of your phone.' });
      // @ts-ignore
      ndef.onreading = (ev: any) => {
        const serial: string | undefined = ev?.serialNumber;
        const hex = normalizeUidFromAny(serial || '');
        if (!hex) {
          toast({
            title: 'Couldn’t read UID',
            description: 'No valid serialNumber from Web NFC. Paste the UID manually if needed.',
            variant: 'destructive',
          });
          return;
        }
        setRawInput(hex);
        toast({ title: 'Tag read', description: `UID ${prettyHex(hex)}` });
        // @ts-ignore
        ndef.onreading = null;
      };
    } catch (e: any) {
      toast({ title: 'NFC scan failed', description: String(e?.message || e), variant: 'destructive' });
    }
  }

  async function handleSave() {
    if (!uidHex) {
      toast({ title: 'Invalid UID', description: 'Scan or paste an 8-byte UID (16 hex).', variant: 'destructive' });
      return;
    }
    try {
      setSaving(true);
      
      const sigRef = doc(db, 'products', productCode, 'lots', lot, 'nfcSignatures', suffix6);
      const snap = await getDoc(sigRef);
      if (snap.exists()) {
        throw new Error('This lot already has this signature');
      }

      await setDoc(sigRef, {
        suffix6,
        exampleUid: uidHex,
        depotId: depotId || null,
        miad: miad || null,
        createdAt: serverTimestamp(),
      });

      const auditRef = doc(db, 'lot_tags', uidHex);
      await setDoc(auditRef, {
        productCode,
        lot,
        suffix6,
        depotId: depotId || null,
        miad: miad || null,
        boundAt: serverTimestamp(),
      }, { merge: true });

      toast({ title: 'Saved', description: `Signature ${suffix6} bound to lot ${lot}.` });
      onSaved?.();
      await fetchExisting();
      setRawInput('');
    } catch (e: any) {
      toast({ title: 'Save failed', description: String(e?.message || e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LinkIcon className="h-4 w-4 mr-2" />
        Assign NFC Tag
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Bind NFC tag to this lot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Product: {productCode}</Badge>
              <Badge variant="secondary">Lot: {lot}</Badge>
              {miad && <Badge variant="secondary">Expiry: {miad}</Badge>}
              <Badge variant={webNfcSupported ? 'default' : 'secondary'}>
                {webNfcSupported ? 'Web NFC supported' : 'Web NFC unavailable'}
              </Badge>
            </div>
            <div className="grid gap-2">
              <Label>Scan with phone NFC (Android Chrome, HTTPS)</Label>
              <Button type="button" onClick={scanWithWebNFC} disabled={!webNfcSupported}>
                <SmartphoneNfc className="h-4 w-4 mr-2" />
                Scan tag
              </Button>
              <div className="text-xs text-muted-foreground">
                If your browser/phone doesn’t support Web NFC, paste the UID below.
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Manual UID (optional fallback, 16 hex)</Label>
              <Input
                ref={inputRef}
                placeholder="E00401531D362DCD"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Normalized UID</Label>
                <div className="mt-1 h-9 px-3 flex items-center rounded-md border bg-muted/30 font-mono text-sm">
                  {uidHex ? prettyHex(uidHex) : '—'}
                </div>
              </div>
              <div>
                <Label>Lot signature (last 6 bytes)</Label>
                <div className="mt-1 h-9 px-3 flex items-center rounded-md border bg-muted/30 font-mono text-sm">
                  {suffix6 || '—'}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Already bound signatures</Label>
              <div className="rounded-md border p-2 bg-muted/30">
                {loadingList ? (
                  <div className="text-sm text-muted-foreground flex items-center">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading…
                  </div>
                ) : existing.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No signatures yet.</div>
                ) : (
                  <ul className="text-sm space-y-1">
                    {existing.map(it => (
                      <li key={it.id} className="flex items-center justify-between">
                        <span className="font-mono">{it.id}</span>
                        {it.exampleUid && <span className="text-muted-foreground">{prettyHex(it.exampleUid)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!uidHex || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
