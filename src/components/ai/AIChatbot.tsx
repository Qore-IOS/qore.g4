'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Send, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAI } from '@/contexts/ai-context';
import { AIGlowEffect } from './AIGlowEffect';
import { useTheme } from 'next-themes';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolsUsed?: string[];
  requiresConfirmation?: boolean;
}

// Keywords that trigger agent mode
const AGENT_KEYWORDS = [
  // Aksiyon kelimeleri
  'oluştur', 'olustur', 'yap', 'hazırla', 'başlat', 'baslat',
  'sipariş', 'siparis', 'transfer', 'sevk', 'gönder', 'gonder',
  'planla', 'düzenle', 'ekle', 'sil', 'güncelle', 'guncelle',
  // Analiz kelimeleri
  'analiz', 'kontrol', 'incele', 'bul', 'listele',
  'düşük stok', 'dusuk stok', 'eksik', 'kritik', 'altında', 'altinda',
  // Sorgu kelimeleri
  'hangi lab', 'hangi hastane', 'stok durumu', 'doluluk',
  'min max', 'minimum', 'maksimum', 'ihtiyaç', 'ihtiyac',
];

function shouldUseAgentMode(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return AGENT_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

export function AIChatbot() {
  const { isAIOpen, closeAI } = useAI();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Merhaba! Ben Qore AI asistanıyım. Size yardımcı olabileceğim konular:

📊 **Sorgulama**: Stok durumu, tüketim analizi, cihaz arızaları
🔄 **Aksiyon**: Sipariş oluşturma, transfer önerileri
📈 **Analiz**: Düşük stoklar, miad takibi, verimlilik

Örnek: "Stok doluluk oranı %50 altındaki lablar için sipariş oluştur"`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isAIOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isAIOpen]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      },
    ]);

    try {
      const history = messages
        .filter((m) => m.id !== '1')
        .map((m) => ({ role: m.role, content: m.content }));

      // Automatically detect if agent mode should be used
      const useAgent = shouldUseAgentMode(userMessage.content);
      console.log(`[AIChatbot] Mode: ${useAgent ? 'AGENT' : 'CHAT'}`);

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          history,
          stream: true,
          mode: useAgent ? 'agent' : 'chat',
        }),
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
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: `Hata: ${data.error}`, isStreaming: false }
                      : m
                  )
                );
              } else if (data.chunk) {
                fullContent += data.chunk;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: fullContent }
                      : m
                  )
                );
              }
              if (data.done) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          isStreaming: false,
                          toolsUsed: data.toolsUsed,
                          requiresConfirmation: data.requiresConfirmation,
                        }
                      : m
                  )
                );
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.',
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Glow effect around screen edges */}
      <AIGlowEffect isActive={isAIOpen} />

      {/* Full screen chat overlay */}
      <AnimatePresence>
        {isAIOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              paddingTop: 'env(safe-area-inset-top, 20px)',
              paddingBottom: 'env(safe-area-inset-bottom, 20px)',
              paddingLeft: 'env(safe-area-inset-left, 20px)',
              paddingRight: 'env(safe-area-inset-right, 20px)',
            }}
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "absolute inset-0",
                isDark
                  ? "bg-black/90 backdrop-blur-xl"
                  : "bg-white/90 backdrop-blur-xl"
              )}
              onClick={closeAI}
            />

            {/* Chat Container */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={cn(
                "relative w-full max-w-2xl h-[80vh] max-h-[700px] flex flex-col rounded-3xl overflow-hidden",
                isDark
                  ? "bg-gray-900/80 border border-white/10 shadow-2xl"
                  : "bg-white/80 border border-gray-200 shadow-2xl"
              )}
            >
              {/* Header */}
              <div className={cn(
                "flex items-center justify-between p-4 border-b",
                isDark ? "border-white/10" : "border-gray-200"
              )}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      "bg-gradient-to-br from-purple-500 to-blue-500"
                    )}>
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900" />
                  </div>
                  <div>
                    <h2 className={cn(
                      "font-semibold text-lg",
                      isDark ? "text-white" : "text-gray-900"
                    )}>
                      Qore AI
                    </h2>
                    <p className={cn(
                      "text-sm",
                      isDark ? "text-gray-400" : "text-gray-500"
                    )}>
                      Akıllı stok ve operasyon asistanı
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeAI}
                  className={cn(
                    "rounded-full",
                    isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                  )}
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'flex',
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                          message.role === 'user'
                            ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white'
                            : isDark
                              ? 'bg-white/10 text-white'
                              : 'bg-gray-100 text-gray-900'
                        )}
                      >
                        <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                        {message.isStreaming && (
                          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse rounded" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                  {isLoading && messages[messages.length - 1]?.content === '' && (
                    <div className="flex justify-start">
                      <div className={cn(
                        "rounded-2xl px-4 py-3",
                        isDark ? "bg-white/10" : "bg-gray-100"
                      )}>
                        <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className={cn(
                "p-4 border-t",
                isDark ? "border-white/10" : "border-gray-200"
              )}>
                <div className="flex gap-3">
                  <Input
                    ref={inputRef}
                    placeholder="Bir soru sorun..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                    className={cn(
                      "flex-1 rounded-full px-4",
                      isDark
                        ? "bg-white/10 border-white/10 text-white placeholder:text-gray-400"
                        : "bg-gray-100 border-gray-200"
                    )}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    size="icon"
                    className="rounded-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 h-10 w-10"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
