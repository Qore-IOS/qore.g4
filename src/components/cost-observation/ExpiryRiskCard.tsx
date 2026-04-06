'use client';

interface ExpiryRiskCardProps {
  risk30: number;
  risk90: number;
  symbol: string;
}

export default function ExpiryRiskCard({ risk30, risk90, symbol }: ExpiryRiskCardProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Miad Risk Maliyeti</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="cihaz-pressed p-3">
          <p className="text-xs text-[var(--dashboard-muted)]">30 gün risk</p>
          <p className="text-lg font-bold text-red-500">{symbol}{risk30.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="cihaz-pressed p-3">
          <p className="text-xs text-[var(--dashboard-muted)]">90 gün risk</p>
          <p className="text-lg font-bold text-amber-500">{symbol}{risk90.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>
    </div>
  );
}
