
'use client';

import React, { useState, useMemo, useEffect, useCallback, ChangeEvent } from 'react';
import type { DateRange } from 'react-day-picker';
import {
    Users, Microscope, AlertCircle, RefreshCcw, Clock, Building, Upload, Filter, Info, History, Save, Settings, X, ChevronDown, ChevronUp, Trash2, Database, Zap
} from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Dialog,
    DialogContent,
    DialogTrigger,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import MultiSelectFilter from '@/components/lbys/MultiSelectFilter';
import { useLbysDataStore, ViewMode } from '@/store/lbys-data-store';
import { FileUploader } from '@/components/lbys/FileUploader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, LineChart, Line, Area, AreaChart } from 'recharts';
import { AnimatePresence, motion } from 'framer-motion';

// --- TYPES ---
interface FilterOption {
    label: string;
    value: string;
}

function KpiCard({ title, value, icon: Icon, color, bg, onClick, subtitle }: any) {
    const isClickable = !!onClick;
    return (
        <Card className={`border-none shadow-sm transition-shadow ${isClickable && "cursor-pointer hover:shadow-md"}`} onClick={onClick}>
            <CardContent className="p-4 flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-slate-500">{title}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
                    {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
                </div>
                <div className={`p-3 rounded-full ${bg}`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                </div>
            </CardContent>
        </Card>
    );
}

function FilterGroup({ title, options, selected, onChange }: { title: string, options: FilterOption[], selected: string[], onChange: (val: string[]) => void }) {
    const { toast } = useToast();
    const handleSelectionChange = (values: string[]) => {
        onChange(values);
        toast({
            title: 'Filtre Güncellendi',
            description: `${title} filtresi için ${values.length} seçim yapıldı.`
        });
    };

    return (
        <div className="flex flex-col gap-1.5 flex-grow min-w-[180px]">
             <Label className="text-xs font-semibold text-slate-500 uppercase">{title}</Label>
             <MultiSelectFilter
                options={options}
                selectedValues={selected}
                onChange={handleSelectionChange}
                placeholder={`${title} Seç...`}
                title={title}
             />
        </div>
    )
}

function HospitalSettingsModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { hospitalDefinitions, saveHospitalDefinition, loadHospitalDefinitions, migrateToSummaries, useSummaryMode, setUseSummaryMode } = useLbysDataStore();
    const { toast } = useToast();
    const [newCode, setNewCode] = useState("");
    const [newName, setNewName] = useState("");
    const [isMigrating, setIsMigrating] = useState(false);

    useEffect(() => {
        if(open) {
            loadHospitalDefinitions();
        }
    }, [open, loadHospitalDefinitions]);

    const handleSave = () => {
        if (!newCode || !newName) {
            toast({ title: 'Hata', description: "Kod ve İsim boş olamaz", variant: 'destructive'});
            return;
        }
        saveHospitalDefinition(newCode.trim(), newName.trim());
        setNewCode("");
        setNewName("");
        toast({ title: 'Başarılı', description: "Tanım kaydedildi" });
    };

    const handleMigration = async () => {
        setIsMigrating(true);
        try {
            const result = await migrateToSummaries();
            toast({
                title: result.success ? 'Başarılı' : 'Hata',
                description: result.message,
                variant: result.success ? 'default' : 'destructive'
            });
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Hastane Kod Tanımları & Ayarlar</DialogTitle>
                    <DialogDescription>Excel'den gelen HASTANE_ID kodlarının hangi hastane ismine karşılık geldiğini buradan tanımlayın.</DialogDescription>
                </DialogHeader>

                {/* Performance Mode Toggle */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${useSummaryMode ? 'bg-green-100' : 'bg-slate-200'}`}>
                            <Zap className={`w-5 h-5 ${useSummaryMode ? 'text-green-600' : 'text-slate-500'}`} />
                        </div>
                        <div>
                            <p className="font-medium text-sm">Yüksek Performans Modu</p>
                            <p className="text-xs text-slate-500">Summary tablolardan okuma (önerilen)</p>
                        </div>
                    </div>
                    <Switch
                        checked={useSummaryMode}
                        onCheckedChange={setUseSummaryMode}
                    />
                </div>

                {/* Migration Button */}
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-blue-100">
                            <Database className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="font-medium text-sm">Veri Migration</p>
                            <p className="text-xs text-slate-500">Mevcut verilerden summary oluştur</p>
                        </div>
                    </div>
                    <Button
                        onClick={handleMigration}
                        disabled={isMigrating}
                        variant="outline"
                        size="sm"
                    >
                        {isMigrating ? 'İşleniyor...' : 'Migration Başlat'}
                    </Button>
                </div>

                <div className="grid grid-cols-3 gap-2 items-end mb-4">
                    <div className="space-y-1">
                        <Label>Hastane Kodu</Label>
                        <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Örn: 505" />
                    </div>
                    <div className="space-y-1 col-span-2 flex gap-2">
                        <div className="flex-1 space-y-1">
                             <Label>Hastane Adı</Label>
                             <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Örn: Göztepe Hastanesi" />
                        </div>
                        <Button onClick={handleSave}>Ekle</Button>
                    </div>
                </div>

                <div className="border rounded-md">
                    <ScrollArea className="h-64">
                    <Table>
                        <TableHeader>
                            <TableRow><TableHead>Kod</TableHead><TableHead>Hastane Adı</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                            {Object.entries(hospitalDefinitions).map(([code, name]) => (
                                <TableRow key={code}>
                                    <TableCell className="font-mono font-medium">{code}</TableCell>
                                    <TableCell>{name}</TableCell>
                                </TableRow>
                            ))}
                            {Object.keys(hospitalDefinitions).length === 0 && (
                                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-4">Henüz tanım yapılmamış</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// --- MAIN PAGE COMPONENT ---
export default function IsAnaliziPage() {
    const {
        isLoading, error, aggregatedData, filteredData, filters,
        setFilters, loadHospitalDefinitions, resetFilters, loadDataFromFirestore, resetAnalysisData,
        showAllData, loadAllDataFromFirestore, processingProgress, viewMode, setViewMode,
        // Yeni summary-based state
        useSummaryMode, dashboardData, filterOptions: storeFilterOptions, loadFilterOptionsFromFirestore
    } = useLbysDataStore();
    const { toast } = useToast();

    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [detailModalData, setDetailModalData] = useState<{ title: string; data: Record<string, number>, type: 'service' | 'test' } | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectionData, setRejectionData] = useState<{ title: string; reasons: Record<string, number> } | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [topPanelOpen, setTopPanelOpen] = useState(false);

    useEffect(() => {
        loadHospitalDefinitions();
        loadFilterOptionsFromFirestore();
        // Load initial data based on default date range
        if (filters.dateRange.from && filters.dateRange.to) {
            loadDataFromFirestore({ from: filters.dateRange.from, to: filters.dateRange.to });
        }
    }, [loadHospitalDefinitions, loadFilterOptionsFromFirestore, loadDataFromFirestore]);

    // This effect triggers a re-fetch whenever the date range filter changes.
    useEffect(() => {
        // showAll true ise loadAllDataFromFirestore zaten çağrılmış olacak
        if (!filters.showAll && filters.dateRange.from && filters.dateRange.to) {
            loadDataFromFirestore({ from: filters.dateRange.from, to: filters.dateRange.to });
        }
    }, [filters.dateRange, filters.showAll, loadDataFromFirestore]);

    const handleDateChange = (dateRange: DateRange | undefined) => {
        // Tarih seçildiğinde showAll'ı kapat
        if (dateRange) {
            setFilters({
                dateRange: { from: dateRange.from, to: dateRange.to ?? undefined },
                showAll: false
            });
        }
        // The useEffect above will handle the refetch
    };

    // Filter options: Summary modunda store'dan, legacy modunda aggregatedData'dan
    const filterOptions = useMemo(() => {
        if (useSummaryMode && storeFilterOptions.hospitals.length > 0) {
            return {
                hospitals: storeFilterOptions.hospitals.map(v => ({ label: v, value: v })),
                services: storeFilterOptions.services.map(v => ({ label: v, value: v })),
                tests: storeFilterOptions.tests.map(v => ({ label: v, value: v })),
                asms: storeFilterOptions.asms.map(v => ({ label: v, value: v })),
                branches: storeFilterOptions.branches.map(v => ({ label: v, value: v })),
            };
        }

        // Legacy mode: aggregatedData'dan türet
        const hospitals = new Set<string>();
        const services = new Set<string>();
        const tests = new Set<string>();
        const asms = new Set<string>();
        const branches = new Set<string>();

        aggregatedData.forEach(item => {
            if (item.isAsm) asms.add(item.hospitalName);
            else hospitals.add(item.hospitalName);
            services.add(item.service);
            tests.add(item.testName);
            branches.add(item.branch);
        });

        return {
            hospitals: Array.from(hospitals).sort().map(v => ({ label: v, value: v })),
            services: Array.from(services).sort().map(v => ({ label: v, value: v })),
            tests: Array.from(tests).sort().map(v => ({ label: v, value: v })),
            asms: Array.from(asms).sort().map(v => ({ label: v, value: v })),
            branches: Array.from(branches).sort().map(v => ({ label: v, value: v })),
        };
    }, [useSummaryMode, storeFilterOptions, aggregatedData]);

    // KPI Data: Summary modunda dashboardData'dan, legacy modunda filteredData'dan
    const kpiData = useMemo(() => {
        if (useSummaryMode && dashboardData) {
            return {
                totalTests: dashboardData.kpis.totalTests,
                totalSamples: dashboardData.kpis.uniquePatients,
                rejectionRate: dashboardData.kpis.rejectionRate,
                avgTat: Math.round(dashboardData.kpis.avgTatMinutes),
                repeatRate: dashboardData.kpis.repeatRate,
                emergencyRate: dashboardData.kpis.emergencyRate,
                rejectionReasons: dashboardData.rejectionReasons.reduce((acc, item) => {
                    acc[item.name] = item.value;
                    return acc;
                }, {} as Record<string, number>)
            };
        }

        // Legacy mode
        let totalTests = 0, totalRejected = 0, totalRepeat = 0, totalTat = 0, tatCount = 0, totalEmergency = 0;
        const patientIdSet = new Set<string>();

        filteredData.forEach(d => {
            const stage = d[viewMode];
            if (!stage) return;
            totalTests += stage.totalTests;
            totalRejected += stage.rejectedCount;
            totalRepeat += stage.repeatCount;
            totalTat += stage.totalTatMinutes;
            tatCount += stage.tatCount;
            totalEmergency += stage.emergencyCount;
            stage.patientIds.forEach(pid => patientIdSet.add(pid));
        });

        return {
            totalTests,
            totalSamples: patientIdSet.size,
            rejectionRate: totalTests > 0 ? (totalRejected / totalTests) * 100 : 0,
            avgTat: tatCount > 0 ? Math.round(totalTat / tatCount) : 0,
            repeatRate: totalTests > 0 ? (totalRepeat / totalTests) * 100 : 0,
            emergencyRate: totalTests > 0 ? (totalEmergency / totalTests) * 100 : 0,
            rejectionReasons: filteredData.reduce((acc, curr) => {
                const stage = curr[viewMode];
                if (!stage) return acc;
                Object.entries(stage.rejectionReasons).forEach(([reason, count]) => {
                    acc[reason] = (acc[reason] || 0) + count;
                });
                return acc;
            }, {} as Record<string, number>)
        };
    }, [useSummaryMode, dashboardData, filteredData, viewMode]);

    // Hospital chart data
    const hospitalsChartData = useMemo(() => {
        if (useSummaryMode && dashboardData) {
            return dashboardData.hospitalDistribution.map(d => ({
                name: d.name,
                tests: d.value,
                emergency: d.emergencyCount || 0,
                normal: d.normalCount || (d.value - (d.emergencyCount || 0)),
                emergencyRate: d.value > 0 ? ((d.emergencyCount || 0) / d.value) * 100 : 0
            }));
        }

        // Legacy mode
        const map = new Map<string, { name: string, tests: number, emergency: number }>();
        filteredData.filter(d => !d.isAsm).forEach(d => {
            const stage = d[viewMode];
            if (!stage) return;
            if (!map.has(d.hospitalName)) map.set(d.hospitalName, { name: d.hospitalName, tests: 0, emergency: 0 });
            const rec = map.get(d.hospitalName)!;
            rec.tests += stage.totalTests;
            rec.emergency += stage.emergencyCount;
        });
        return Array.from(map.values())
            .map(d => ({
                ...d,
                normal: d.tests - d.emergency,
                emergencyRate: d.tests > 0 ? ((d.emergency / d.tests) * 100) : 0
            }))
            .sort((a, b) => b.tests - a.tests);
    }, [useSummaryMode, dashboardData, filteredData, viewMode]);

    // ASM chart data
    const asmData = useMemo(() => {
        if (useSummaryMode && dashboardData) {
            return dashboardData.asmDistribution;
        }

        // Legacy mode
        const map = new Map<string, number>();
        filteredData.filter(d => d.isAsm).forEach(d => {
            const stage = d[viewMode];
            if (!stage) return;
            map.set(d.hospitalName, (map.get(d.hospitalName) || 0) + stage.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [useSummaryMode, dashboardData, filteredData, viewMode]);

    // Services chart data
    const servicesChartData = useMemo(() => {
        if (useSummaryMode && dashboardData) {
            return dashboardData.serviceDistribution;
        }

        // Legacy mode
        const map = new Map<string, number>();
        filteredData.forEach(d => {
            const stage = d[viewMode];
            if (!stage) return;
            map.set(d.service, (map.get(d.service) || 0) + stage.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [useSummaryMode, dashboardData, filteredData, viewMode]);

    // Top tests chart data
    const topTestsData = useMemo(() => {
        if (useSummaryMode && dashboardData) {
            return dashboardData.topTests;
        }

        // Legacy mode
        const map = new Map<string, number>();
        filteredData.forEach(d => {
            const stage = d[viewMode];
            if (!stage) return;
            map.set(d.testName, (map.get(d.testName) || 0) + stage.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [useSummaryMode, dashboardData, filteredData, viewMode]);

    // Daily trend chart data (yeni - sadece summary mode'da)
    const dailyTrendData = useMemo(() => {
        if (useSummaryMode && dashboardData && dashboardData.dailyTrend) {
            return dashboardData.dailyTrend.map(d => ({
                ...d,
                date: d.name.substring(5) // "YYYY-MM-DD" -> "MM-DD"
            }));
        }
        return [];
    }, [useSummaryMode, dashboardData]);

    const handleRejectionClick = () => {
        setRejectionData({ title: "Tüm Red Nedenleri", reasons: kpiData.rejectionReasons });
        setRejectionModalOpen(true);
    };

    const handleHospitalClick = (hospitalName: string) => {
        // Summary modunda detay için raw data'ya ihtiyaç var - şimdilik basit gösterim
        if (useSummaryMode) {
            toast({
                title: "Detay Görünümü",
                description: "Detaylı servis kırılımı için BigQuery entegrasyonu gerekiyor.",
            });
            return;
        }

        const hospitalServices = filteredData
            .filter(d => d.hospitalName === hospitalName)
            .reduce((acc, curr) => {
                const stage = curr[viewMode];
                if (!stage) return acc;
                acc[curr.service] = (acc[curr.service] || 0) + stage.totalTests;
                return acc;
            }, {} as Record<string, number>);
        setDetailModalData({ title: `${hospitalName} - Servis Dağılımı`, data: hospitalServices, type: 'service' });
        setDetailModalOpen(true);
    };

    const handleResetDataConfirm = async () => {
        if (confirm("Bu işlem geri alınamaz! Analiz veritabanındaki tüm kayıtları kalıcı olarak silmek istediğinizden emin misiniz?")) {
            await resetAnalysisData();
            toast({
                title: 'Başarılı',
                description: 'Tüm analiz verileri silindi.',
            });
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-6 bg-slate-50 min-h-screen pb-20">
            {/* Global Loading Overlay */}
            {isLoading && processingProgress.status && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                            <h3 className="font-semibold text-lg">{processingProgress.status}</h3>
                        </div>
                        {processingProgress.total > 0 && (
                            <>
                                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                                    <div
                                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                                        style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                                    ></div>
                                </div>
                                <p className="text-sm text-gray-500 text-center">
                                    {processingProgress.current.toLocaleString()} / {processingProgress.total.toLocaleString()}
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}

             <AnimatePresence>
                {topPanelOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, y: -20 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -20 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                            <div className="flex items-center gap-3">
                                <BackButton />
                                <div>
                                    <h1 className="text-xl font-bold tracking-tight text-gray-800">Qore Analiz</h1>
                                    <p className="text-sm text-slate-500">
                                        Laboratuvar performans ve iş yükü analizi
                                        {useSummaryMode && (
                                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                <Zap className="w-3 h-3 mr-1" /> Yüksek Performans
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <HospitalSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
                                <Button onClick={() => setSettingsOpen(true)} variant="ghost" size="sm" className="gap-2"><Settings className="h-4 w-4" />Ayarlar</Button>
                                <Button onClick={handleResetDataConfirm} variant="destructive" size="sm" className="gap-2"><Trash2 className="h-4 w-4" />Verileri Sıfırla</Button>
                                <FileUploader />
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

             <div className="flex justify-center">
                <Button variant="ghost" onClick={() => setTopPanelOpen(p => !p)} className="text-muted-foreground hover:text-primary transition-colors">
                    {topPanelOpen ? <ChevronUp className="h-4 w-4 mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
                    {topPanelOpen ? 'Paneli Gizle' : 'Paneli Aç'}
                </Button>
            </div>

            {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Hata</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

            {/* Aşama Seçici */}
            <Card className="border-none shadow-sm">
                <CardContent className="p-4">
                    <div className="flex flex-col gap-2">
                        <Label className="text-xs font-semibold text-slate-500 uppercase">Veri Aşaması</Label>
                        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
                            <button
                                onClick={() => setViewMode('labAccepted')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                                    viewMode === 'labAccepted'
                                        ? 'bg-white shadow-sm text-blue-600'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Lab Kabul
                            </button>
                            <button
                                onClick={() => setViewMode('worked')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                                    viewMode === 'worked'
                                        ? 'bg-white shadow-sm text-purple-600'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Çalışılmış
                            </button>
                            <button
                                onClick={() => setViewMode('approved')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                                    viewMode === 'approved'
                                        ? 'bg-white shadow-sm text-green-600'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Onaylanmış
                            </button>
                        </div>
                        <p className="text-xs text-slate-400">
                            {viewMode === 'labAccepted' && 'Y sütunu dolu olan tüm testler (Lab Kabul Tarihi)'}
                            {viewMode === 'worked' && 'Y + AA sütunu dolu olan testler (Çalışma Tarihi)'}
                            {viewMode === 'approved' && 'Y + AA + AC sütunu dolu olan testler (Onay Tarihi)'}
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
                <CardContent className="p-4 flex flex-wrap gap-2 md:gap-4 items-end">
                    <div className="flex flex-col gap-1.5 flex-grow min-w-[200px]">
                        <Label className="text-xs font-semibold text-slate-500 uppercase">Tarih Aralığı</Label>
                        <DatePickerWithRange date={filters.dateRange} setDate={handleDateChange} className="[&_button]:!bg-white [&_button]:!border-gray-200 [&_button]:!shadow-sm" />
                    </div>
                    <FilterGroup title="Hastaneler" options={filterOptions.hospitals} selected={filters.selectedHospitals} onChange={(val) => setFilters({ selectedHospitals: val })} />
                    <FilterGroup title="ASM'ler" options={filterOptions.asms} selected={filters.selectedAsms} onChange={(val) => setFilters({ selectedAsms: val })} />
                    <FilterGroup title="Servisler" options={filterOptions.services} selected={filters.selectedServices} onChange={(val) => setFilters({ selectedServices: val })} />
                    <FilterGroup title="Testler" options={filterOptions.tests} selected={filters.selectedTests} onChange={(val) => setFilters({ selectedTests: val })} />
                    <FilterGroup title="Branşlar" options={filterOptions.branches} selected={filters.selectedBranches} onChange={(val) => setFilters({ selectedBranches: val })} />
                    <div className="flex gap-2 self-end ml-auto">
                        <Button variant="outline" onClick={resetFilters} className="h-9 px-3">
                            <RefreshCcw className="w-4 h-4 mr-2" /> Son 7 Gün
                        </Button>
                        <Button variant="default" onClick={showAllData} className="h-9 px-3 bg-blue-600 hover:bg-blue-700">
                            <Filter className="w-4 h-4 mr-2" /> Tümünü Göster
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <KpiCard title="Toplam Test" value={kpiData.totalTests.toLocaleString()} icon={Microscope} color="text-blue-600" bg="bg-blue-50" />
                <KpiCard title="Benzersiz Numune" value={kpiData.totalSamples.toLocaleString()} icon={Users} color="text-purple-600" bg="bg-purple-50" />
                <KpiCard
                    title="Red Oranı"
                    value={`${kpiData.rejectionRate.toFixed(2)}%`}
                    icon={AlertCircle}
                    color="text-red-600"
                    bg="bg-red-50"
                    onClick={handleRejectionClick}
                />
                <KpiCard title="Ort. TAT (Dk)" value={kpiData.avgTat.toString()} icon={Clock} color="text-amber-600" bg="bg-amber-50" />
                <KpiCard
                    title="Tekrar Oranı"
                    value={`${kpiData.repeatRate.toFixed(2)}%`}
                    icon={RefreshCcw}
                    color="text-cyan-600"
                    bg="bg-cyan-50"
                    subtitle={`Acil: ${kpiData.emergencyRate.toFixed(1)}%`}
                />
            </div>

            {/* Daily Trend Chart - Sadece summary modunda ve veri varsa göster */}
            {useSummaryMode && dailyTrendData.length > 1 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Günlük Test Trendi</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dailyTrendData} margin={{ left: 0, right: 10 }}>
                                <defs>
                                    <linearGradient id="colorTests" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" tick={{fontSize: 10}} />
                                <YAxis tick={{fontSize: 10}} width={50} />
                                <RechartsTooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-white p-2 border rounded shadow text-xs">
                                                    <p className="font-medium">{payload[0].payload.name}</p>
                                                    <p className="text-blue-600">Test: {payload[0].value?.toLocaleString()}</p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#3b82f6"
                                    fillOpacity={1}
                                    fill="url(#colorTests)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center text-base">
                            <span>Test Sayısına Göre Hastaneler</span>
                            <div className="flex gap-2 text-xs font-normal">
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500"></span>Normal</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500"></span>Acil</span>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hospitalsChartData} layout="vertical" margin={{ left: 20, right: 60 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 11}} interval={0} />
                                <RechartsTooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-white dark:bg-slate-800 p-3 border rounded-lg shadow-lg text-xs">
                                                    <p className="font-bold text-sm mb-2">{d.name}</p>
                                                    <div className="space-y-1">
                                                        <p>Toplam Test: <span className="font-semibold">{d.tests.toLocaleString()}</span></p>
                                                        <p className="text-red-600">Acil: <span className="font-semibold">{d.emergency.toLocaleString()}</span> ({d.emergencyRate.toFixed(1)}%)</p>
                                                        <p className="text-blue-600">Normal: <span className="font-semibold">{(d.tests - d.emergency).toLocaleString()}</span></p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="normal" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} onClick={(d) => handleHospitalClick(d.name)} cursor="pointer" name="Normal" />
                                <Bar dataKey="emergency" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} onClick={(d) => handleHospitalClick(d.name)} cursor="pointer" name="Acil"
                                    label={(props: any) => {
                                        const { x, y, width, height, payload } = props;
                                        if (payload?.emergencyRate > 0) {
                                            return (
                                                <text x={x + width + 5} y={y + height / 2} fill="#ef4444" fontSize={10} dominantBaseline="middle">
                                                    {payload.emergencyRate.toFixed(0)}%
                                                </text>
                                            );
                                        }
                                        return <text />;
                                    }}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle className="text-base">Test Sayısına Göre Servisler (İlk 10)</CardTitle></CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={servicesChartData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 11}} interval={0} />
                                <RechartsTooltip />
                                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle className="text-base">En Çok Çalışılan Testler</CardTitle></CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topTestsData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 11}} interval={0} />
                                <RechartsTooltip />
                                <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle className="text-base">Aile Sağlığı Merkezleri (ASM)</CardTitle></CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={asmData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 11}} interval={0} />
                                <RechartsTooltip />
                                <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
                <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{detailModalData?.title}</DialogTitle></DialogHeader><ScrollArea className="h-[400px]"><Table><TableHeader><TableRow><TableHead>İsim</TableHead><TableHead className="text-right">Sayı</TableHead></TableRow></TableHeader><TableBody>{detailModalData && Object.entries(detailModalData.data).sort((a,b) => b[1] - a[1]).map(([name, val], i) => (<TableRow key={i}><TableCell>{name}</TableCell><TableCell className="text-right font-bold">{val.toLocaleString()}</TableCell></TableRow>))}</TableBody></Table></ScrollArea></DialogContent>
            </Dialog>
            <Dialog open={rejectionModalOpen} onOpenChange={setRejectionModalOpen}>
                 <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{rejectionData?.title}</DialogTitle></DialogHeader><ScrollArea className="h-[400px]"><Table><TableHeader><TableRow><TableHead>Red Nedeni</TableHead><TableHead className="text-right">Sayı</TableHead></TableRow></TableHeader><TableBody>{rejectionData && Object.entries(rejectionData.reasons).sort((a,b) => b[1] - a[1]).map(([reason, count]) => (<TableRow key={reason}><TableCell>{reason}</TableCell><TableCell className="text-right font-bold">{count}</TableCell></TableRow>))}</TableBody></Table></ScrollArea></DialogContent>
            </Dialog>
        </div>
    );


}
