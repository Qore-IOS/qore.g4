/**
 * @fileoverview Paket damgası — "hangi sürümü çalıştırıyorum?"
 *
 * NEDEN VAR: Masaüstü paketi kurulduktan sonra ekrana bakarak yeni mi eski mi
 * olduğunu anlamanın hiçbir yolu yoktu. Arayüz paketi üretilmeden paketlenen
 * bir `.exe` sessizce yayındaki eski siteyi açıyordu ve kullanıcı bunu ancak
 * "yeni eklediklerimiz yok" diyerek fark edebiliyordu.
 *
 * Damga terminal ana ekranının altında görünür. Tek satır, ama "bu makinede
 * hangi derleme duruyor" sorusunu bakışta bitirir.
 *
 * Değerler `vite.config.terminal.ts` içinde derleme anında gömülür. Next
 * (web) derlemesinde tanımlı DEĞİLLERDİR — bu yüzden erişim `typeof` ile
 * korunur ve orada "web" damgası gösterilir.
 */

declare const __TERMINAL_BUILD_TIME__: string | undefined;
declare const __TERMINAL_BUILD_REV__: string | undefined;

export type TerminalBuildInfo = {
  /** Paketin üretildiği an (ISO) — web derlemesinde `null`. */
  builtAt: string | null;
  /** Kısa git revizyonu — web derlemesinde `null`. */
  rev: string | null;
  /** Ekranda gösterilecek tek satırlık özet. */
  label: string;
};

export function getTerminalBuildInfo(): TerminalBuildInfo {
  const builtAt = typeof __TERMINAL_BUILD_TIME__ !== 'undefined' ? __TERMINAL_BUILD_TIME__ : null;
  const rev = typeof __TERMINAL_BUILD_REV__ !== 'undefined' ? __TERMINAL_BUILD_REV__ : null;

  if (!builtAt) {
    // Web uygulaması üzerinden açılmış: sürüm zaten deploy ile belirlenir.
    return { builtAt: null, rev: null, label: 'web sürümü' };
  }

  const stamp = new Date(builtAt);
  const readable = Number.isNaN(stamp.getTime())
    ? builtAt
    : stamp.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

  return {
    builtAt,
    rev: rev || null,
    label: `paket ${readable}${rev ? ` · ${rev}` : ''}`,
  };
}
