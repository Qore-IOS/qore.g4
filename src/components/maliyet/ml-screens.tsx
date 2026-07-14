'use client';

import React from 'react';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import { subscribeToUserSessions, joinSession, declineSession, type MaliyetSayimOturum } from '@/lib/maliyet-session';
import { useAuth } from '@/contexts/auth-context';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Hospital, Depot } from '@/lib/types';
import {
  AC, MLIco, MlCard, MlBtn, MlPill, MlPageHead, type Accent, type Mode,
} from './ml-primitives';

const nameOf = (x: any) => x?.name || x?.ad || x?.stokAdi || '—';

/* ───────────────── Home hub ───────────────── */
export const MlHome = ({ ac = AC, mode, go, goGozlem }: { ac?: Accent; mode: Mode; go: (r: string) => void; goGozlem: () => void }) => {
  const mobile = mode === 'mobile';
  const cards = [
    { id: 'sayim', ico: 'clipboardCheck', title: 'Maliyet Sayım', sub: 'Laboratuvar ve depo bazlı marka marka maliyet sayımı yapın', act: () => go('sayim') },
    { id: 'gecmis', ico: 'history', title: 'Sayım Geçmişi', sub: 'Geçmiş maliyet sayım oturumlarını görüntüleyin', act: () => go('gecmis') },
    { id: 'gozlem', ico: 'chart', title: 'Maliyet Gözlem', sub: 'Envanter maliyeti, trendler ve marka bazlı analizler', act: goGozlem },
  ];
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <MlPageHead ico="wallet" title="Maliyet Paneli" sub="Maliyet sayım, geçmiş ve gözlem araçları" ac={ac} mobile={mobile} />
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)', gap: mobile ? 14 : 18 }}>
        {cards.map((c, i) => {
          const I = MLIco[c.ico];
          return (
            <MlCard key={c.id} onClick={c.act} pad={mobile ? 22 : 30} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, animation: `mlPopIn ${260 + i * 90}ms var(--ease-fluid)` }}>
              <span style={{ width: 64, height: 64, borderRadius: 20, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 12px 24px -8px ${ac.glow}` }}><I s={30} /></span>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)' }}>{c.title}</div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 220 }}>{c.sub}</div>
            </MlCard>
          );
        })}
      </div>
    </div>
  );
};

const ChooserCard = ({ ico, title, sub, ac, onClick }: any) => {
  const I = MLIco[ico];
  const [p, setP] = React.useState(false);
  return (
    <button onClick={onClick} onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '30px 20px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: p ? 'var(--clay-press)' : 'var(--clay)', transition: 'transform 220ms var(--ease-fluid), box-shadow 220ms', transform: p ? 'translateY(2px) scale(0.98)' : 'none' }}>
      <span style={{ width: 58, height: 58, borderRadius: 18, display: 'grid', placeItems: 'center', color: ac.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: 'var(--clay-flat)' }}><I s={28} /></span>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-1)' }}>{title}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>{sub}</div>
    </button>
  );
};

const EmptyBox = ({ ico, text }: any) => {
  const I = MLIco[ico];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '50px 30px', textAlign: 'center' }}>
      <span style={{ width: 70, height: 70, borderRadius: '28%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-3)' }}><I s={32} /></span>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-2)' }}>{text}</div>
    </div>
  );
};

/* ───────────────── Maliyet Sayım (chooser + invites) ───────────────── */
export const MlSayim = ({ ac = AC, mode, go, onStartCount, onJoin, fire, hospitals, depots }: any) => {
  const mobile = mode === 'mobile';
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth() as any;
  const [tab, setTab] = React.useState<'new' | 'invites'>('new');
  const [chooser, setChooser] = React.useState<null | 'lab' | 'depot'>(null);
  const [q, setQ] = React.useState('');
  const [invites, setInvites] = React.useState<MaliyetSayimOturum[]>([]);

  React.useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const unsub = subscribeToUserSessions(uid, (sessions: MaliyetSayimOturum[]) => {
      setInvites(sessions.filter(s => s.participants?.some((p: any) => p.uid === uid && (p.status === 'invited' || p.status === 'joined'))));
    }, currentCompanyId, isSuperAdmin);
    return unsub;
  }, [currentUser?.uid, currentCompanyId, isSuperAdmin]);

  const invitedCount = invites.filter(s => s.participants?.some((p: any) => p.uid === currentUser?.uid && p.status === 'invited')).length;

  const list = chooser === 'lab' ? hospitals : chooser === 'depot' ? depots : [];
  const shown = (list as any[]).filter(l => nameOf(l).toLowerCase().includes(q.toLowerCase()));

  const joinInvite = async (s: MaliyetSayimOturum) => {
    try {
      await joinSession(s.id, currentUser.uid, currentUserProfile?.name || currentUser.displayName || '');
      onJoin(s);
    } catch (e) { console.error(e); fire({ title: 'Katılım başarısız' }); }
  };
  const declineInvite = async (s: MaliyetSayimOturum) => {
    try { await declineSession(s.id, currentUser.uid); fire({ title: 'Davet reddedildi' }); }
    catch (e) { console.error(e); }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <MlPageHead ico="clipboardCheck" title="Maliyet Sayım" sub="Yeni sayım başlatın veya davetleri görüntüleyin" ac={ac} onBack={() => (chooser ? setChooser(null) : go('home'))} mobile={mobile} />

      {!chooser && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <MlBtn variant={tab === 'new' ? 'primary' : undefined} ac={ac} onClick={() => setTab('new')}>Yeni Sayım</MlBtn>
            <MlBtn ico="bell" ac={ac} onClick={() => setTab('invites')} style={tab === 'invites' ? { boxShadow: `inset 0 0 0 1.5px ${ac.primary}66`, color: ac.primary } : null}>Bekleyen Davetler{invitedCount ? ` (${invitedCount})` : ''}</MlBtn>
          </div>

          {tab === 'new' ? (
            <>
              <MlCard onClick={() => go('toplu')} pad={mobile ? 16 : 18} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: `0 8px 16px -7px ${ac.glow}` }}><MLIco.layers s={22} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--ink-1)' }}>Toplu Sayım Gir</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginTop: 2 }}>Birden fazla laboratuvar için toplu sayım girin</div>
                </div>
                <MLIco.chevR s={18} />
              </MlCard>

              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '4px 2px 12px' }}>Sayım Türü Seçin</div>
              <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: mobile ? 14 : 18 }}>
                <ChooserCard ico="flask" title="Laboratuvar" sub={`${hospitals.length} laboratuvar`} ac={ac} onClick={() => { setChooser('lab'); setQ(''); }} />
                <ChooserCard ico="building" title="Depo" sub={`${depots.length} depo`} ac={ac} onClick={() => { setChooser('depot'); setQ(''); }} />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {invites.map((iv, i) => {
                const me = iv.participants?.find((p: any) => p.uid === currentUser?.uid);
                const joined = me?.status === 'joined';
                return (
                  <MlCard key={iv.id} pad={16} style={{ display: 'flex', alignItems: 'center', gap: 14, animation: `mlPopIn ${240 + i * 70}ms var(--ease-fluid)` }}>
                    <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: ac.primary, background: `${ac.primary}16` }}>{iv.locationType === 'depot' ? <MLIco.building s={20} /> : <MLIco.flask s={20} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-1)' }}>{iv.locationName}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{iv.createdByName} · {iv.participants?.length || 0} kişi</div>
                    </div>
                    {!joined && <MlBtn ac={ac} size="sm" onClick={() => declineInvite(iv)}>Reddet</MlBtn>}
                    <MlBtn variant="primary" ac={ac} size="sm" onClick={() => joinInvite(iv)}>{joined ? 'Devam Et' : 'Katıl'}</MlBtn>
                  </MlCard>
                );
              })}
              {invites.length === 0 && <EmptyBox ico="bell" text="Bekleyen davet yok" />}
            </div>
          )}
        </>
      )}

      {chooser && (
        <div style={{ animation: 'mlFadeIn 260ms var(--ease-fluid)' }}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={18} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={chooser === 'lab' ? 'Laboratuvar ara…' : 'Depo ara…'} autoFocus style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 16px 0 46px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((l, i) => (
              <button key={l.id} onClick={() => onStartCount({ id: l.id, name: nameOf(l) }, chooser)}
                style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', animation: `mlPopIn ${200 + Math.min(i, 12) * 40}ms var(--ease-fluid)`, transition: 'transform 160ms var(--ease-fluid)' }}
                onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.99)')} onPointerUp={(e) => (e.currentTarget.style.transform = '')} onPointerLeave={(e) => (e.currentTarget.style.transform = '')}>
                <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center', color: ac.primary, background: `${ac.primary}16` }}>{chooser === 'lab' ? <MLIco.flask s={19} /> : <MLIco.building s={19} />}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{nameOf(l)}</span>
                <MLIco.chevR s={18} />
              </button>
            ))}
            {shown.length === 0 && <EmptyBox ico={chooser === 'lab' ? 'flask' : 'building'} text="Sonuç bulunamadı" />}
          </div>
        </div>
      )}
    </div>
  );
};

/* ───────────────── Sayım Geçmişi (reads maliyetSayimSessions) ───────────────── */
interface HistRow { id: string; kind: 'lab' | 'depot'; loc: string; date: string; user: string; count: number; brands: string[]; }

export const MlGecmis = ({ ac = AC, mode, go, fire }: any) => {
  const mobile = mode === 'mobile';
  const { currentCompanyId, isSuperAdmin } = useAuth() as any;
  const [rows, setRows] = React.useState<HistRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(scopedQuery('maliyetSayimSessions', currentCompanyId, isSuperAdmin) as any);
        const docs = filterByCompanyScope(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })), currentCompanyId, isSuperAdmin);
        const mapped: HistRow[] = docs.map((d: any) => {
          const items: any[] = Array.isArray(d.items) ? d.items : [];
          const brands = Array.from(new Set(items.map(it => it.marka).filter(Boolean))) as string[];
          let dateStr = '—';
          try { const dt = d.createdAt?.toDate ? d.createdAt.toDate() : (d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null); if (dt) dateStr = format(dt, 'dd MMM yyyy HH:mm', { locale: tr }); } catch {}
          return { id: d.id, kind: d.locationType === 'depot' ? 'depot' : 'lab', loc: d.locationName || '—', date: dateStr, user: d.createdByName || '—', count: d.totalProducts ?? items.length, brands, _ts: d.createdAt?.seconds || 0 } as any;
        });
        mapped.sort((a: any, b: any) => (b._ts || 0) - (a._ts || 0));
        if (alive) setRows(mapped);
      } catch (e) { console.error(e); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [currentCompanyId, isSuperAdmin]);

  const del = async (r: HistRow) => {
    setRows(cur => cur.filter(x => x.id !== r.id));
    try { await deleteDoc(doc(db, 'maliyetSayimSessions', r.id)); fire({ title: 'Oturum silindi', sub: r.loc }); }
    catch (e) { console.error(e); }
  };

  const shown = rows.filter(h => h.loc.toLowerCase().includes(q.toLowerCase()) || h.user.toLowerCase().includes(q.toLowerCase()) || h.brands.join(' ').toLowerCase().includes(q.toLowerCase()));
  const filters = [{ ic: 'calendar', l: 'Tarih' }, { ic: 'building', l: 'Lokasyon' }, { ic: 'flask', l: 'Tip' }, { ic: 'user', l: 'Sayımı Yapan' }, { ic: 'tag', l: 'Marka' }];

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <MlPageHead ico="history" title="Sayım Geçmişi" sub={`${rows.length} sayım oturumu`} ac={ac} onBack={() => go('home')} mobile={mobile} />

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lokasyon, kullanıcı, marka ara…" style={{ width: '100%', boxSizing: 'border-box', height: 54, padding: '0 18px 0 48px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
      </div>

      <MlCard pad={16} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}><span style={{ color: ac.primary, display: 'inline-flex' }}><MLIco.filter s={17} /></span><span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-2)' }}>Filtreler</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {filters.map(f => { const I = MLIco[f.ic]; return (
            <button key={f.l} onClick={() => fire({ title: f.l + ' filtresi' })} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 15px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 700 }}><I s={15} /> {f.l} <MLIco.chevD s={14} /></button>
          ); })}
        </div>
      </MlCard>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', fontSize: 12 }}>Yükleniyor</div>
      ) : shown.length === 0 ? (
        <EmptyBox ico="history" text="Sayım oturumu bulunamadı" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((h, i) => (
            <MlCard key={h.id} pad={mobile ? 16 : 18} style={{ animation: `mlPopIn ${220 + Math.min(i, 12) * 45}ms var(--ease-fluid)` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <MlPill tone={h.kind === 'depot' ? 'accent' : 'blue'}>{h.kind === 'depot' ? <><MLIco.building s={12} /> DEPO</> : <><MLIco.flask s={12} /> LAB</>}</MlPill>
                    <span style={{ fontSize: mobile ? 15 : 16.5, fontWeight: 800, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>{h.loc}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MLIco.calendar s={13} /> {h.date}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MLIco.user s={13} /> {h.user}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ac.primary, fontWeight: 800 }}><MLIco.box s={13} /> {h.count} ürün</span>
                  </div>
                  {h.brands.length > 0 && (
                    <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
                      {h.brands.map(b => <span key={b} style={{ padding: '4px 11px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>{b}</span>)}
                    </div>
                  )}
                </div>
                <button onClick={() => del(h)} aria-label="Sil" style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--danger)', background: 'var(--surface-2)', boxShadow: 'var(--clay-flat)' }}><MLIco.trash s={17} /></button>
              </div>
            </MlCard>
          ))}
        </div>
      )}
    </div>
  );
};

/* ───────────────── Toplu Sayım Gir ───────────────── */
export const MlToplu = ({ ac = AC, mode, go, onStartCount, fire, hospitals }: any) => {
  const mobile = mode === 'mobile';
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const labs: any[] = hospitals;
  const shown = labs.filter(l => nameOf(l).toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = sel.size === labs.length && labs.length > 0;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 180 }}>
      <MlPageHead ico="layers" title="Toplu Sayım Gir" sub="Toplu sayım girilecek laboratuvarları seçin" ac={ac} onBack={() => go('sayim')} mobile={mobile} />
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Laboratuvar ara…" style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 16px 0 46px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 4px 12px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>{sel.size} / {labs.length} seçildi</span>
        <button onClick={() => setSel(allSel ? new Set() : new Set(labs.map(l => l.id)))} style={{ all: 'unset', cursor: 'pointer', color: ac.primary, fontSize: 13.5, fontWeight: 800 }}>{allSel ? 'Seçimi Temizle' : 'Tümünü Seç'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map((l, i) => {
          const on = sel.has(l.id);
          return (
            <button key={l.id} onClick={() => toggle(l.id)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderRadius: 'var(--radius)', background: on ? `linear-gradient(180deg, ${ac.accent}1e, ${ac.primary}14)` : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: on ? `var(--clay), inset 0 0 0 1.5px ${ac.primary}` : 'var(--clay)', animation: `mlPopIn ${180 + Math.min(i, 12) * 40}ms var(--ease-fluid)`, transition: 'box-shadow 200ms' }}>
              <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: on ? `radial-gradient(circle at 30% 30%, ${ac.accent}, ${ac.primary})` : 'var(--surface-2)', boxShadow: on ? `0 4px 9px -3px ${ac.glow}` : 'var(--clay-inset)', border: on ? 'none' : '2px solid var(--ink-3)', boxSizing: 'border-box' }}>{on && <MLIco.check s={15} />}</span>
              <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: 'grid', placeItems: 'center', color: ac.primary, background: `${ac.primary}16` }}><MLIco.flask s={17} /></span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{nameOf(l)}</span>
            </button>
          );
        })}
        {shown.length === 0 && <EmptyBox ico="flask" text="Laboratuvar bulunamadı" />}
      </div>
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: mobile ? 'calc(env(safe-area-inset-bottom) + 84px)' : 'calc(var(--dock-h, 76px) + var(--dock-gap, 16px) + 6px)', zIndex: 40, padding: mobile ? '10px 14px' : '12px 24px', background: 'linear-gradient(0deg, var(--bg-0) 72%, transparent)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 -8px 24px -12px rgba(150,128,96,0.4), var(--clay)' }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--ink-2)' }}>{sel.size} laboratuvar seçildi</span>
          <MlBtn ico="download" ac={ac} onClick={() => fire({ title: 'Excel şablonu indiriliyor' })}>Şablon</MlBtn>
          <MlBtn variant="primary" ac={ac} size="lg" disabled={sel.size === 0} onClick={() => { const id = [...sel][0]; const l = labs.find(x => x.id === id); if (l) onStartCount({ id: l.id, name: nameOf(l) }, 'lab'); }}>Devam Et →</MlBtn>
        </div>
      </div>
    </div>
  );
};
