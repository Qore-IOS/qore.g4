'use client';

import React, { useMemo, useState } from 'react';
import { Bot, MessageCircle, Send, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
}

export default function PurchasingAgentChat({
  userUid,
  userName,
}: {
  userUid?: string;
  userName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Merhaba! Satın Alma Agent hazırım. Görev ekleme/silme/düzenleme, personel ekleme, tarih-saat güncelleme ve takvim analizi komutlarını yazabilirsiniz.',
    },
  ]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/purchasing-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          userUid,
          userName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Agent yanıt veremedi');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: data.reply || 'İşlem tamamlandı.',
          meta: data.summary || undefined,
        },
      ]);

      if (data.actionsApplied > 0) {
        toast.success(`${data.actionsApplied} işlem uygulandı`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Agent hatası');
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: 'assistant',
          text: 'Üzgünüm, bu komutu işlerken hata oluştu. Daha açık bir şekilde tekrar yazabilirsiniz.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed right-5 md:right-8 z-50 w-12 h-12 rounded-full border border-border shadow-lg',
          'bg-card text-foreground flex items-center justify-center',
          'bottom-36 md:bottom-28'
        )}
        aria-label="Satın Alma Agent"
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {open && (
        <div className="fixed z-50 right-4 md:right-8 bottom-52 md:bottom-44 w-[min(92vw,380px)] h-[min(64vh,540px)] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Bot className="w-4 h-4" />
            <div>
              <p className="text-sm font-semibold">Satın Alma Agent</p>
              <p className="text-[11px] text-muted-foreground">Gemini destekli görev asistanı</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-secondary/20">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-xl px-3 py-2 text-sm',
                  m.role === 'user'
                    ? 'bg-[#d4ec00]/35 text-foreground ml-8'
                    : 'bg-card border border-border mr-6'
                )}
              >
                <p>{m.text}</p>
                {m.meta && <p className="mt-1 text-[11px] text-muted-foreground">{m.meta}</p>}
              </div>
            ))}
            {loading && (
              <div className="rounded-xl px-3 py-2 text-sm bg-card border border-border mr-6 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Düşünüyorum...
              </div>
            )}
          </div>

          <div className="p-2 border-t border-border flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Örn: Yarın 15:00 toplantımı iptal et, 10:00 görevine Ahmet Yılmaz ekle"
              className="flex-1 h-9 px-3 rounded-xl border border-border bg-secondary text-sm outline-none"
            />
            <button
              onClick={sendMessage}
              disabled={!canSend}
              className={cn(
                'h-9 w-9 rounded-xl flex items-center justify-center',
                canSend ? 'bg-[#d4ec00] text-zinc-900' : 'bg-secondary text-muted-foreground'
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
