'use client';
import { useState, type FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useTheme } from 'next-themes';


export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const { login, currentUser, isLoadingAuth, currentUserProfile } = useAuth();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === 'light' ? '/blk.png' : '/wt.webp';

  useEffect(() => {
    if (!isLoadingAuth && currentUser) {
      const target =
        currentUserProfile?.role === 'lojistik_sorumlusu'
          ? '/siparisler'
          : '/dashboard';
      router.replace(target);
    }
  }, [isLoadingAuth, currentUser, currentUserProfile?.role, router]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      toast({ title: "Giriş Başarılı", description: "Panele yönlendiriliyorsunuz..." });
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
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-sm border border-border bg-card shadow-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center">
            <Image 
              src={logoSrc}
              alt="Qore Logo"
              width={77}
              height={77}
              className="object-contain"
              priority
            />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">Giriş Yap</CardTitle>
          <CardDescription>Devam etmek için hesabınızla oturum açın.</CardDescription>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="ornek@firma.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={anyLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={anyLoading}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" size="default" disabled={anyLoading}>
              {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Sign In"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
