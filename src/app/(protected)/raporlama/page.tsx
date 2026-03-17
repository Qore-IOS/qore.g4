
'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { exportAllDataToJSON } from '@/lib/utils';
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

// ─── Module Card Component ─────────────────────────────────────────────
interface ModuleCardProps {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  onClick: () => void;
}

function ModuleCard({ icon: Icon, iconColor, iconBg, title, description, onClick }: ModuleCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-4 p-5 rounded-2xl border border-border/60 bg-card/50 hover:bg-card/80 dark:bg-card/30 dark:hover:bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 text-left w-full"
    >
      <div
        className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0 transition-transform duration-200 group-hover:scale-105"
        style={{ backgroundColor: iconBg }}
      >
        <Icon className="w-5 h-5" style={{ color: iconColor }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground/70" />
    </button>
  );
}

// ─── Action Card for Modals ────────────────────────────────────────────
interface ActionCardProps {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}

function ActionCard({ icon: Icon, iconColor, title, description, onClick, primary }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-4 w-full px-4 py-3.5 rounded-xl text-left transition-all duration-150 ${
        primary
          ? 'bg-primary/[0.06] dark:bg-primary/[0.12] border border-primary/20 hover:bg-primary/[0.1] dark:hover:bg-primary/[0.18]'
          : 'bg-muted/30 dark:bg-muted/10 border border-transparent hover:bg-muted/50 dark:hover:bg-muted/20'
      }`}
    >
      <div
        className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
        style={{ backgroundColor: `${iconColor}14` }}
      >
        <Icon className="w-[18px] h-[18px]" style={{ color: iconColor }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground block leading-tight">{title}</span>
        <span className="text-xs text-muted-foreground mt-0.5 block leading-relaxed">{description}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
    </button>
  );
}

// ─── Quick Action Button ───────────────────────────────────────────────
interface QuickActionProps {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  sublabel: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

function QuickAction({ icon: Icon, iconColor, label, sublabel, onClick, disabled, loading }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card/40 dark:bg-card/20 hover:bg-card/70 dark:hover:bg-card/40 transition-all duration-150 text-left disabled:opacity-50 disabled:cursor-not-allowed min-w-0"
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ backgroundColor: `${iconColor}14` }}>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        )}
      </div>
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground block truncate">{label}</span>
        <span className="text-xs text-muted-foreground block truncate">{sublabel}</span>
      </div>
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

  return (
    <>
      <div className="space-y-8 pb-8">
        {/* ─── Header ───────────────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Raporlama ve Veri Yönetimi
              </h1>
              <p className="text-sm text-muted-foreground">
                Stok raporları, veri analizi ve dosya yönetimi işlemlerine buradan ulaşabilirsiniz.
              </p>
            </div>
          </div>
        </div>

        {/* ─── Module Cards Grid ────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Modüller
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ModuleCard
              icon={FolderOpen}
              iconColor="#3b82f6"
              iconBg="#3b82f614"
              title="Dosya Yönetimi"
              description="İrsaliye PDF ve Excel dosyalarını yükleyin ve yönetin."
              onClick={() => router.push('/dosya-yonetimi')}
            />
            <ModuleCard
              icon={TrendingUp}
              iconColor="#06b6d4"
              iconBg="#06b6d414"
              title="Tüketim İstatistikleri"
              description="Laboratuvar bazlı ürün tüketim verilerini analiz edin."
              onClick={() => router.push('/tuketim-istatistikleri')}
            />
            <ModuleCard
              icon={Archive}
              iconColor="#8b5cf6"
              iconBg="#8b5cf614"
              title="Kümülatif"
              description="Kümülatif test hesaplama, analiz ve geçmiş kayıtları."
              onClick={() => setIsCumulativeModalOpen(true)}
            />
            <ModuleCard
              icon={Activity}
              iconColor="#10b981"
              iconBg="#10b98114"
              title="Cihaz Üstü"
              description="Cihaz üzerindeki stok ve test bilgilerini kaydedin."
              onClick={() => setIsCihazUstuModalOpen(true)}
            />
            <ModuleCard
              icon={Package}
              iconColor="#f59e0b"
              iconBg="#f59e0b14"
              title="Stok İşlemleri"
              description="Transfer, imha, hareketsiz stok ve min-max raporları."
              onClick={() => setIsStokIslemleriModalOpen(true)}
            />
            <ModuleCard
              icon={Barcode}
              iconColor="#64748b"
              iconBg="#64748b14"
              title="Seri No Format Tanımla"
              description="Barkod seri numarası format kurallarını belirleyin."
              onClick={() => router.push('/raporlama/seri-no-format')}
            />
          </div>
        </div>

        {/* ─── Quick Actions: Export ────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Hızlı İşlemler
          </h2>
          <div className="rounded-2xl border border-border/60 bg-card/40 dark:bg-card/20 backdrop-blur-sm p-5">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 shrink-0">
                <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Tüm Verileri Dışa Aktar</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Sistemdeki tüm ana ve işlem verilerini JSON veya çok sayfalı Excel formatında indirin.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <QuickAction
                icon={FileJson}
                iconColor="#f59e0b"
                label="JSON Olarak Dışa Aktar"
                sublabel="Yapılandırılmış veri formatı"
                onClick={() => handleExport('json')}
                disabled={isExporting}
                loading={isExporting && exportFormat === 'json'}
              />
              <QuickAction
                icon={FileSpreadsheet}
                iconColor="#22c55e"
                label="Excel Olarak Dışa Aktar"
                sublabel="Çok sayfalı XLSX dosyası"
                onClick={() => handleExport('xlsx')}
                disabled={isExporting}
                loading={isExporting && exportFormat === 'xlsx'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Kümülatif Modal ─────────────────────────────────── */}
      <Dialog open={isCumulativeModalOpen} onOpenChange={setIsCumulativeModalOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-violet-500/10">
                <Archive className="w-[18px] h-[18px] text-violet-600 dark:text-violet-400" />
              </div>
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
              iconColor="#8b5cf6"
              title="Kümülatif Hesaplama"
              description="Laboratuvar bazlı kümülatif test sonuçlarını hesaplayın."
              onClick={() => handleCumulativeNavigation('/kumulatif-hesaplama')}
              primary
            />
            <ActionCard
              icon={BarChart3}
              iconColor="#6366f1"
              title="Kümülatif Analiz"
              description="Kümülatif verileri detaylı olarak analiz edin ve karşılaştırın."
              onClick={() => handleCumulativeNavigation('/raporlama/kumulatif-analiz')}
            />
            <ActionCard
              icon={HistoryIcon}
              iconColor="#64748b"
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
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/10">
                <Activity className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />
              </div>
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
              iconColor="#10b981"
              title="Yeni Cihaz Üstü Kaydı"
              description="Cihaz üzerindeki mevcut stok ve test bilgisini ekleyin."
              onClick={() => navigateTo('/raporlama/cihaz-ustu-ekle')}
              primary
            />
            <ActionCard
              icon={HistoryIcon}
              iconColor="#64748b"
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
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10">
                <Package className="w-[18px] h-[18px] text-amber-600 dark:text-amber-400" />
              </div>
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
              iconColor="#3b82f6"
              title="Transfer Raporu"
              description="Depolar arası ve kurum bazlı transfer hareketlerini listeleyin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/transfer-raporu')}
              primary
            />
            <ActionCard
              icon={Trash2}
              iconColor="#ef4444"
              title="İmha Edilen Kitler"
              description="İmha kayıtlarını tarih, neden ve ürün bazında görüntüleyin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/imha-edilen-kitler')}
            />
            <ActionCard
              icon={CalendarClock}
              iconColor="#f59e0b"
              title="Hareketsiz Stok Raporu"
              description="Belirli süre işlem görmemiş stokları analiz edin."
              onClick={() => handleStokIslemleriNavigation('/raporlama/hareketsiz-stok-raporu')}
            />
            <ActionCard
              icon={DatabaseZap}
              iconColor="#8b5cf6"
              title="Min-Max Ürün Grafiği"
              description="Ürün bazında tanımlı sınırlar ve mevcut seviyeleri karşılaştırın."
              onClick={() => handleStokIslemleriNavigation('/raporlama/minmax-urun-grafik')}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
