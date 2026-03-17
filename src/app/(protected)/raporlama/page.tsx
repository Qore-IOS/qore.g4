
'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { exportAllDataToJSON } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  FileSpreadsheet,
  FileJson,
  Loader2,
  CalendarClock,
  Calculator,
  History as HistoryIcon,
  Activity,
  Archive,
  Barcode,
  Trash2,
  Package,
  ArrowLeftRight,
  FolderOpen,
  TrendingUp,
  ChevronRight,
  Download,
  PlusCircle,
  BarChart3,
  DatabaseZap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Action Card for Modals ────────────────────────────────────────────
interface ActionCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}

function ActionCard({ icon: Icon, title, description, onClick, primary }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'dashboard-kpi-mini group flex items-center gap-4 w-full px-4 py-3.5 rounded-2xl text-left transition-all duration-150',
        primary && 'border-orange-400/25'
      )}
    >
      <span className="dashboard-panel-icon flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition group-hover:text-orange-500">
        <Icon className="w-[18px] h-[18px] text-[var(--dashboard-muted)] group-hover:text-orange-500 transition-colors" />
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold block leading-tight" style={{ color: 'var(--dashboard-text)' }}>{title}</span>
        <span className="text-xs mt-0.5 block leading-relaxed" style={{ color: 'var(--dashboard-muted)' }}>{description}</span>
      </div>
      <ChevronRight className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" style={{ color: 'var(--dashboard-muted)', opacity: 0.4 }} />
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────
export default function RaporlamaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'xlsx' | null>(null);
  const [isCumulativeModalOpen, setIsCumulativeModalOpen] = useState(false);
  const [isCihazUstuModalOpen, setIsCihazUstuModalOpen] = useState(false);
  const [isStokIslemleriModalOpen, setIsStokIslemleriModalOpen] = useState(false);

  const handleExport = async (format: 'json' | 'xlsx') => {
    setIsExporting(true);
    setExportFormat(format);
    toast({
      title: "Dışa Aktarma Başlatıldı",
      description: "Sunucu üzerinden veriler toplanıyor. Bu işlem biraz zaman alabilir..."
    });

    try {
      const response = await fetch('/api/raporlama/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
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
      toast({
        title: 'Hata',
        description: error.message || 'Veriler dışa aktarılırken bir sorun oluştu.',
        variant: 'destructive'
      });
    } finally {
      setIsExporting(false);
      setExportFormat(null);
    }
  };

  const handleCumulativeNavigation = (path: string) => {
    router.push(path);
    setIsCumulativeModalOpen(false);
  };

  const navigateTo = (path: string) => {
    router.push(path);
    setIsCihazUstuModalOpen(false);
  };

  const handleStokIslemleriNavigation = (path: string) => {
    router.push(path);
    setIsStokIslemleriModalOpen(false);
  };

  const modules = [
    { icon: FolderOpen, title: 'Dosya Yönetimi', desc: 'İrsaliye PDF ve Excel dosyalarını yükleyin ve yönetin.', onClick: () => router.push('/dosya-yonetimi') },
    { icon: TrendingUp, title: 'Tüketim İstatistikleri', desc: 'Laboratuvar bazlı ürün tüketim verilerini analiz edin.', onClick: () => router.push('/tuketim-istatistikleri') },
    { icon: Archive, title: 'Kümülatif', desc: 'Kümülatif test hesaplama, analiz ve geçmiş kayıtları.', onClick: () => setIsCumulativeModalOpen(true) },
    { icon: Activity, title: 'Cihaz Üstü', desc: 'Cihaz üzerindeki stok ve test bilgilerini kaydedin.', onClick: () => setIsCihazUstuModalOpen(true) },
    { icon: Package, title: 'Stok İşlemleri', desc: 'Transfer, imha, hareketsiz stok ve min-max raporları.', onClick: () => setIsStokIslemleriModalOpen(true) },
    { icon: Barcode, title: 'Seri No Format Tanımla', desc: 'Barkod seri numarası format kurallarını belirleyin.', onClick: () => router.push('/raporlama/seri-no-format') },
  ];

  return (
    <div className="dashboard-neu-page min-h-screen p-4 md:p-6 lg:p-8">
      {/* ─── Header ───────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--dashboard-text)' }}>
          Raporlama ve Veri Yönetimi
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--dashboard-muted)' }}>
          Stok raporları, veri analizi ve dosya yönetimi işlemlerine buradan ulaşabilirsiniz.
        </p>
      </div>

      {/* ─── Module Cards Grid ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <button
              key={mod.title}
              onClick={mod.onClick}
              className="dashboard-panel-tile group relative flex items-start gap-4 rounded-2xl p-5 text-left transition"
            >
              <span className="dashboard-panel-icon flex h-11 w-11 items-center justify-center rounded-full shrink-0 transition group-hover:text-orange-500">
                <Icon className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold leading-tight" style={{ color: 'var(--dashboard-text)' }}>{mod.title}</h3>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--dashboard-muted)' }}>{mod.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 transition-transform duration-200 group-hover:translate-x-0.5" style={{ color: 'var(--dashboard-muted)', opacity: 0.3 }} />
            </button>
          );
        })}
      </div>

      {/* ─── Quick Actions: Export ────────────────────────── */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-start gap-4 mb-4">
            <span className="dashboard-panel-icon flex items-center justify-center h-10 w-10 rounded-full shrink-0">
              <Download className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--dashboard-text)' }}>Tüm Verileri Dışa Aktar</h3>
              <p className="text-sm mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>
                Sistemdeki tüm ana ve işlem verilerini JSON veya çok sayfalı Excel formatında indirin.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleExport('json')}
              disabled={isExporting}
              className="dashboard-panel-tile flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="dashboard-panel-icon flex items-center justify-center w-8 h-8 rounded-full shrink-0">
                {isExporting && exportFormat === 'json' ? (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--dashboard-muted)' }} />
                ) : (
                  <FileJson className="w-4 h-4" />
                )}
              </span>
              <div className="min-w-0">
                <span className="text-sm font-medium block" style={{ color: 'var(--dashboard-text)' }}>JSON Olarak Dışa Aktar</span>
                <span className="text-xs block" style={{ color: 'var(--dashboard-muted)' }}>Yapılandırılmış veri formatı</span>
              </div>
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              disabled={isExporting}
              className="dashboard-panel-tile flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="dashboard-panel-icon flex items-center justify-center w-8 h-8 rounded-full shrink-0">
                {isExporting && exportFormat === 'xlsx' ? (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--dashboard-muted)' }} />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
              </span>
              <div className="min-w-0">
                <span className="text-sm font-medium block" style={{ color: 'var(--dashboard-text)' }}>Excel Olarak Dışa Aktar</span>
                <span className="text-xs block" style={{ color: 'var(--dashboard-muted)' }}>Çok sayfalı XLSX dosyası</span>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Kümülatif Modal ─────────────────────────────────── */}
      <Dialog open={isCumulativeModalOpen} onOpenChange={setIsCumulativeModalOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <span className="dashboard-panel-icon flex items-center justify-center w-9 h-9 rounded-full">
                <Archive className="w-[18px] h-[18px]" />
              </span>
              <div>
                <DialogTitle className="text-lg font-semibold">Kümülatif Paneli</DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  Kümülatif analiz ve raporlama araçlarından birini seçin.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <ActionCard
              icon={Calculator}
              title="Kümülatif Hesaplama"
              description="Laboratuvar bazlı kümülatif test sonuçlarını hesaplayın."
              onClick={() => handleCumulativeNavigation('/kumulatif-hesaplama')}
              primary
            />
            <ActionCard
              icon={BarChart3}
              title="Kümülatif Analiz"
              description="Kümülatif verileri detaylı olarak analiz edin ve karşılaştırın."
              onClick={() => handleCumulativeNavigation('/raporlama/kumulatif-analiz')}
            />
            <ActionCard
              icon={HistoryIcon}
              title="Kümülatif Geçmişi"
              description="Önceki kümülatif raporları görüntüleyin ve arşivleyin."
              onClick={() => handleCumulativeNavigation('/kumulatif-gecmis')}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Cihaz Üstü Modal ────────────────────────────────── */}
      <Dialog open={isCihazUstuModalOpen} onOpenChange={setIsCihazUstuModalOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <span className="dashboard-panel-icon flex items-center justify-center w-9 h-9 rounded-full">
                <Activity className="w-[18px] h-[18px]" />
              </span>
              <div>
                <DialogTitle className="text-lg font-semibold">Cihaz Üstü</DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  Cihaz üzerindeki stok işlemlerini yönetin.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <ActionCard
              icon={PlusCircle}
              title="Yeni Cihaz Üstü Kaydı"
              description="Cihaz üzerindeki mevcut stok ve test bilgisini ekleyin."
              onClick={() => navigateTo('/raporlama/cihaz-ustu-ekle')}
              primary
            />
            <ActionCard
              icon={HistoryIcon}
              title="Geçmiş Kayıtlar"
              description="Önceki cihaz üstü hareketlerini görüntüleyin."
              onClick={() => navigateTo('/raporlama/cihaz-ustu-gecmisi')}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Stok İşlemleri Modal ────────────────────────────── */}
      <Dialog open={isStokIslemleriModalOpen} onOpenChange={setIsStokIslemleriModalOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <span className="dashboard-panel-icon flex items-center justify-center w-9 h-9 rounded-full">
                <Package className="w-[18px] h-[18px]" />
              </span>
              <div>
                <DialogTitle className="text-lg font-semibold">Stok İşlemleri</DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  Stok raporları ve analiz araçlarından birini seçin.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <ActionCard
              icon={ArrowLeftRight}
              title="Transfer Raporu"
              description="Depolar arası ve kurum bazlı transfer hareketlerini listeleyin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/transfer-raporu')}
              primary
            />
            <ActionCard
              icon={Trash2}
              title="İmha Edilen Kitler"
              description="İmha kayıtlarını tarih, neden ve ürün bazında görüntüleyin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/imha-edilen-kitler')}
            />
            <ActionCard
              icon={CalendarClock}
              title="Hareketsiz Stok Raporu"
              description="Belirli süre işlem görmemiş stokları analiz edin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/hareketsiz-stok-raporu')}
            />
            <ActionCard
              icon={DatabaseZap}
              title="Min-Max Ürün Grafiği"
              description="Ürün bazında tanımlı sınırlar ve mevcut seviyeleri karşılaştırın."
              onClick={() => handleStokIslemleriNavigation('/raporlama/minmax-urun-grafik')}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
