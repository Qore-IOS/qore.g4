'use client';
import { useState, type FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, Eye, EyeOff, Check, ArrowRight, Loader2, Sparkle } from 'lucide-react';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';

const RIBBON_TURN_DURATION_MS = 480;
const RIBBON_LAYER_STAGGER_MS = 120;
const RIBBON_CORNER_STAGGER_MS = 60;
const RIBBON_SUCCESS_WINDOW_MS =
  RIBBON_TURN_DURATION_MS + RIBBON_LAYER_STAGGER_MS * 2 + RIBBON_CORNER_STAGGER_MS + 60;

/* clay tokens + keyframes, scoped to the login screen (cream, theme-independent) */
const CSS = `
.qlogin {
  --bg-0: #EFEAE0; --bg-1: #E9E3D6;
  --surface: #FCFAF5; --surface-2: #F5F1E8; --surface-hi: #FFFFFF;
  --ink-1: #3D382F; --ink-2: #908872; --ink-3: #BBB2A0;
  --line: rgba(90,72,40,0.09);
  --accent: #C98A57; --accent-2: #E0B776; --accent-glow: rgba(201,138,87,0.30);
  --ready: #6FB585; --danger: #C0796A;
  --radius: 24px; --radius-sm: 16px; --radius-lg: 34px; --radius-pill: 999px;
  --clay: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16);
  --clay-press: inset 0 2px 5px rgba(178,160,128,0.32), inset 0 -1px 0 rgba(255,255,255,0.6), 0 2px 6px -4px rgba(150,128,96,0.2);
  --clay-inset: inset 0 2px 6px rgba(178,160,128,0.34), inset 0 -1px 0 rgba(255,255,255,0.6);
  --ease-fluid: cubic-bezier(.22,1,.36,1);
  position: fixed; inset: 0; overflow: hidden;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: var(--ink-1);
  background: var(--bg-0);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  -webkit-font-smoothing: antialiased;
}
.qlogin *, .qlogin *::before, .qlogin *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.qlogin input { font-family: inherit; }
.qlogin input::placeholder { color: var(--ink-3); }
.qlogin input:-webkit-autofill { -webkit-text-fill-color: var(--ink-1); transition: background-color 9999s ease-in-out 0s; }
.qlogin button:focus-visible, .qlogin input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.qlogin-ribbons { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.qlogin-card { position: relative; z-index: 1; width: 100%; max-width: 420px; margin: 0 auto; }
@keyframes qFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes qPopIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: none; } }
@keyframes qSpin { to { transform: rotate(360deg); } }
@keyframes qShake { 10%,90% { transform: translateX(-2px); } 30%,70% { transform: translateX(4px); } 50% { transform: translateX(-5px); } }
@keyframes qRibbonHalfTurn { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
.qlogin-ribbon-band {
  transform-box: view-box;
  transform-origin: 148px 148px;
}
.qlogin-ribbon-band--turn {
  animation: qRibbonHalfTurn ${RIBBON_TURN_DURATION_MS}ms var(--ease-fluid) forwards;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .qlogin * {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
  }
  .qlogin-ribbon-band--turn {
    animation: none !important;
    transform: rotate(180deg);
  }
}
`;

/* concentric warm ribbon curl — nested filled bands (cream → caramel → brown),
   bright highlight rim on the outer edge, soft drop shadow. */
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

const CX = 148, CY = 148, A0 = 66, A1 = 372; // gap (opening) centered toward bottom-right
const BANDS = [
  { layer: 'outer', r: 118, w: 28, light: '#F5DFB8', dark: '#EBCE97' }, // outer pale gold
  { layer: 'middle', r: 90, w: 28, light: '#EBB878', dark: '#DDA05E' }, // golden
  { layer: 'inner', r: 62, w: 28, light: '#D2924F', dark: '#B9793F' }, // caramel → brown
];

