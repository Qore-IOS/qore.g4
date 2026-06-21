'use client';

import React, { useMemo, useState } from 'react';
import { Bell, CalendarClock, Check, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Mail, MessageCircle, Save, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getShortcutCatalogForViews, type ShortcutAction, type ShortcutPanelCatalogItem } from '@/lib/shortcuts/catalog';

interface ShortcutBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessibleViews: readonly string[];
  onSave?: (payload: { panelKey?: string; panelLabel?: string; actionKey?: string; actionLabel?: string; actionDescription?: string; actionHref?: string; runMode: 'manual' | 'scheduled' | 'manual_and_scheduled'; scheduleLabel: string; schedule?: { type: 'once' | 'interval'; intervalDays?: number } | string | null; outputs: string[]; filters: string[] }) => Promise<void> | void;
}

const FILTER_OPTIONS = [
  'Laboratuvar',
  'Depo',
  'Marka',
  'Ürün grubu',
  'Ürün kodu / marka',
  'Tarih aralığı',
  'Eşik değeri',
  'Alıcılar',
];

const OUTPUT_OPTIONS = [
  { key: 'app', label: 'Uygulama bildirimi', icon: Bell },
  { key: 'email', label: 'E-posta', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'pdf', label: 'PDF', icon: FileText },
  { key: 'excel', label: 'Excel', icon: FileSpreadsheet },
];

const SCHEDULE_OPTIONS = ['Manuel', 'Tek seferlik', 'Günlük', 'Haftalık', 'Aylık', 'Özel cron'];

const STEP_LABELS = [
  'Panel seçimi',
  'Fonksiyon / rapor',
  'Filtreler',
  'Çıktı',
  'Zamanlama',
  'Özet',
];

const actionKindLabel: Record<ShortcutAction['kind'], string> = {
  navigation: 'Fonksiyon',
  report: 'Rapor',
  mutation: 'İşlem',
  notification: 'Bildirim',
};

