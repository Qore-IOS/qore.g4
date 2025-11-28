
'use client';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PackagePlus, ShoppingBag, ArrowRightCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function MalKabulGirisModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const handleNavigate = (path: string) => {
    router.push(path);
    onClose();
  };

  const handleComingSoon = () => {
    toast({
      title: 'Geliştirme Aşamasında',
      description: 'Bu özellik yakında eklenecektir.',
      variant: 'default',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md text-center">
        <DialogHeader>
          <DialogTitle className="text-2xl font-headline">Lojistik İşlemleri</DialogTitle>
          <DialogDescription>Lütfen yapmak istediğiniz işlemi seçin.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <Button
            variant="default"
            size="lg"
            className="h-16 text-lg"
            onClick={() => handleNavigate('/mal-kabul')}
          >
            <PackagePlus className="w-6 h-6 mr-3" />
            Mal Kabul
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-16 text-lg"
            onClick={() => handleNavigate('/siparisler')}
          >
            <ShoppingBag className="w-6 h-6 mr-3" />
            Sipariş Oluştur
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-16 text-lg"
            onClick={handleComingSoon}
          >
            <ArrowRightCircle className="w-6 h-6 mr-3" />
            Direkt Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
