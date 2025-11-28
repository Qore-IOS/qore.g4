'use client';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BarChart3, Wallet } from 'lucide-react';

export default function VerimlilikSwitch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const handleNavigate = (path: string) => {
    router.push(path);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader>
          <DialogTitle>Analiz Paneli</DialogTitle>
        </DialogHeader>
        <p className="font-semibold text-lg mb-4">Hangi panele gitmek istersiniz?</p>
        <div className="flex justify-center gap-4">
          <Button variant="outline" onClick={() => handleNavigate('/verimlilik-hesaplama')}>
            <BarChart3 className="w-5 h-5 mr-2" />
            Verimlilik
          </Button>
          <Button variant="outline" onClick={() => handleNavigate('/cost-dashboard')}>
            <Wallet className="w-5 h-5 mr-2" />
            Maliyet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
