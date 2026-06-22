'use client';

import { AlertTriangle, Bell, Boxes, CalendarClock, ExternalLink, FileSpreadsheet, Filter, Mail, MessageCircle, PackageSearch, Warehouse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  STOCK_RISK_REPORT_AUTOMATIONS,
  STOCK_RISK_REPORT_PARAMETERS,
  buildStockRiskDeepLink,
} from '@/lib/stock-risk-report';

const automationIcons = {
  'low-stock': AlertTriangle,
  'expiry-watch': CalendarClock,
  'inactive-stock': PackageSearch,
  'critical-location-summary': Warehouse,
  overstock: Boxes,
} as const;

const parameterIcons = [Filter, PackageSearch, CalendarClock, FileSpreadsheet, Bell] as const;

const channelBadges = [
  { label: 'E-posta', icon: Mail },
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Uygulama bildirimi', icon: Bell },
];

export default function StockRiskReportPanel() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border border-border/70 bg-gradient-to-br from-background via-background to-amber-500/10">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                stock-risk-report
              </Badge>
              <div>
                <CardTitle>Stok Risk Raporu Otomasyonları</CardTitle>
                <CardDescription className="mt-2 max-w-3xl">
                  Min-max, miad, hareketsizlik, lokasyon kritiklik ve fazla stok senaryoları tek otomasyon setinde tanımlandı. Her sonuç, stok yönetimi panelini ilgili filtrelerle açan deep-link üretir.
                </CardDescription>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
              {channelBadges.map(({ label, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-border/60 bg-background/70 p-3 text-sm shadow-sm">
                  <Icon className="mb-2 h-4 w-4 text-primary" />
                  <span className="font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {STOCK_RISK_REPORT_PARAMETERS.map((parameter, index) => {
          const Icon = parameterIcons[index] ?? Filter;
          return (
            <Card key={parameter} className="border border-border/60">
              <CardContent className="pt-5">
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">{parameter}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {STOCK_RISK_REPORT_AUTOMATIONS.map((automation) => {
          const Icon = automationIcons[automation.id];
          const demoLink = buildStockRiskDeepLink(automation, {
            depotOrLab: 'secili-depo-lab',
            productGroup: 'secili-urun-grubu',
            brand: 'secili-marka',
            thresholdDays: automation.defaultThresholdDays,
            outputFormat: 'table',
            deliveryChannel: 'app-notification',
          });

          return (
            <Card key={automation.id} className="border border-border/60">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base sm:text-lg">{automation.title}</CardTitle>
                    <CardDescription className="mt-1">{automation.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 rounded-2xl bg-muted/40 p-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Tetikleyici: </span>
                    <code className="rounded bg-background px-1.5 py-0.5 text-xs">{automation.trigger}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Risk sinyali: </span>
                    <span className="font-medium">{automation.riskSignal}</span>
                  </div>
                  {automation.thresholdDayOptions && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Gün eşikleri:</span>
                      {automation.thresholdDayOptions.map((day) => (
                        <Badge key={day} variant="secondary">{day} gün</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ExternalLink className="h-4 w-4" />
                    Sonuç deep-link tasarımı
                  </div>
                  <code className="block break-all rounded-2xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">{demoLink}</code>
                  <Button asChild size="sm" variant="outline" className="w-fit">
                    <a href={demoLink}>Filtreli stok yönetimini aç</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
