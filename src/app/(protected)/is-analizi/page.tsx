
'use client';

import React, { useState, useMemo, useEffect, useCallback, ChangeEvent } from 'react';
import {
    Users, Microscope, AlertCircle, RefreshCcw, Clock, Building, Upload, Filter, Info, History, Save, Settings, X, ChevronDown, ChevronUp
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
import { useToast } from '@/hooks/use-toast';
import MultiSelectFilter from '@/components/lbys/MultiSelectFilter';
import { useLbysDataStore } from '@/store/lbys-data-store';
import { FileUploader } from '@/components/lbys/FileUploader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { AnimatePresence, motion } from 'framer-motion';

// --- TYPES ---
interface FilterOption {
    label: string;
    value: string;
}

function KpiCard({ title, value, icon: Icon, color, bg, onClick }: any) {
    const isClickable = !!onClick;
    return (
        <Card className={`border-none shadow-sm transition-shadow ${isClickable && "cursor-pointer hover:shadow-md"}`} onClick={onClick}>
            <CardContent className="p-4 flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-slate-500">{title}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
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
    const { hospitalDefinitions, saveHospitalDefinition, loadHospitalDefinitions } = useLbysDataStore();
    const { toast } = useToast();
    const [newCode, setNewCode] = useState("");
    const [newName, setNewName] = useState("");

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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Hastane Kod Tanımları</DialogTitle>
                    <DialogDescription>Excel'den gelen HASTANE_ID kodlarının hangi hastane ismine karşılık geldiğini buradan tanımlayın.</DialogDescription>
                </DialogHeader>
                
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
        setFilters, loadHospitalDefinitions, resetFilters, loadDataFromFirestore
    } = useLbysDataStore();
    
    const [date, setDate] = useState<{ from: Date | undefined; to: Date | undefined }>(filters.dateRange);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [detailModalData, setDetailModalData] = useState<{ title: string; data: Record<string, number>, type: 'service' | 'test' } | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectionData, setRejectionData] = useState<{ title: string; reasons: Record<string, number> } | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [topPanelOpen, setTopPanelOpen] = useState(false);

    useEffect(() => {
        loadHospitalDefinitions();
        loadDataFromFirestore();
    }, [loadHospitalDefinitions, loadDataFromFirestore]);

    useEffect(() => {
        setFilters({ dateRange: { from: date?.from, to: date?.to } });
    }, [date, setFilters]);

    const filterOptions = useMemo(() => {
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
    }, [aggregatedData]);

    const kpiData = useMemo(() => {
        let totalTests = 0, totalRejected = 0, totalRepeat = 0, totalTat = 0, tatCount = 0;
        const patientIdSet = new Set<string>();

        filteredData.forEach(d => {
            totalTests += d.totalTests;
            totalRejected += d.rejectedCount;
            totalRepeat += d.repeatCount;
            totalTat += d.totalTatMinutes;
            tatCount += d.tatCount;
            d.patientIds.forEach(pid => patientIdSet.add(pid));
        });

        return {
            totalTests,
            totalSamples: patientIdSet.size,
            rejectionRate: totalTests > 0 ? (totalRejected / totalTests) * 100 : 0,
            avgTat: tatCount > 0 ? Math.round(totalTat / tatCount) : 0,
            repeatRate: totalTests > 0 ? (totalRepeat / totalTests) * 100 : 0,
            rejectionReasons: filteredData.reduce((acc, curr) => {
                Object.entries(curr.rejectionReasons).forEach(([reason, count]) => {
                    acc[reason] = (acc[reason] || 0) + count;
                });
                return acc;
            }, {} as Record<string, number>)
        };
    }, [filteredData]);

    const hospitalsChartData = useMemo(() => {
        const map = new Map<string, { name: string, tests: number, emergency: number }>();
        filteredData.filter(d => !d.isAsm).forEach(d => {
            if (!map.has(d.hospitalName)) map.set(d.hospitalName, { name: d.hospitalName, tests: 0, emergency: 0 });
            const rec = map.get(d.hospitalName)!;
            rec.tests += d.totalTests;
            rec.emergency += d.emergencyCount;
        });
        return Array.from(map.values())
            .map(d => ({ ...d, emergencyRate: d.tests > 0 ? ((d.emergency / d.tests) * 100) : 0 }))
            .sort((a, b) => b.tests - a.tests);
    }, [filteredData]);
    
    const asmData = useMemo(() => {
        const map = new Map<string, number>();
        filteredData.filter(d => d.isAsm).forEach(d => {
            map.set(d.hospitalName, (map.get(d.hospitalName) || 0) + d.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [filteredData]);
    
    const servicesChartData = useMemo(() => {
        const map = new Map<string, number>();
        filteredData.forEach(d => {
            map.set(d.service, (map.get(d.service) || 0) + d.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [filteredData]);

    const topTestsData = useMemo(() => {
        const map = new Map<string, number>();
        filteredData.forEach(d => {
            map.set(d.testName, (map.get(d.testName) || 0) + d.totalTests);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [filteredData]);

    const handleRejectionClick = () => {
        setRejectionData({ title: "Tüm Red Nedenleri", reasons: kpiData.rejectionReasons });
        setRejectionModalOpen(true);
    };

    const handleHospitalClick = (hospitalName: string) => {
        const hospitalServices = filteredData
            .filter(d => d.hospitalName === hospitalName)
            .reduce((acc, curr) => {
                acc[curr.service] = (acc[curr.service] || 0) + curr.totalTests;
                return acc;
            }, {} as Record<string, number>);
        setDetailModalData({ title: `${hospitalName} - Servis Dağılımı`, data: hospitalServices, type: 'service' });
        setDetailModalOpen(true);
    };

    return (
        <div className="p-4 sm:p-6 space-y-6 bg-slate-50 min-h-screen pb-20">
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
                                    <p className="text-sm text-slate-500">Laboratuvar performans ve iş yükü analizi</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <HospitalSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
                                <Button onClick={() => setSettingsOpen(true)} variant="ghost" size="sm" className="gap-2"><Settings className="h-4 w-4" />Ayarlar</Button>
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

            <Card className="border-none shadow-sm">
                <CardContent className="p-4 flex flex-wrap gap-2 md:gap-4 items-end">
                    <div className="flex flex-col gap-1.5 flex-grow min-w-[200px]">
                        <Label className="text-xs font-semibold text-slate-500 uppercase">Tarih Aralığı</Label>
                        <DatePickerWithRange date={date} setDate={setDate} className="[&_button]:!bg-white [&_button]:!border-gray-200 [&_button]:!shadow-sm" />
                    </div>
                    <FilterGroup title="Hastaneler" options={filterOptions.hospitals} selected={filters.selectedHospitals} onChange={(val) => setFilters({ selectedHospitals: val })} />
                    <FilterGroup title="ASM'ler" options={filterOptions.asms} selected={filters.selectedAsms} onChange={(val) => setFilters({ selectedAsms: val })} />
                    <FilterGroup title="Servisler" options={filterOptions.services} selected={filters.selectedServices} onChange={(val) => setFilters({ selectedServices: val })} />
                    <FilterGroup title="Testler" options={filterOptions.tests} selected={filters.selectedTests} onChange={(val) => setFilters({ selectedTests: val })} />
                    <FilterGroup title="Branşlar" options={filterOptions.branches} selected={filters.selectedBranches} onChange={(val) => setFilters({ selectedBranches: val })} />
                    <Button variant="ghost" onClick={resetFilters} className="text-red-600 hover:text-red-700 hover:bg-red-50 h-9 px-3 self-end ml-auto">
                        <RefreshCcw className="w-4 h-4 mr-2" /> Tümünü Göster
                    </Button>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <KpiCard title="Toplam Test" value={kpiData.totalTests.toLocaleString()} icon={Microscope} color="text-blue-600" bg="bg-blue-50" />
                <KpiCard title="Benzersiz Numune" value={kpiData.totalSamples.toLocaleString()} icon={Users} color="text-purple-600" bg="bg-purple-50" />
                <KpiCard title="Red Oranı" value={`${kpiData.rejectionRate.toFixed(2)}%`} icon={AlertCircle} color="text-red-600" bg="bg-red-50" onClick={handleRejectionClick} />
                <KpiCard title="Ort. TAT (Dk)" value={kpiData.avgTat.toString()} icon={Clock} color="text-amber-600" bg="bg-amber-50" />
                <KpiCard title="Tekrar Oranı" value={`${kpiData.repeatRate.toFixed(2)}%`} icon={RefreshCcw} color="text-cyan-600" bg="bg-cyan-50" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader><CardTitle className="flex justify-between items-center text-base"><span>Test Sayısına Göre Hastaneler</span><span className="text-xs font-normal text-muted-foreground bg-slate-100 px-2 py-1 rounded">Acil %</span></CardTitle></CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hospitalsChartData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 11}} interval={0} />
                                <RechartsTooltip 
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return <div className="bg-white p-2 border rounded shadow-lg text-xs"><p className="font-bold">{d.name}</p><p>Test: {d.tests.toLocaleString()}</p><p className="text-red-600">Acil: {d.emergency.toLocaleString()} ({d.emergencyRate.toFixed(1)}%)</p></div>;
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="tests" fill="#3b82f6" radius={[0, 4, 4, 0]} onClick={(d) => handleHospitalClick(d.name)} cursor="pointer" />
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