const Ribbons = ({
  id,
  animate,
  cornerDelayMs,
}: {
  id: string;
  animate: boolean;
  cornerDelayMs: number;
}) => (
  <svg viewBox="0 0 296 296" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
    <defs>
      {BANDS.map((b, i) => (
        <linearGradient key={i} id={`${id}-b${i}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={b.light} />
          <stop offset="1" stopColor={b.dark} />
        </linearGradient>
      ))}
      <filter id={`${id}-s`} x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="12" stdDeviation="13" floodColor="rgba(150,110,70,0.34)" />
      </filter>
    </defs>
    <g filter={`url(#${id}-s)`} fill="none" strokeLinecap="round">
      {BANDS.map((b, i) => {
        const layerDelayMs = cornerDelayMs + (BANDS.length - 1 - i) * RIBBON_LAYER_STAGGER_MS;

        return (
          <g
            key={b.layer}
            className={`qlogin-ribbon-band${animate ? ' qlogin-ribbon-band--turn' : ''}`}
            data-ribbon-corner={id}
            data-ribbon-layer={b.layer}
            style={{ animationDelay: `${layerDelayMs}ms` }}
          >
            {/* The highlight is part of the outer layer, so all visible pieces stay aligned. */}
            {i === 0 && (
              <path d={arcPath(CX, CY, b.r + 12, A0, A1)} stroke="#FEF6E4" strokeWidth="7" opacity="0.9" />
            )}
            <path d={arcPath(CX, CY, b.r, A0, A1)} stroke={`url(#${id}-b${i})`} strokeWidth={b.w} />
          </g>
        );
      })}
    </g>
  </svg>
);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successAnimationComplete, setSuccessAnimationComplete] = useState(false);
  const [shake, setShake] = useState(0);

  const router = useRouter();
  const { login, currentUser, isLoadingAuth, currentUserProfile } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!success) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeoutId = window.setTimeout(
      () => setSuccessAnimationComplete(true),
      reducedMotion ? 0 : RIBBON_SUCCESS_WINDOW_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [success]);

  useEffect(() => {
    if (isLoadingAuth || isLoading || !currentUser || !currentUserProfile) return;

    const target =
      currentUserProfile.role === 'lojistik_sorumlusu'
        ? LOJISTIK_HOME_PATH
        : currentUserProfile.role === 'sarf_dagitim_personeli'
          ? '/sarf-teslimat'
          : '/dashboard';

    // Existing sessions redirect immediately; fresh logins wait for the six ribbon turns.
    if (!success || successAnimationComplete) {
      router.replace(target);
    }
  }, [
    isLoadingAuth,
    isLoading,
    currentUser,
    currentUserProfile,
    success,
    successAnimationComplete,
    router,
  ]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading || success) return;
    setIsLoading(true);
    try {
      await login(email, password);
      setSuccess(true);
    } catch (error: any) {
      console.error('Login failed:', error);
      const errorMessage =
        error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-email'
          ? 'Hatalı e-posta veya şifre.'
          : 'Giriş sırasında bir hata oluştu: ' + (error.message || error.code);
      toast({ title: 'Giriş Başarısız', description: errorMessage, variant: 'destructive' });
      setShake((n) => n + 1);
    } finally {
      setIsLoading(false);
    }
  };

  // Already authenticated sessions render nothing while redirecting. A fresh login
  // stays mounted between Firebase auth and setSuccess so the exit animation is visible.
  if (isLoadingAuth || (currentUser && !success && !isLoading)) return null;

  const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8, letterSpacing: '0.01em' };
  const field: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center', height: 56, borderRadius: 'var(--radius-sm)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)' };
  const input: React.CSSProperties = { flex: 1, minWidth: 0, height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', padding: '0 8px' };

  return (
    <div className="qlogin">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* decorative ribbons — six independently staggered layers on successful login */}
      <div className="qlogin-ribbons">
        <div style={{ position: 'absolute', top: 'clamp(-72px,-7vw,-34px)', left: 'clamp(-72px,-7vw,-34px)', width: 'clamp(190px,32vw,320px)', height: 'clamp(190px,32vw,320px)' }}>
          <Ribbons id="tl" animate={success} cornerDelayMs={0} />
        </div>
        <div style={{ position: 'absolute', bottom: 'clamp(-72px,-7vw,-34px)', right: 'clamp(-72px,-7vw,-34px)', width: 'clamp(190px,32vw,320px)', height: 'clamp(190px,32vw,320px)', transform: 'rotate(180deg)' }}>
          <Ribbons id="br" animate={success} cornerDelayMs={RIBBON_CORNER_STAGGER_MS} />
        </div>
      </div>

      {/* card */}
      <div className="qlogin-card" style={{ borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', padding: 'clamp(26px,6vw,40px) clamp(22px,6vw,38px)', animation: `qFadeUp 500ms var(--ease-fluid)${shake ? `, qShake 400ms var(--ease-fluid)` : ''}` }} key={shake}>
        {/* logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <span style={{ width: 76, height: 76, borderRadius: 22, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(160deg, var(--accent-2), var(--accent))', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.45), 0 14px 28px -10px var(--accent-glow)' }}>
            <Sparkle size={38} strokeWidth={2.2} fill="#fff" />
          </span>
        </div>

        {success ? (
          <div role="status" aria-live="polite" style={{ textAlign: 'center', animation: 'qFadeUp 300ms var(--ease-fluid)' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 'clamp(26px,7vw,32px)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>Giriş Yap</h1>
            <p style={{ margin: '0 0 26px', fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', lineHeight: 1.5 }}>Devam etmek için hesabınızla oturum açın.</p>
            <div style={{ width: 84, height: 84, margin: '0 auto 18px', borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--ready))', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.5), 0 16px 30px -10px rgba(111,181,133,0.6)', animation: 'qPopIn 400ms var(--ease-fluid)' }}>
              <Check size={40} strokeWidth={3} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-1)' }}>Giriş başarılı</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)', marginTop: 6 }}>Yönlendiriliyorsunuz…</div>
          </div>
        ) : (
          <>
            <h1 style={{ margin: '0 0 6px', fontSize: 'clamp(26px,7vw,32px)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)', textAlign: 'center' }}>Giriş Yap</h1>
            <p style={{ margin: '0 0 26px', fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', lineHeight: 1.5, textAlign: 'center' }}>Devam etmek için hesabınızla oturum açın.</p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 18 }}>
                <label htmlFor="email" style={label}>E-posta</label>
                <div style={field}>
                  <span style={{ display: 'grid', placeItems: 'center', width: 52, flexShrink: 0, color: 'var(--ink-3)' }}><Mail size={19} /></span>
                  <input id="email" type="email" inputMode="email" autoComplete="email" placeholder="ornek@firma.com" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} style={{ ...input, paddingLeft: 0 }} />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label htmlFor="password" style={label}>Şifre</label>
                <div style={field}>
                  <span style={{ display: 'grid', placeItems: 'center', width: 52, flexShrink: 0, color: 'var(--ink-3)' }}><Lock size={19} /></span>
                  <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} style={{ ...input, paddingLeft: 0 }} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Şifreyi gizle' : 'Şifreyi göster'} style={{ all: 'unset', cursor: 'pointer', width: 52, height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flexShrink: 0 }}>
                    {showPw ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 24 }}>
                <button type="button" onClick={() => setRemember((v) => !v)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, color: '#fff', background: remember ? 'linear-gradient(160deg, var(--accent-2), var(--accent))' : 'var(--surface-hi)', boxShadow: remember ? '0 5px 11px -5px var(--accent-glow)' : 'var(--clay-inset)', transition: 'all 200ms var(--ease-fluid)' }}>
                    {remember && <Check size={15} strokeWidth={3.2} />}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Beni hatırla</span>
                </button>
                <button type="button" onClick={() => toast({ title: 'Şifre sıfırlama', description: 'Lütfen sistem yöneticinizle iletişime geçin.' })} style={{ all: 'unset', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Şifremi unuttum</button>
              </div>

              <button type="submit" disabled={isLoading} style={{ all: 'unset', boxSizing: 'border-box', cursor: isLoading ? 'default' : 'pointer', width: '100%', height: 56, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 16, fontWeight: 800, color: '#fff', background: 'linear-gradient(180deg, var(--accent-2), var(--accent))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px var(--accent-glow)', opacity: isLoading ? 0.85 : 1, transition: 'transform 160ms var(--ease-fluid)' }}
                onPointerDown={(e) => { if (!isLoading) e.currentTarget.style.transform = 'translateY(1px) scale(0.99)'; }}
                onPointerUp={(e) => (e.currentTarget.style.transform = '')}
                onPointerLeave={(e) => (e.currentTarget.style.transform = '')}>
                {isLoading ? <Loader2 size={20} style={{ animation: 'qSpin 0.8s linear infinite' }} /> : <>Giriş Yap <ArrowRight size={19} strokeWidth={2.4} /></>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
