'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Search,
  ChevronRight,
  Plus,
  Settings,
  Power,
  CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useAI } from '@/contexts/ai-context';
import { useStartMenu } from '@/contexts/start-menu-context';
import { VIEWS } from '@/lib/constants';
import {
  TONE_CHIP,
  toneForKey,
  PLACEHOLDER_RECENT_ACTIONS,
  PLACEHOLDER_DAILY_SUMMARY,
} from './data';

/* ---- shared surface / token classes (match the dock's glass language) ---- */
const SURFACE =
  'bg-white/85 dark:bg-zinc-900/85 backdrop-blur-2xl border border-gray-200/70 dark:border-white/10';
const SECTION_LABEL =
  'text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground';
const SEE_ALL =
  'text-[12.5px] font-semibold text-orange-600 dark:text-orange-400 inline-flex items-center gap-0.5 hover:opacity-80 transition';
const FIELD =
  'bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/10 shadow-[inset_2px_2px_6px_rgba(150,160,180,0.22),inset_-2px_-2px_6px_rgba(255,255,255,0.55)] dark:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.4)]';
const TILE =
  'bg-white dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_5px_16px_-8px_rgba(20,28,50,0.35)] dark:shadow-none';
const ROW =
  'flex items-center gap-3 w-full px-2.5 py-2 rounded-xl text-left transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]';
/** On-brand orange gradient — the app's primary identity (hue ~35). */
const BRAND = 'bg-gradient-to-br from-[#f99a52] to-[#f06f2c]';

/** Render **bold** segments of the daily-summary copy in the accent colour. */
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return (
        <b key={i} className="font-bold text-orange-600 dark:text-orange-400">
          {seg.slice(2, -2)}
        </b>
      );
    }
    return <React.Fragment key={i}>{seg}</React.Fragment>;
  });
}

