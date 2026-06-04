'use client';
import type React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BackButtonProps = React.ComponentPropsWithoutRef<typeof Button> & {
  fallback?: string;
  fallbackUrl?: string;
};

export default function BackButton({ fallback = '/', fallbackUrl, className, ...props }: BackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    // Check if there's history to go back to. window.history.length includes the current page.
    // length > 2 means there is at least one previous page in the session history.
    if (window.history.length > 2) {
      router.back();
    } else {
      router.push(fallbackUrl || fallback);
    }
  };

  return (
    <Button
      {...props}
      onClick={handleBack}
      variant="ghost"
      className={cn(
        "qore-local-back-button flex items-center gap-2 text-sm text-muted-foreground hover:text-primary pl-1",
        className,
      )}
    >
      <ChevronLeft size={18} />
      Geri Dön
    </Button>
  );
}
