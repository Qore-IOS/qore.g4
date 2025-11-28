'use client';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BackButton({ fallback = '/' }: { fallback?: string }) {
  const router = useRouter();

  const handleBack = () => {
    // Check if there's history to go back to. window.history.length includes the current page.
    // length > 2 means there is at least one previous page in the session history.
    if (window.history.length > 2) {
      router.back();
    } else {
      router.push(fallback);
    }
  };

  return (
    <Button
      onClick={handleBack}
      variant="ghost"
      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary pl-1"
    >
      <ChevronLeft size={18} />
      Geri Dön
    </Button>
  );
}
