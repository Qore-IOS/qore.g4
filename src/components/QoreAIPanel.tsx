'use client';

import { useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QoreAIPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function QoreAIPanel({ open, onClose }: QoreAIPanelProps) {
  // ESC tuşu ile kapatma
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  // Body scroll'u kilitle
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm',
        'animate-in fade-in-0 duration-200'
      )}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-4 border-b bg-background/80 backdrop-blur-md z-10">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Qore AI
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-9 w-9"
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Kapat</span>
        </Button>
      </div>

      {/* İframe Container */}
      <div className="pt-14 h-full">
        <iframe
          src="https://notebooklm.google.com/notebook/14f0834f-3273-4d94-afc7-f8c2b931e4c2"
          className="w-full h-full border-0"
          title="Qore AI"
          allow="clipboard-read; clipboard-write; microphone"
        />
      </div>
    </div>
  );
}
