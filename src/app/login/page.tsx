'use client';
import { useState, type FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserCircle, AlertCircle, LogIn, Nfc } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
import GradientBlinds from '@/components/GradientBlinds';
import StarBorder from '@/components/ui/StarBorder';
import { NfcLoginDialog } from '@/components/NfcLoginDialog';


export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unauthorizedDomainError, setUnauthorizedDomainError] = useState(false);
  const [hostname, setHostname] = useState('');
  const [isNfcDialogOpen, setIsNfcDialogOpen] = useState(false);


  const router = useRouter();
  const { login, currentUser, isLoadingAuth } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    // This will only run on the client side
    setHostname(window.location.hostname);
    if (!isLoadingAuth && currentUser) {
      // Default redirect - will be updated by AutoRedirectOnLogin based on user role
      router.replace('/dashboard');
    }
  }, [isLoadingAuth, currentUser, router]);

  useEffect(() => {
    function onPrefill(e: any) {
      const { email } = e.detail || {};
      if (email) {
        setEmail(email);
        // Password cannot be autofilled for security reasons
        toast({
          title: "Kullanıcı Bulundu",
          description: "Lütfen şifrenizi girerek devam edin.",
        });
      }
    }
    window.addEventListener('nfc:prefillCredentials', onPrefill as any);
    return () => window.removeEventListener('nfc:prefillCredentials', onPrefill as any);
  }, [toast]);


  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setUnauthorizedDomainError(false);
    try {
      await login(email, password);
      toast({ title: "Giriş Başarılı", description: "Panele yönlendiriliyorsunuz..." });
      router.push('/dashboard');
    } catch (error: any) {
      console.error("Login failed:", error);
      const errorMessage = error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-email'
        ? "Hatalı e-posta veya şifre."
        : "Giriş sırasında bir hata oluştu: " + (error.message || error.code);
      toast({
        title: "Giriş Başarısız",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingAuth || currentUser) {
    // The LoadingProvider will show the splash screen, so we can return null or a minimal loader.
    return null;
  }

  const anyLoading = isLoading;

  return (
    <>
    <div className="flex items-center justify-center min-h-screen bg-background p-4 relative">
       
       <div className="absolute inset-0 z-0">
        <GradientBlinds
            gradientColors={['#FF9FFC', '#5227FF']}
            angle={20}
            noise={0.5}
            blindCount={16}
            blindMinWidth={60}
            spotlightRadius={0.5}
            spotlightSoftness={1}
            spotlightOpacity={1}
            distortAmount={0}
            shineDirection="left"
            mixBlendMode="lighten"
        />
       </div>

      <Card className="w-full max-w-md glass-card shadow-2xl z-10">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <Image 
              src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG" 
              alt="Qore Engine Logo" 
              width={120} 
              height={120}
              data-ai-hint="logo"
              className="object-contain"
            />
          </div>
          <CardTitle className="text-2xl md:text-3xl font-headline text-primary">QORE</CardTitle>
          <CardDescription>Devam etmek için lütfen giriş yapın.</CardDescription>
        </CardHeader>
        
        {unauthorizedDomainError && (
          <div className="px-6 pb-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Yapılandırma Gerekli</AlertTitle>
              <AlertDescription>
                <p className="font-bold">Bu alan adı (<span className="font-mono bg-destructive/20 px-1 py-0.5 rounded">{hostname}</span>) giriş için yetkilendirilmemiş.</p>
                <p className="mt-2 text-xs">Düzeltmek için Firebase Console'a gidin -&gt; Authentication -&gt; Settings -&gt; Authorized domains, ve '{hostname}' adresini ekleyin.</p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">E-posta</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 text-base bg-input/80 cursor-target"
                disabled={anyLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Şifre</Label>
              <Input
                id="password"
                type="password"
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 text-base bg-input/80 cursor-target"
                disabled={anyLoading}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
             <StarBorder
              as="button"
              type="submit"
              className="w-full cursor-target"
              color="hsl(var(--primary))"
              speed="5s"
              thickness={1}
              disabled={anyLoading}
            >
              <span className="flex items-center justify-center">
                {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Giriş Yap
              </span>
            </StarBorder>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setIsNfcDialogOpen(true)}
            >
              <Nfc className="mr-2 h-5 w-5" />
              NFC Kart ile Giriş Yap
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
    <NfcLoginDialog open={isNfcDialogOpen} onOpenChange={setIsNfcDialogOpen} />
    </>
  );
}
