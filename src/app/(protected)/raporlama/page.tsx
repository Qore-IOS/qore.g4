'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { exportAllDataToJSON } from '@/lib/utils';
import {
  FileSpreadsheet, FileJson, FileText, Loader2, CalendarClock, Activity,
  Archive, Barcode, Trash2, Package, ArrowLeftRight, FolderOpen, TrendingUp,
  Download, DatabaseZap, AlertTriangle, BarChart3,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  C, AC, ClayPage, useMode, Card, FeatureCard, SoftBtn, Modal, ModalHead, ModalActionRow,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// ─── Export tile (matches demo ExportBtn) ───────────────────────────────────
function ExportTile({
  icon, title, sub, onClick, disabled, loading, tone,
}: {
  icon: React.ReactNode; title: string; sub: string; onClick: () => void;
  disabled?: boolean; loading?: boolean; tone?: 'water';
}) {
  const [p, setP] = useState(false);
  const col = tone === 'water' ? C.waterDeep : AC.primary;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      onPointerDown={() => !disabled && setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 18px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: p ? C.clayPress : C.clayFlat,
        opacity: disabled ? 0.55 : 1, transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}`,
        transform: p ? 'translateY(1px) scale(0.99)' : 'none',
      }}
    >
      <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', color: col, background: C.surface2, boxShadow: C.clayInset }}>
        {loading ? <Loader2 size={20} style={{ animation: 'cySpin 1s linear infinite' }} /> : icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink1 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.ink2, fontWeight: 500, marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ color: col, flexShrink: 0 }}><Download size={20} /></span>
    </button>
  );
}

export default function RaporlamaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const mode = useMode();
  const mobile = mode === 'mobile';
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'xlsx' | null>(null);
  const [isStokModalOpen, setIsStokModalOpen] = useState(false);

  const handleExport = async (format: 'json' | 'xlsx') => {
    setIsExporting(true);
    setExportFormat(format);
    toast({ title: 'Dışa Aktarma Başlatıldı', description: 'Sunucu üzerinden veriler toplanıyor. Bu işlem biraz zaman alabilir...' });
    try {
      const response = await fetch('/api/raporlama/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Sunucu hatası');
      }
      if (format === 'xlsx') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invitrolab_tum_veriler_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast({ title: 'Başarılı', description: 'Excel dosyası indirildi.' });
      } else {
        const result = await response.json();
        if (result.success && result.data) {
          exportAllDataToJSON(result.data, 'invitrolab_tum_veriler', toast);
        } else {
          throw new Error(result.error || 'Veri alınamadı');
        }
      }
    } catch (error: any) {
      console.error('Export error:', error);
      toast({ title: 'Hata', description: error.message || 'Veriler dışa aktarılırken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
      setExportFormat(null);
    }
  };

  const goStok = (path: string) => { router.push(path); setIsStokModalOpen(false); };

  const features = [
    { icon: FileText, title: 'Oluşturulan Raporlar', desc: 'Kestirmelerden üretilen PDF/Excel raporları ve teslimat durumlarını görüntüleyin.', onClick: () => router.push('/raporlama/olusturulan-raporlar') },
    { icon: FolderOpen, title: 'Dosya Yönetimi', desc: 'İrsaliye PDF ve Excel dosyalarını yükleyin ve yönetin.', onClick: () => router.push('/dosya-yonetimi') },
    { icon: TrendingUp, title: 'Tüketim İstatistikleri', desc: 'Laboratuvar bazlı ürün tüketim verilerini analiz edin.', onClick: () => router.push('/tuketim-istatistikleri') },
    { icon: Archive, title: 'Kümülatif', desc: "'Cumulative Operation List' PDF/TXT dosyalarından test sayılarını hesaplayın.", onClick: () => router.push('/kumulatif-hesaplama') },
    { icon: Activity, title: 'Cihaz Üstü', desc: "'Reagent Status' PDF/TXT dosyalarından kullanılabilir test sayılarını hesaplayın.", onClick: () => router.push('/cihaz-ustu-hesaplama') },
    { icon: Package, title: 'Stok İşlemleri', desc: 'Transfer, imha, stok risk, hareketsiz stok ve min-max raporları.', onClick: () => setIsStokModalOpen(true) },
    { icon: Barcode, title: 'Seri No Format Tanımla', desc: 'Barkod seri numarası format kurallarını belirleyin.', onClick: () => router.push('/raporlama/seri-no-format') },
  ];

  const stokReports = [
    { icon: ArrowLeftRight, title: 'Transfer Raporu', desc: 'Depolar arası ve kurum bazlı transfer hareketlerini listeleyin.', path: '/raporlama/transfer-raporu' },
    { icon: Trash2, title: 'İmha Edilen Kitler', desc: 'İmha kayıtlarını tarih, neden ve ürün bazında görüntüleyin.', path: '/raporlama/imha-edilen-kitler' },
    { icon: CalendarClock, title: 'Hareketsiz Stok Raporu', desc: 'Belirli süre işlem görmemiş stokları analiz edin.', path: '/raporlama/hareketsiz-stok-raporu' },
    { icon: DatabaseZap, title: 'Min-Max Ürün Grafiği', desc: 'Ürün bazında tanımlı sınırlar ve mevcut seviyeleri karşılaştırın.', path: '/raporlama/minmax-urun-grafik' },
    { icon: AlertTriangle, title: 'Stok Risk Raporu', desc: 'Min-max altı, miad yaklaşımı, hareketsiz, kritik depo ve fazla stok otomasyonlarını tanımlayın.', path: '/raporlama/stock-risk-report' },
  ];

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: mobile ? 26 : 32, fontWeight: 800, letterSpacing: '-0.025em', color: C.ink1, lineHeight: 1.1 }}>
            Raporlama ve Veri Yönetimi
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: mobile ? 14 : 15.5, color: C.ink2, fontWeight: 500 }}>
            Stok raporları, veri analizi ve dosya yönetimi işlemlerine buradan ulaşabilirsiniz.
          </p>
        </div>

        {/* Feature grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
          {features.map((f, i) => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} onClick={f.onClick} delay={i * 40} />
          ))}
        </div>

        {/* Export all */}
        <Card style={{ animation: `cyRise 460ms ${EASE} 240ms both` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15, marginBottom: 18 }}>
            <span style={{ width: 50, height: 50, flexShrink: 0, borderRadius: 15, display: 'grid', placeItems: 'center', color: AC.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
              <Download size={24} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18.5, fontWeight: 800, color: C.ink1 }}>Tüm Verileri Dışa Aktar</h2>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: C.ink2, fontWeight: 500, lineHeight: 1.5 }}>
                Sistemdeki tüm ana ve işlem verilerini JSON veya çok sayfalı Excel formatında indirin.
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            <ExportTile
              icon={<FileJson size={22} />} title="JSON Olarak Dışa Aktar" sub="Yapılandırılmış veri formatı"
              onClick={() => handleExport('json')} disabled={isExporting} loading={isExporting && exportFormat === 'json'}
            />
            <ExportTile
              icon={<FileSpreadsheet size={22} />} title="Excel Olarak Dışa Aktar" sub="Çok sayfalı XLSX dosyası" tone="water"
              onClick={() => handleExport('xlsx')} disabled={isExporting} loading={isExporting && exportFormat === 'xlsx'}
            />
          </div>
        </Card>
      </div>

      {/* Stok İşlemleri modal */}
      <Modal open={isStokModalOpen} onClose={() => setIsStokModalOpen(false)} width={680}>
        <ModalHead icon={Package} title="Stok İşlemleri" desc="Stok raporları ve analiz araçlarından birini seçin." onClose={() => setIsStokModalOpen(false)} />
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 11, overflowY: 'auto' }}>
          {stokReports.map((r) => (
            <ModalActionRow key={r.path} icon={r.icon} title={r.title} desc={r.desc} onClick={() => goStok(r.path)} />
          ))}
        </div>
      </Modal>
    </ClayPage>
  );
}
