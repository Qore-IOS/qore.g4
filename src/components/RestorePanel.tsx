
'use client';
import React from 'react';
import { restoreChangesAfterNoon } from '@/lib/restore';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function RestorePanel() {
  const [running, setRunning] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const { toast } = useToast();

  const onRestore = async () => {
    if (!confirm('Bu işlem geri alınamaz. 29.07.2025 tarihinde yapılan TÜM veri değişikliklerini geri yüklemek istediğinizden emin misiniz?')) {
        return;
    }
    setRunning(true);
    setMessage('');
    try {
      const { restoredCount } = await restoreChangesAfterNoon();
      const successMessage = `${restoredCount} belge, 29.07.2025 sabahki durumuna geri yüklendi.`;
      setMessage(successMessage);
      toast({ title: 'Geri Yükleme Başarılı', description: successMessage });
    } catch (err: any) {
      console.error(err);
      const errorMessage = `Hata: ${err.message}`;
      setMessage(errorMessage);
      toast({ title: 'Geri Yükleme Hatası', description: errorMessage, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2 text-destructive">
          <AlertTriangle />
          Tehlikeli Alan: Veri Geri Yükleme
        </CardTitle>
        <CardDescription>
          Bu panel, 29.07.2025 tarihinde yapılan tüm değişiklikleri geri alır.
          Bu işlem, yalnızca veri bozulması gibi acil durumlarda kullanılmalıdır.
          Bu özelliğin çalışması için sistemde `AuditLogs` koleksiyonunun aktif olması gerekir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-medium">
          Bu butona tıklamak, `AuditLogs` koleksiyonunu kullanarak 29.07.2025 tarihinde değiştirilen tüm belgeleri geri döndürme işlemini başlatacaktır.
        </p>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-4">
        <Button
          onClick={onRestore}
          disabled={running}
          variant="destructive"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {running ? 'Geri Yükleniyor...' : '29.07.2025 Değişikliklerini Geri Yükle'}
        </Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardFooter>
    </Card>
  );
}
