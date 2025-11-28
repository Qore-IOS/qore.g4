'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Check, Loader2, Nfc, Keyboard, Smartphone, MonitorSmartphone } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

const FN_REGION = process.env.NEXT_PUBLIC_FB_FUNCTION_REGION || 'europe-west1';

function normalizeSerial(raw: string) {
  return (raw || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}
function detectEnv() {
  if (typeof window === 'undefined') {
    return { isAndroid: false, isChrome: false, isIOS: false, hasWebNfc: false, secure: false, canUseWebNfc: false };
  }
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg\//i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const hasWebNfc = typeof (window as any).NDEFReader !== 'undefined';
  const secure = window.isSecureContext === true;
  return { isAndroid, isChrome, isIOS, hasWebNfc, secure, canUseWebNfc: secure && hasWebNfc && isAndroid && isChrome };
}

export function NfcLoginDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [serial, setSerial] = useState('');
  const [state, setState] = useState<'idle' | 'scanning' | 'manual' | 'submitting'>('idle');
  const env = useMemo(detectEnv, []);
  const readerRef = useRef<any>(null);
  const pendingAutoSubmit = useRef(false);

  const autoSubmit = useCallback(async (cleanedSerial: string) => {
    if (!cleanedSerial || pendingAutoSubmit.current) return;
    pendingAutoSubmit.current = true;
    await submitSerial(cleanedSerial);
    pendingAutoSubmit.current = false;
  }, []);

  const submitSerial = useCallback(
    async (incoming?: string) => {
      const cleaned = normalizeSerial(incoming ?? serial);
      if (!cleaned) {
        toast({ title: 'Seri No gerekli', description: 'Kart UID değerini girin/okutun.', variant: 'destructive' });
        return;
      }
      setState('submitting');
      try {
        const functions = getFunctions(app, FN_REGION);
        const call = httpsCallable(functions, 'nfcLoginWithSerial');
        const res = (await call({ serial: cleaned })) as any;
        const token = res?.data?.token as string | undefined;
        const email = (res?.data?.email as string | null) ?? null;

        if (token) {
          await signInWithCustomToken(getAuth(), token);
          toast({ title: 'Giriş başarılı', description: 'Yönlendiriliyorsunuz...' });
          onOpenChange(false);
          return;
        }
        if (email) {
          window.dispatchEvent(new CustomEvent('nfc:prefillCredentials', { detail: { email } }));
          toast({ title: 'E-posta otomatik dolduruldu', description: 'Lütfen şifrenizi girip giriş yapın.' });
          onOpenChange(false);
        } else {
          toast({ title: 'Eşleşme yok', description: 'Kart herhangi bir kullanıcıya atanmadı.', variant: 'destructive' });
        }
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const serverMsg = err?.message?.replace('functions/', '') || 'İşlem gerçekleştirilemedi.';
        const email = err?.details?.email || null;

        if (email) {
          window.dispatchEvent(new CustomEvent('nfc:prefillCredentials', { detail: { email } }));
          toast({ title: 'E-posta otomatik dolduruldu', description: 'Şifrenizi girip devam edin.' });
          onOpenChange(false);
        } else {
          toast({
            title: 'NFC giriş hatası',
            description: `${code}: ${serverMsg}`,
            variant: 'destructive',
          });
        }
      } finally {
        setState('idle');
      }
    },
    [onOpenChange, serial, toast]
  );

  // Keyboard-wedge support for desktop USB readers — auto-submit on Enter
  useEffect(() => {
    if (!open) return;
    let buffer = '';
    let timer: any = null;
    const onKeydown = (e: KeyboardEvent) => {
      if (state === 'scanning') return;
      if (e.key === 'Enter') {
        const cleaned = normalizeSerial(buffer);
        buffer = '';
        if (timer) { clearTimeout(timer); timer = null; }
        if (cleaned.length >= 4) {
          setSerial(cleaned);
          autoSubmit(cleaned); // ⬅️ auto login without clicking
        }
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (buffer = ''), 350);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      if (timer) clearTimeout(timer);
    };
  }, [open, state, autoSubmit]);

  const startWebNfcScan = useCallback(async () => {
    if (!env.canUseWebNfc) { 
      setState('manual'); 
      if (env.isIOS) {
        toast({
          title: 'iOS kısıtı',
          description: 'Safari şu anda Web NFC sunmuyor. Harici okuyucu ya da manuel girişi kullanın.',
          variant: 'default',
        });
      }
      return;
    }
    try {
      setState('scanning');
      // @ts-ignore experimental
      const reader = new (window as any).NDEFReader();
      readerRef.current = reader;
      await reader.scan();
      reader.onreadingerror = () => {
        toast({ title: 'Okuma hatası', description: 'Kart algılandı ama okunamadı. Tekrar deneyin.' });
      };
      reader.onreading = (ev: any) => {
        const raw = ev?.serialNumber || '';
        const cleaned = normalizeSerial(raw);
        if (!cleaned) {
          toast({ title: 'UID alınamadı', description: 'Manuel girişe geçin veya harici okuyucu kullanın.', variant: 'destructive' });
          setState('manual');
          return;
        }
        setSerial(cleaned);
        toast({ title: 'Kart okundu', description: cleaned });
        autoSubmit(cleaned);
      };
    } catch (e: any) {
      setState('manual');
      toast({ title: 'Web NFC başlatılamadı', description: e?.message || 'Bu cihazda NFC devreye alınamadı.', variant: 'destructive' });
    }
  }, [env, toast, autoSubmit]);

  // Auto-start Web NFC on supported mobile
  useEffect(() => {
    if (open) {
      pendingAutoSubmit.current = false;
      setSerial('');
      if (env.canUseWebNfc) {
        const t = setTimeout(() => startWebNfcScan(), 150);
        return () => clearTimeout(t);
      } else {
        setState('manual');
      }
    } else {
      if (readerRef.current?.stop) {
        try { readerRef.current.stop(); } catch {}
      }
      setState('idle');
    }
  }, [open, env.canUseWebNfc, startWebNfcScan]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Nfc className="h-5 w-5" /> NFC Kart ile Giriş</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border p-3 text-sm">
            {env.canUseWebNfc ? (
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                <span>Telefon dahili NFC ile otomatik tarıyor. Kartı yaklaştırın…</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MonitorSmartphone className="h-4 w-4" />
                <span>Dahili NFC yok. Harici okuyucu ile okutabilir veya seri noyu yazabilirsiniz.</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={env.canUseWebNfc ? 'default' : 'outline'}
              onClick={startWebNfcScan}
              disabled={state === 'scanning' || state === 'submitting'}
            >
              {state === 'scanning' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Nfc className="mr-2 h-4 w-4" />}
              {state === 'scanning' ? 'Tarama aktif' : env.canUseWebNfc ? 'Dahili NFC ile tara' : 'Web NFC dene'}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setState('manual')}
              disabled={state === 'submitting'}
            >
              <Keyboard className="mr-2 h-4 w-4" /> Harici okuyucu / manuel
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm">Kart Seri No (UID)</label>
            <Input
              placeholder="XXXXXXXX"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              disabled={state === 'scanning' || state === 'submitting'}
            />
            <p className="text-xs text-muted-foreground">
              USB klavye-tipi okuyucularda seri no yazıldıktan sonra Enter’a basıldığında giriş otomatik yapılır.
            </p>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Kart UID eşleştirilen kullanıcı hesabına giriş yapılacaktır.
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Kapat</Button>
          <Button onClick={() => submitSerial()} disabled={state === 'submitting' || !serial}>
            {state === 'submitting' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Giriş Yap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
