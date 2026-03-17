
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
  ChevronRight,
  Download,
  PlusCircle,
  BarChart3,
  DatabaseZap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

// ─── Module Nav Button ─────────────────────────────────────────────────
interface ModuleNavProps {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  onClick: () => void;
}

function ModuleNav({ icon: Icon, iconColor, label, onClick }: ModuleNavProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/40 dark:bg-card/20 hover:bg-card/70 dark:hover:bg-card/40 transition-all duration-150 text-sm font-medium text-foreground whitespace-nowrap"
    >
      <Icon className="w-4 h-4" style={{ color: iconColor }} />
      {label}
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
export default function RaporlamaPanel() {
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
      <div className="space-y-6">
        {/* ─── Header with module nav ───────────────────────── */}
        <div className="rounded-2xl border border-border/60 bg-card/40 dark:bg-card/20 backdrop-blur-sm p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Raporlama ve Veri Yönetimi
                </h1>
                <p className="text-sm text-muted-foreground">
                  Harici PDF raporlarını yönetin veya özel stok raporlarına ulaşın.
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <ModuleNav
                icon={Archive}
                iconColor="#8b5cf6"
                label="Kümülatif"
                onClick={() => setIsCumulativeModalOpen(true)}
              />
              <ModuleNav
                icon={Activity}
                iconColor="#10b981"
                label="Cihaz Üstü"
                onClick={() => setIsCihazUstuModalOpen(true)}
              />
              <ModuleNav
                icon={Package}
                iconColor="#f59e0b"
                label="Stok İşlemleri"
                onClick={() => setIsStokIslemleriModalOpen(true)}
              />
              <ModuleNav
                icon={Barcode}
                iconColor="#64748b"
                label="Seri No Format Tanımla"
                onClick={() => router.push('/raporlama/seri-no-format')}
              />
            </div>
          </div>
        </div>

        {/* ─── Export Section ───────────────────────────────── */}
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
