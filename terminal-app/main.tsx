/**
 * @fileoverview Masaüstü terminal paketinin giriş noktası.
 *
 * Web uygulamasının `src/app/layout.tsx` dosyasındaki sağlayıcı yığınının
 * terminal için gereken alt kümesini kurar. Bilerek dışarıda bırakılanlar:
 * analytics, web vitals, tema anahtarı, AI sohbeti, mobil düzeltmeler.
 * Terminal tek bir makinede, tek bir işte, karanlık temada çalışır.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import { AuthProvider } from '@/contexts/auth-context';
import { QueryProvider } from '@/contexts/query-context';
import { Toaster } from '@/components/ui/toaster';

import { TerminalRouterProvider } from './shims/next-navigation';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root bulunamadı');

createRoot(container).render(
  <React.StrictMode>
    {/* Router EN DIŞTA: AuthProvider `useRouter` çağırıyor ve sağlayıcı
        olmadan hata verir. */}
    <TerminalRouterProvider>
      <AuthProvider>
        <QueryProvider>
          <App />
          <Toaster />
        </QueryProvider>
      </AuthProvider>
    </TerminalRouterProvider>
  </React.StrictMode>,
);
