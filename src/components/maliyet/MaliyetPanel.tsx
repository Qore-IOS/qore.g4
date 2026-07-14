'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Hospital, Depot, ProductCode } from '@/lib/types';
import { AC, MlStyles, MlToast, useContainerMode, type Mode } from './ml-primitives';
import { MlHome, MlSayim, MlGecmis, MlToplu } from './ml-screens';
import MlCount from './MlCount';
import type { LocationType } from './ml-logic';
import type { MaliyetSayimOturum } from '@/lib/maliyet-session';

interface Props { hospitals: Hospital[]; depots: Depot[]; productCodes: ProductCode[]; }

const nameOf = (x: any) => x?.name || x?.ad || '—';

export default function MaliyetPanel({ hospitals, depots, productCodes }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mode: Mode = useContainerMode(rootRef);

  const [route, setRoute] = React.useState<'home' | 'sayim' | 'gecmis' | 'toplu'>('home');
  const [count, setCount] = React.useState<{ loc: { id: string; name: string }; kind: LocationType; session?: MaliyetSayimOturum | null } | null>(null);
  const [toast, setToast] = React.useState<any>(null);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = (t: any) => { if (toastRef.current) clearTimeout(toastRef.current); setToast({ ...t, id: Date.now() }); toastRef.current = setTimeout(() => setToast(null), 2400); };

  /* backward-compat deep link: ?type=lab|depot&id=... starts a count directly */
  React.useEffect(() => {
    const type = searchParams.get('type');
    const id = searchParams.get('id');
    if ((type === 'lab' || type === 'depot') && id) {
      const src = type === 'lab' ? hospitals : depots;
      const found = (src as any[]).find(x => x.id === id);
      if (found) setCount({ loc: { id, name: nameOf(found) }, kind: type });
      else setCount({ loc: { id, name: '—' }, kind: type });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (r: string) => { setCount(null); setRoute(r as any); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const startCount = (loc: { id: string; name: string }, kind: LocationType, session?: MaliyetSayimOturum | null) => {
    setCount({ loc, kind, session: session || null });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  const backFromCount = () => { setCount(null); router.replace('/maliyet-sayim', { scroll: false } as any); };

  const pad = mode === 'mobile' ? '16px 14px 40px' : '24px 30px 48px';

  return (
    <div ref={rootRef} className="ml-root" style={{ minHeight: '100vh', width: '100%' }}>
      <MlStyles />
      {count ? (
        <MlCount ac={AC} mode={mode} loc={count.loc} kind={count.kind} session={count.session} productCodes={productCodes} onBack={backFromCount} fire={fire} />
      ) : (
        <div style={{ padding: pad }}>
          <div key={route} style={{ animation: 'mlFadeIn 300ms var(--ease-fluid)' }}>
            {route === 'home' && <MlHome ac={AC} mode={mode} go={go} goGozlem={() => router.push('/maliyet-gozlem')} />}
            {route === 'sayim' && <MlSayim ac={AC} mode={mode} go={go} hospitals={hospitals} depots={depots} fire={fire}
              onStartCount={(loc: any, kind: LocationType) => startCount(loc, kind)}
              onJoin={(s: MaliyetSayimOturum) => startCount({ id: s.locationId, name: s.locationName }, s.locationType, s)} />}
            {route === 'gecmis' && <MlGecmis ac={AC} mode={mode} go={go} fire={fire} />}
            {route === 'toplu' && <MlToplu ac={AC} mode={mode} go={go} hospitals={hospitals} fire={fire}
              onStartCount={(loc: any, kind: LocationType) => startCount(loc, kind)} />}
          </div>
        </div>
      )}
      <MlToast toast={toast} ac={AC} />
    </div>
  );
}