export function ShortcutBuilderModal({ open, onOpenChange, accessibleViews, onSave }: ShortcutBuilderModalProps) {
  const panels = useMemo(() => getShortcutCatalogForViews(accessibleViews), [accessibleViews]);
  const [step, setStep] = useState(0);
  const [selectedPanelKey, setSelectedPanelKey] = useState<string>();
  const [selectedActionKey, setSelectedActionKey] = useState<string>();
  const [selectedFilters, setSelectedFilters] = useState<string[]>(['Tarih aralığı']);
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>(['app']);
  const [schedule, setSchedule] = useState('Manuel');
  const [cron, setCron] = useState('0 9 * * 1');

  const selectedPanel = panels.find((panel) => String(panel.panelKey) === selectedPanelKey) ?? panels[0];
  const actions = selectedPanel?.actions ?? [];
  const selectedAction = actions.find((action) => action.key === selectedActionKey) ?? actions[0];

  const resetAndClose = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setStep(0);
    }
  };

  const toggleValue = (value: string, values: string[], setter: (values: string[]) => void) => {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const choosePanel = (panel: ShortcutPanelCatalogItem) => {
    setSelectedPanelKey(String(panel.panelKey));
    setSelectedActionKey(panel.actions[0]?.key);
  };

  const runMode = schedule === 'Manuel' ? 'manual' : schedule === 'Tek seferlik' ? 'manual_and_scheduled' : 'manual_and_scheduled';
  const schedulePayload = schedule === 'Manuel' ? null : schedule === 'Günlük' ? { type: 'interval' as const, intervalDays: 1 } : schedule === 'Haftalık' ? { type: 'interval' as const, intervalDays: 7 } : schedule === 'Aylık' ? { type: 'interval' as const, intervalDays: 30 } : schedule === 'Tek seferlik' ? { type: 'once' as const } : cron;

  const saveShortcut = async () => {
    await onSave?.({
      panelKey: selectedPanel ? String(selectedPanel.panelKey) : undefined,
      panelLabel: selectedPanel?.panelLabel,
      actionKey: selectedAction?.handlerKey || selectedAction?.key,
      actionLabel: selectedAction?.label,
      actionDescription: selectedAction?.description,
      actionHref: selectedAction?.href,
      runMode,
      scheduleLabel: schedule === 'Özel cron' ? `${schedule} · ${cron}` : schedule,
      schedule: schedulePayload,
      outputs: selectedOutputs,
      filters: selectedFilters,
    });
    resetAndClose(false);
  };

  const outputLabels = selectedOutputs
    .map((key) => OUTPUT_OPTIONS.find((output) => output.key === key)?.label)
    .filter(Boolean)
    .join(', ');

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-4xl rounded-3xl border border-white/15 bg-white/95 p-0 dark:bg-zinc-950/95">
        <div className="overflow-hidden rounded-3xl">
          <DialogHeader className="border-b border-black/10 bg-gradient-to-r from-orange-500/15 via-violet-500/10 to-transparent px-6 py-5 dark:border-white/10">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Kestirme oluştur
            </DialogTitle>
            <DialogDescription>
              Yetkili panellerden fonksiyon veya rapor seçerek filtre, çıktı ve zamanlama bilgilerini tanımlayın.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-0 md:grid-cols-[220px_1fr]">
            <aside className="border-b border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03] md:border-b-0 md:border-r">
              <ol className="space-y-2">
                {STEP_LABELS.map((label, index) => (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => setStep(index)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition',
                        index === step ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                      )}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 text-xs">{index + 1}</span>
                      {label}
                    </button>
                  </li>
                ))}
              </ol>
            </aside>

            <div className="min-h-[430px] p-5">
              {step === 0 && (
                <SelectionGrid title="Panel seçimi: yetkili paneller">
                  {panels.map((panel) => (
                    <ChoiceCard key={String(panel.panelKey)} active={String(panel.panelKey) === String(selectedPanel?.panelKey)} onClick={() => choosePanel(panel)} title={panel.panelLabel} subtitle={`${panel.actions.length} fonksiyon / rapor`} />
                  ))}
                </SelectionGrid>
              )}

              {step === 1 && (
                <SelectionGrid title="Fonksiyon / rapor seçimi">
                  {actions.map((action) => (
                    <ChoiceCard key={action.key} active={action.key === selectedAction?.key} onClick={() => setSelectedActionKey(action.key)} title={action.label} subtitle={`${actionKindLabel[action.kind]} · ${action.description}`} />
                  ))}
                </SelectionGrid>
              )}

              {step === 2 && (
                <SelectionGrid title="Filtre seçimi: lab, depo, marka, ürün grubu, tarih aralığı vb.">
                  {FILTER_OPTIONS.map((filter) => (
                    <ChoiceCard key={filter} active={selectedFilters.includes(filter)} onClick={() => toggleValue(filter, selectedFilters, setSelectedFilters)} title={filter} subtitle={selectedFilters.includes(filter) ? 'Kestirmeye eklendi' : 'İsteğe bağlı filtre'} />
                  ))}
                </SelectionGrid>
              )}

              {step === 3 && (
                <SelectionGrid title="Çıktı seçimi">
                  {OUTPUT_OPTIONS.map((output) => (
                    <ChoiceCard key={output.key} active={selectedOutputs.includes(output.key)} onClick={() => toggleValue(output.key, selectedOutputs, setSelectedOutputs)} title={output.label} subtitle="Bildirim veya dosya çıktısı" icon={output.icon} />
                  ))}
                </SelectionGrid>
              )}

              {step === 4 && (
                <SelectionGrid title="Zamanlama">
                  {SCHEDULE_OPTIONS.map((option) => (
                    <ChoiceCard key={option} active={schedule === option} onClick={() => setSchedule(option)} title={option} subtitle={option === 'Özel cron' ? cron : 'Otomasyon takvimi'} icon={CalendarClock} />
                  ))}
                  {schedule === 'Özel cron' && (
                    <label className="col-span-full mt-1 block text-sm font-semibold text-foreground">
                      Cron ifadesi
                      <input value={cron} onChange={(event) => setCron(event.target.value)} className="mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 dark:border-white/10 dark:bg-white/5" />
                    </label>
                  )}
                </SelectionGrid>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold">Özet ve kaydet</h3>
                  <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 text-sm dark:border-white/10 dark:bg-white/[0.04]">
                    <SummaryRow label="Panel" value={selectedPanel?.panelLabel} />
                    <SummaryRow label="Fonksiyon / rapor" value={selectedAction?.label} />
                    <SummaryRow label="Filtreler" value={selectedFilters.join(', ') || 'Filtre yok'} />
                    <SummaryRow label="Çıktı" value={outputLabels || 'Seçilmedi'} />
                    <SummaryRow label="Çalışma modu" value={runMode} />
                    <SummaryRow label="Zamanlama" value={schedule === 'Özel cron' ? `${schedule} · ${cron}` : schedule} />
                  </div>
                  <p className="text-sm text-muted-foreground">Kaydettiğiniz kestirme daha sonra kişisel başlangıç menünüzde ve otomasyon kuyruğunda kullanılmak üzere hazır hale gelir.</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-black/10 px-6 py-4 dark:border-white/10 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Geri
            </Button>
            {step < STEP_LABELS.length - 1 ? (
              <Button type="button" onClick={() => setStep((current) => Math.min(STEP_LABELS.length - 1, current + 1))}>
                İleri <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={saveShortcut}>
                <Save className="mr-1 h-4 w-4" /> Kaydet
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectionGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ChoiceCard({ active, onClick, title, subtitle, icon: Icon }: { active: boolean; onClick: () => void; title: string; subtitle?: string; icon?: React.ElementType }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[92px] items-start gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5',
        active ? 'border-orange-500/60 bg-orange-500/10 shadow-lg shadow-orange-500/10' : 'border-black/10 bg-white/70 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]',
      )}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', active ? 'bg-orange-500 text-white' : 'bg-black/5 text-muted-foreground dark:bg-white/10')}>
        {Icon ? <Icon className="h-4 w-4" /> : active ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </span>
      <span>
        <span className="block text-sm font-bold text-foreground">{title}</span>
        {subtitle && <span className="mt-1 block text-xs leading-snug text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid gap-1 border-b border-black/10 py-2 last:border-b-0 dark:border-white/10 sm:grid-cols-[150px_1fr]">
      <span className="font-bold text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value || 'Seçilmedi'}</span>
    </div>
  );
}

export default ShortcutBuilderModal;
