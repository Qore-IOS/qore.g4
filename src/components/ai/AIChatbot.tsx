'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, Sparkles, Mic, SendHorizonal, ChevronRight, HeartPulse,
  Stethoscope, BellRing, MapPin, Clock, Bookmark, User as UserIcon, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAI } from '@/contexts/ai-context';
import { useAuth } from '@/contexts/auth-context';
import { getAuth } from '../../lib/workspace';

const QoreOrb3D = dynamic(() => import('./QoreOrb3D'), { ssr: false });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface QuickAction {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  hue: 'purple' | 'cyan' | 'blue' | 'teal';
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'stock',
    label: 'Stok\nAnalizi',
    Icon: HeartPulse,
    prompt: 'Düşük stok seviyesindeki ürünleri listele',
    hue: 'purple',
  },
  {
    id: 'order',
    label: 'Sipariş\nÖner',
    Icon: Stethoscope,
    prompt: 'Hangi laboratuvarlar için sipariş önerirsin?',
    hue: 'cyan',
  },
  {
    id: 'expiry',
    label: 'Miad\nTakibi',
    Icon: BellRing,
    prompt: 'Önümüzdeki 30 gün içinde miadı dolacak ürünler hangileri?',
    hue: 'blue',
  },
  {
    id: 'devices',
    label: 'Cihaz\nDurumu',
    Icon: MapPin,
    prompt: 'Açık cihaz arızalarını ve durumlarını özetler misin?',
    hue: 'teal',
  },
];

const HUE_STYLES: Record<QuickAction['hue'], { icon: string; ring: string }> = {
  purple: { icon: 'text-fuchsia-400', ring: 'shadow-[0_0_24px_-8px_rgba(217,70,239,0.55)]' },
  cyan:   { icon: 'text-cyan-300',   ring: 'shadow-[0_0_24px_-8px_rgba(34,211,238,0.55)]' },
  blue:   { icon: 'text-indigo-300', ring: 'shadow-[0_0_24px_-8px_rgba(99,102,241,0.55)]' },
  teal:   { icon: 'text-teal-300',   ring: 'shadow-[0_0_24px_-8px_rgba(45,212,191,0.55)]' },
};

