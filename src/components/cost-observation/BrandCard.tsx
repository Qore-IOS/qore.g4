'use client';

interface BrandCardProps {
  brand: { name: string; value: number; productCount: number };
  symbol: string;
  onClick: () => void;
}

export default function BrandCard({ brand, symbol, onClick }: BrandCardProps) {
  return (
    <button onClick={onClick} className="cihaz-pressed p-4 text-left hover:scale-[1.01] transition-transform">
      <p className="text-sm font-semibold text-[var(--dashboard-text)]">{brand.name}</p>
      <p className="text-xs text-[var(--dashboard-muted)]">{brand.productCount} ürün</p>
      <p className="text-lg font-bold text-[var(--dashboard-accent)] mt-1">{symbol}{brand.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
    </button>
  );
}
