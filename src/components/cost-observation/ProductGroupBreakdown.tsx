'use client';

interface ProductGroupBreakdownProps {
  groups: { group: string; value: number }[];
  symbol: string;
}

const labels: Record<string, string> = {
  kit: 'Kit',
  sarf: 'Sarf',
  yedek_parca: 'Yedek Parça',
  diger: 'Diğer',
};

export default function ProductGroupBreakdown({ groups, symbol }: ProductGroupBreakdownProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Ürün Grubu Kırılımı</h3>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.group} className="flex items-center justify-between text-sm">
            <span>{labels[g.group] || g.group}</span>
            <span className="font-semibold text-[var(--dashboard-accent)]">{symbol}{g.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