export function AIChatbot() {
  const { isAIOpen, closeAI, consumePendingPrompt } = useAI();
  const { currentUserProfile, currentUser } = useAuth();

  const firstName = useMemo(() => {
    const raw = currentUserProfile?.name || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Kullanıcı';
    return raw.split(' ')[0];
  }, [currentUserProfile, currentUser]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lock body scroll when full-screen is open
  useEffect(() => {
    if (!isAIOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [isAIOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset chat to home when closing
  useEffect(() => {
    if (!isAIOpen) {
      // Slight delay so the exit animation can play first
      const t = setTimeout(() => {
        setShowChat(false);
        setMessages([]);
        setInput('');
      }, 250);
      return () => clearTimeout(t);
    }
  }, [isAIOpen]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    setShowChat(true);

    const userMessage: Message = {
      id: `${Date.now()}-u`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const assistantId = `${Date.now()}-a`;
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
    ]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      // Attach Firebase ID token so the server can scope the engine to this user.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const idToken = await getAuth().currentUser?.getIdToken();
        if (idToken) headers.Authorization = `Bearer ${idToken}`;
      } catch { /* anonymous → server uses fallback context */ }

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text, history, stream: true }),
      });

      if (!response.ok) throw new Error('API hatası');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Stream okunamadı');

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) {
              setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, content: `Hata: ${data.error}`, isStreaming: false } : m,
              ));
            } else if (data.chunk) {
              fullContent += data.chunk;
              setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, content: fullContent } : m,
              ));
            }
            if (data.done) {
              setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, isStreaming: false } : m,
              ));
            }
          } catch { /* skip */ }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.', isStreaming: false }
          : m,
      ));
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  // Keep a ref to the latest sendMessage so the "open with queued prompt"
  // effect can fire it without re-subscribing on every keystroke.
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // When opened from the Start menu search bar a prompt is queued on the AI
  // context; consume and auto-send it once the panel is open.
  useEffect(() => {
    if (!isAIOpen) return;
    const queued = consumePendingPrompt();
    if (!queued) return;
    const t = setTimeout(() => sendMessageRef.current(queued), 60);
    return () => clearTimeout(t);
  }, [isAIOpen, consumePendingPrompt]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <AnimatePresence>
      {isAIOpen && (
        <motion.div
          key="qore-ai-fullscreen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] bg-black text-white overflow-hidden"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          {/* Background ambient gradients */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-black" />
            <div className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-fuchsia-600/10 blur-[120px]" />
            <div className="absolute -bottom-40 -right-32 h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-[140px]" />
          </div>

          <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col px-4 sm:px-6 md:px-8 lg:px-10">
            <Header onClose={closeAI} />

            {/* HERO + CHAT REGION */}
            <div className="relative flex flex-1 flex-col overflow-hidden">
              {/* HOME (welcome) view */}
              <AnimatePresence mode="wait">
                {!showChat ? (
                  <motion.div
                    key="home"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-1 flex-col overflow-y-auto"
                  >
                    <InsightCard />
                    <div className="flex flex-1 flex-col items-center justify-start pt-6 sm:pt-8 md:pt-10">
                      <div className="text-center">
                        <h1 className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text text-3xl font-semibold text-transparent sm:text-4xl md:text-5xl">
                          Merhaba, {firstName}
                        </h1>
                        <p className="mt-2 text-sm text-zinc-400 sm:text-base md:text-lg">
                          Bugün size nasıl yardımcı olabilirim?
                        </p>
                      </div>

                      {/* 3D Orb */}
                      <div className="relative my-2 aspect-square w-full max-w-[78vmin] sm:max-w-[60vmin] md:max-w-[52vmin] lg:max-w-[480px]">
                        <QoreOrb3D isProcessing={isLoading} className="h-full w-full" />
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="chat"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-1 flex-col overflow-hidden"
                  >
                    {/* Small Orb above the chat */}
                    <div className="mx-auto mt-2 h-32 w-32 sm:h-40 sm:w-40 md:h-48 md:w-48 shrink-0">
                      <QoreOrb3D isProcessing={isLoading} className="h-full w-full" />
                    </div>

                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 pb-4">
                      <div className="mx-auto flex max-w-3xl flex-col gap-3">
                        {messages.map((m) => (
                          <motion.div
                            key={m.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                          >
                            <div
                              className={cn(
                                'max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:text-[15px]',
                                m.role === 'user'
                                  ? 'bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white shadow-[0_0_24px_-6px_rgba(168,85,247,0.55)]'
                                  : 'border border-white/10 bg-white/[0.04] text-zinc-100 backdrop-blur-sm',
                              )}
                            >
                              {m.content}
                              {m.isStreaming && (
                                <span className="ml-1 inline-block h-4 w-[6px] translate-y-[2px] animate-pulse rounded-sm bg-current" />
                              )}
                              {m.isStreaming && m.content === '' && (
                                <Loader2 className="h-4 w-4 animate-spin text-fuchsia-300" />
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* QUICK ACTIONS — visible only on home */}
            {!showChat && (
              <QuickActions
                onSelect={(prompt) => {
                  setInput(prompt);
                  setTimeout(() => sendMessage(prompt), 0);
                }}
              />
            )}

            {/* COMPOSER */}
            <Composer
              inputRef={inputRef}
              value={input}
              disabled={isLoading}
              onChange={setInput}
              onKeyDown={handleKey}
              onSend={() => sendMessage()}
            />

            {/* BOTTOM DOCK */}
            <BottomDock
              onHomeClick={() => {
                setShowChat(false);
                setMessages([]);
              }}
              active={showChat ? 'history' : 'home'}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Header ---------- */

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between pt-3 sm:pt-4 pb-3">
      <button
        type="button"
        onClick={onClose}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm transition hover:bg-white/[0.07]"
        aria-label="Kapat"
      >
        <Menu className="h-5 w-5 text-zinc-200" />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-zinc-100 sm:text-lg">Qore AI</span>
        <span className="rounded-md border border-cyan-400/40 bg-cyan-400/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">
          Gemini
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-500" />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm transition hover:bg-white/[0.07]"
        aria-label="Sparkle"
      >
        <Sparkles className="h-5 w-5 text-fuchsia-300" />
      </button>
    </div>
  );
}

/* ---------- Insight Card ---------- */

function InsightCard() {
  return (
    <div className="relative w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15">
          <HeartPulse className="h-5 w-5 text-fuchsia-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 sm:text-[15px]">Operasyon raporu hazır</p>
          <p className="truncate text-xs text-zinc-400 sm:text-sm">Haftalık özet ve içgörüler görüntülenebilir.</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full border border-cyan-400/60 px-3 py-1.5 text-xs font-medium text-cyan-300 transition hover:bg-cyan-400/10 sm:text-sm"
        >
          Raporu Aç
        </button>
      </div>
    </div>
  );
}

/* ---------- Quick Actions ---------- */

function QuickActions({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 pb-3 sm:gap-3">
      {QUICK_ACTIONS.map((a) => {
        const styles = HUE_STYLES[a.hue];
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.prompt)}
            className={cn(
              'group flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3 backdrop-blur-sm transition hover:bg-white/[0.06]',
              styles.ring,
            )}
          >
            <a.Icon className={cn('h-5 w-5 sm:h-6 sm:w-6', styles.icon)} />
            <span className="whitespace-pre-line text-center text-[10px] font-medium leading-tight text-zinc-200 sm:text-xs">
              {a.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Composer ---------- */

interface ComposerProps {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => void;
}

function Composer({ inputRef, value, disabled, onChange, onKeyDown, onSend }: ComposerProps) {
  return (
    <div className="relative pb-2">
      <div
        className="relative flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-2 py-2 backdrop-blur-sm"
        style={{
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.04), 0 0 32px -8px rgba(168,85,247,0.45), 0 0 32px -8px rgba(34,211,238,0.4)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder="Bir mesaj yazın..."
          className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none sm:text-base"
        />
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/80 to-violet-600/80 text-white shadow-[0_0_18px_-4px_rgba(168,85,247,0.7)] transition hover:from-fuchsia-500 hover:to-violet-600"
          aria-label="Sesle giriş"
        >
          <Mic className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 transition',
            'hover:bg-cyan-500/20 disabled:opacity-40 disabled:hover:bg-cyan-500/10',
          )}
          aria-label="Gönder"
        >
          {disabled ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

/* ---------- Bottom Dock ---------- */

interface BottomDockProps {
  onHomeClick: () => void;
  active: 'home' | 'history';
}

function BottomDock({ onHomeClick, active }: BottomDockProps) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 backdrop-blur-sm">
      <DockButton Icon={Sparkles} active={false} tone="fuchsia" />
      <DockButton Icon={Clock} active={active === 'history'} tone="zinc" />
      <button
        type="button"
        onClick={onHomeClick}
        aria-label="Ana sayfa"
        className="relative -my-4 h-14 w-14 shrink-0 rounded-full border border-white/15 bg-black p-1 shadow-[0_0_24px_-4px_rgba(168,85,247,0.55)]"
      >
        <div className="h-full w-full overflow-hidden rounded-full">
          <QoreOrb3D className="h-full w-full" />
        </div>
      </button>
      <DockButton Icon={Bookmark} active={false} tone="zinc" />
      <DockButton Icon={UserIcon} active={false} tone="zinc" />
    </div>
  );
}

function DockButton({
  Icon, active, tone,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  tone: 'fuchsia' | 'zinc';
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center rounded-xl transition hover:bg-white/[0.06]"
    >
      <Icon
        className={cn(
          'h-5 w-5',
          active ? 'text-fuchsia-300' : tone === 'fuchsia' ? 'text-fuchsia-300' : 'text-zinc-400',
        )}
      />
    </button>
  );
}