export function StartMenu() {
  const { isOpen, close, toggle } = useStartMenu();
  const { currentUser, currentUserProfile, logout } = useAuth();
  const { openAI } = useAI();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [showAllPins, setShowAllPins] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Panels this user can reach (real data). Anonymous sessions see everything.
  const accessibleViews = useMemo<string[]>(
    () =>
      (currentUserProfile?.accessibleViews as string[] | undefined) ||
      (currentUser?.isAnonymous ? VIEWS.map((v) => v.key) : []),
    [currentUserProfile?.accessibleViews, currentUser?.isAnonymous],
  );

  // Navigable panels only (have an href — e.g. the action-only "planner" is out).
  const navViews = useMemo(
    () =>
      VIEWS.filter(
        (v) => v.type === 'nav' && !!v.href && accessibleViews.includes(v.key),
      ),
    [accessibleViews],
  );

  const q = query.trim();
  const results = useMemo(() => {
    if (!q) return [];
    const needle = q.toLocaleLowerCase('tr');
    return navViews
      .filter((v) => v.label.toLocaleLowerCase('tr').includes(needle))
      .slice(0, 8);
  }, [q, navViews]);

  const pins = showAllPins ? navViews : navViews.slice(0, 10);

  // ⌘K / Ctrl+K toggles the launcher anywhere; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape' && isOpen) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close, toggle]);

  // Focus search on open; reset transient state on close.
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    setQuery('');
    setShowAllPins(false);
  }, [isOpen]);

  const go = (href?: string) => {
    if (!href) return;
    router.push(href);
    close();
  };

  const askAI = () => {
    if (!q) return;
    openAI(q);
    close();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) go(results[0].href);
      else askAI();
    }
  };

  const displayName =
    currentUserProfile?.name ||
    currentUser?.displayName ||
    currentUser?.email?.split('@')[0] ||
    'Kullanıcı';
  const initials = displayName
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const role = currentUserProfile?.role?.replace(/_/g, ' ');

  const summary = PLACEHOLDER_DAILY_SUMMARY;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — sits *under* the dock so the taskbar stays visible. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
            className="fixed inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-[2px]"
            style={{ zIndex: 490 }}
          />

          {/* Centering wrapper — does NOT animate transform, so the panel's
              horizontal centering can't be clobbered by framer-motion's own
              transform (which is why it drifted right before). */}
          <div
            className="fixed inset-x-0 flex justify-center px-3 pointer-events-none"
            style={{
              bottom: 'calc(var(--dock-gap) + var(--dock-h) + 12px)',
              zIndex: 510,
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Başlat menüsü"
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.985 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className={cn(
                'pointer-events-auto w-[min(96vw,900px)] rounded-[24px] p-3.5 flex flex-col gap-2.5 overflow-y-auto',
                SURFACE,
              )}
              style={{
                maxHeight:
                  'calc(100vh - var(--dock-gap) - var(--dock-h) - 28px)',
                boxShadow:
                  '0 30px 70px -24px rgba(20,28,60,0.45), 0 8px 24px -12px rgba(20,28,60,0.30)',
              }}
            >
              {/* ---- AI command / search bar ---- */}
              <div className={cn('flex items-center gap-2.5 h-[46px] px-2.5 rounded-2xl', FIELD)}>
                <button
                  type="button"
                  onClick={askAI}
                  className={cn(
                    'grid place-items-center h-8 w-8 rounded-xl text-white shrink-0',
                    BRAND,
                  )}
                  style={{ boxShadow: '0 6px 13px -4px rgba(240,111,44,0.7)' }}
                  aria-label="Qore AI'ya sor"
                >
                  <Sparkles className="h-[17px] w-[17px]" />
                </button>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Qore AI'ya sorun ya da uygulamada arayın…"
                  className="flex-1 bg-transparent text-[14.5px] font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
                <kbd className="shrink-0 text-[11px] font-semibold text-muted-foreground px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/10">
                  ⌘ K
                </kbd>
              </div>

              {q ? (
                /* ---- search results ---- */
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={askAI} className={ROW}>
                    <span
                      className={cn(
                        'grid place-items-center h-9 w-9 rounded-xl text-white shrink-0',
                        BRAND,
                      )}
                    >
                      <Sparkles className="h-[18px] w-[18px]" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold text-foreground">
                        Qore AI&apos;ya sor
                      </span>
                      <span className="block text-[12.5px] text-muted-foreground truncate">
                        “{q}”
                      </span>
                    </span>
                    <CornerDownLeft className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                  </button>

                  {results.length > 0 && (
                    <div className={cn(SECTION_LABEL, 'mt-1.5 px-1')}>Paneller</div>
                  )}
                  {results.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => go(v.href)}
                      className={ROW}
                    >
                      <span
                        className={cn(
                          'grid place-items-center h-9 w-9 rounded-xl shrink-0',
                          TONE_CHIP[toneForKey(v.key)],
                        )}
                      >
                        <v.icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="flex-1 text-[14px] font-semibold text-foreground">
                        {v.label}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </button>
                  ))}
                  {results.length === 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground">
                      <Search className="h-4 w-4" />
                      Panel bulunamadı — Enter ile Qore AI’ya sorabilirsin.
                    </div>
                  )}
                </div>
              ) : (
                /* ---- default sections ---- */
                <>
                  {/* Günün özeti (placeholder — real AI digest wired later) */}
                  <div
                    className="rounded-2xl p-3 flex gap-2.5 items-start"
                    style={{
                      background:
                        'linear-gradient(150deg, rgba(244,123,52,.13), rgba(122,92,240,.12))',
                    }}
                  >
                    <span
                      className={cn(
                        'grid place-items-center h-9 w-9 rounded-xl text-white shrink-0',
                        BRAND,
                      )}
                      style={{ boxShadow: '0 8px 16px -6px rgba(240,111,44,.7)' }}
                    >
                      <Sparkles className="h-[18px] w-[18px]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                        {summary.eyebrow}
                      </div>
                      <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-foreground">
                        {renderEmphasis(summary.message)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {summary.actions.map((a, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => go(a.href)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-[12.5px] font-bold transition active:translate-y-px',
                              a.variant === 'primary'
                                ? cn(
                                    BRAND,
                                    'text-white shadow-[0_9px_18px_-7px_rgba(240,111,44,.8)]',
                                  )
                                : cn(TILE, 'text-foreground'),
                            )}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Sık kullanılanlar (real — from accessible panels) */}
                  <section>
                    <div className="flex items-baseline justify-between px-1">
                      <h3 className={SECTION_LABEL}>Sık Kullanılanlar</h3>
                      {navViews.length > 10 && (
                        <button
                          type="button"
                          onClick={() => setShowAllPins((s) => !s)}
                          className={SEE_ALL}
                        >
                          {showAllPins ? 'Daha az' : 'Tümünü gör'}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-5 gap-2">
                      {pins.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => go(v.href)}
                          className={cn(
                            'group flex flex-col items-center gap-1.5 rounded-xl px-1 pt-2 pb-2 transition hover:-translate-y-0.5 active:translate-y-0',
                            TILE,
                          )}
                        >
                          <span
                            className={cn(
                              'grid place-items-center h-9 w-9 rounded-xl',
                              TONE_CHIP[toneForKey(v.key)],
                            )}
                          >
                            <v.icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="text-[12px] font-semibold text-foreground text-center leading-tight">
                            {v.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Kestirmeler (placeholder area — content defined later) */}
                  <section>
                    <div className="flex items-baseline justify-between px-1">
                      <h3 className={SECTION_LABEL}>Kestirmeler</h3>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <button
                        type="button"
                        title="Yakında"
                        className={cn(
                          'inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl text-[13px] font-semibold text-foreground transition hover:-translate-y-0.5',
                          TILE,
                        )}
                      >
                        <span
                          className={cn(
                            'grid place-items-center h-6 w-6 rounded-lg text-white',
                            BRAND,
                          )}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                        Kestirme oluştur
                        <span className="ml-0.5 text-[9.5px] font-bold uppercase tracking-wide text-orange-600/80 dark:text-orange-400/80 bg-orange-500/10 rounded px-1.5 py-0.5">
                          Yakında
                        </span>
                      </button>
                      <span className="text-[12px] text-muted-foreground">
                        Sık tekrarladığın işlemleri tek tıkla çalıştır.
                      </span>
                    </div>
                  </section>

                  {/* Son yapılan işlemler — 2 sütun, tek ekrana sığsın diye
                      (placeholder; gerçek aktivite akışı sonra bağlanacak) */}
                  <section>
                    <div className="flex items-baseline justify-between px-1">
                      <h3 className={SECTION_LABEL}>Son Yapılan İşlemler</h3>
                      <span className="text-[11px] font-medium text-muted-foreground/70">
                        Yakında gerçek veri
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {PLACEHOLDER_RECENT_ACTIONS.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2.5 px-1.5 py-1 rounded-xl"
                        >
                          <span
                            className={cn(
                              'grid place-items-center h-8 w-8 rounded-xl shrink-0',
                              TONE_CHIP[a.tone],
                            )}
                          >
                            <a.icon className="h-[16px] w-[16px]" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-foreground truncate">
                              {a.title}
                            </span>
                            <span className="block text-[11.5px] text-muted-foreground truncate">
                              {a.subtitle}
                            </span>
                          </span>
                          <span className="text-[11.5px] font-semibold text-muted-foreground whitespace-nowrap">
                            {a.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* ---- footer: user + settings + power ---- */}
              <div className="flex items-center justify-between pt-2 mt-0.5 border-t border-black/[0.06] dark:border-white/[0.08]">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid place-items-center h-9 w-9 rounded-full text-white font-extrabold text-[14px]"
                    style={{ background: 'linear-gradient(140deg,#7a5cf0,#f06f2c)' }}
                  >
                    {initials}
                  </span>
                  <span>
                    <span className="block text-[14px] font-bold text-foreground">
                      {displayName}
                    </span>
                    {role && (
                      <span className="block text-[11.5px] text-muted-foreground capitalize">
                        {role}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => go('/yonetim/kisisellistirme')}
                    className={cn(
                      'grid place-items-center h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground transition',
                      TILE,
                    )}
                    aria-label="Ayarlar"
                    title="Ayarlar"
                  >
                    <Settings className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      logout();
                    }}
                    className={cn(
                      'grid place-items-center h-9 w-9 rounded-xl text-muted-foreground hover:text-orange-500 transition',
                      TILE,
                    )}
                    aria-label="Çıkış Yap"
                    title="Çıkış Yap"
                  >
                    <Power className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

export default StartMenu;
