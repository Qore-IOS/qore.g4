import type { ReactNode } from 'react';
import { ClayShell } from '@/components/mal-kabul/clay-kit';

/**
 * Yönetim ağacının tek görsel sözleşmesi.
 * Bu layout sayesinde yeni eklenen tüm /yonetim alt rotaları da ayrıca tema
 * kodu yazılmadan ortak clay yüzey, renk ve mobil ölçü sistemine dahil olur.
 */
export default function YonetimLayout({ children }: { children: ReactNode }) {
  return <ClayShell className="yonetim-clay-scope">{children}</ClayShell>;
}
