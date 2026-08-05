'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
    Loader2,
    Unplug,
    Building2,
    Monitor,
    Package,
    Check,
    History,
    AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { getScopedDocs, scopedQuery } from '@/lib/firestore-helpers';
import { db } from '@/lib/firebase';
import {
    collection,
    getDocs,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import type {
    Hospital,
    Device,
    ProductCode,
    MinMaxRule,
    EjectedKitRecord,
    TrashBinRecord,
} from '@/lib/types';
import { cn, generateId } from '@/lib/utils';
import { LabSelector } from '@/components/common/LabSelector';
import BackButton from '@/components/BackButton';
import { openEjectedKitFaultReport } from '@/lib/faults';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

export default function EjectedKitPanel() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

    const initialTab = searchParams.get('tab') || 'kayit';
    const [activeTab, setActiveTab] = useState(initialTab);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Master Data
    const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
    const [allDevices, setAllDevices] = useState<Device[]>([]);
    const [allProducts, setAllProducts] = useState<ProductCode[]>([]);
    const [ejectedKitRecords, setEjectedKitRecords] = useState<EjectedKitRecord[]>([]);
    const [trashBinRecords, setTrashBinRecords] = useState<TrashBinRecord[]>([]);

    // Selection State
    const [selectedLabId, setSelectedLabId] = useState<string>('');
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [labMinMaxRules, setLabMinMaxRules] = useState<MinMaxRule[]>([]);

    // Form State
    const [quantityType, setQuantityType] = useState<'kutu' | 'test'>('kutu');
    const [testCount, setTestCount] = useState<number>(1);
    const [aciklama, setAciklama] = useState<string>('');

    // Modal State
    const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);

    // Computed Values
    const selectedLab = useMemo(
        () => allHospitals.find((h) => h.id === selectedLabId),
        [allHospitals, selectedLabId]
    );

    const labDevices = useMemo(() => {
        if (!selectedLabId) return [];
        return allDevices
            .filter((d) => d.hospitalId === selectedLabId)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [allDevices, selectedLabId]);

    const selectedDevice = useMemo(
        () => allDevices.find((d) => d.id === selectedDeviceId),
        [allDevices, selectedDeviceId]
    );

    const availableProducts = useMemo(() => {
        const ruleStockCodes = new Set(labMinMaxRules.map((r) => r.stokKodu));
        return allProducts.filter((p) => ruleStockCodes.has(p.stokKodu));
    }, [labMinMaxRules, allProducts]);

    const selectedProduct = useMemo(
        () => allProducts.find((p) => p.id === selectedProductId),
        [allProducts, selectedProductId]
    );

    const calculatedTestCount = useMemo(() => {
        if (quantityType === 'kutu' && selectedProduct) {
            return selectedProduct.ambalajDegeri || 1;
        }
        return testCount;
    }, [quantityType, selectedProduct, testCount]);

    // Sorted hospitals alphabetically
    const sortedHospitals = useMemo(() => {
        return [...allHospitals].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }, [allHospitals]);

    // Data Fetching
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [hospitalDocs, deviceDocs, productDocs] = await Promise.all([
                getScopedDocs('hospitals', currentCompanyId, isSuperAdmin),
                getScopedDocs('devices', currentCompanyId, isSuperAdmin),
                getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
            ]);

            setAllHospitals(hospitalDocs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
            setAllDevices(deviceDocs.map((d) => ({ id: d.id, ...d.data() } as Device)));
            setAllProducts(productDocs.map((d) => ({ id: d.id, ...d.data() } as ProductCode)));
        } catch (err) {
            console.error('Error fetching data:', err);
            toast({
                title: 'Hata',
                description: 'Veriler yüklenemedi.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [currentCompanyId, isSuperAdmin, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Fetch min-max rules when lab is selected
    useEffect(() => {
        if (!selectedLabId) {
            setLabMinMaxRules([]);
            return;
        }
        const fetchRules = async () => {
            try {
                const rulesSnap = await getDocs(
                    collection(db, 'hospitals', selectedLabId, 'minMaxRules')
                );
                setLabMinMaxRules(rulesSnap.docs.map((d) => d.data() as MinMaxRule));
            } catch (err) {
                console.error('Error fetching min-max rules:', err);
                setLabMinMaxRules([]);
            }
        };
        fetchRules();
    }, [selectedLabId]);

    // Listen to ejected kit records
    useEffect(() => {
        const q = query(
            scopedQuery('ejectedKitRecords', currentCompanyId, isSuperAdmin),
            orderBy('createdAt', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const records: EjectedKitRecord[] = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            } as EjectedKitRecord));
            setEjectedKitRecords(records);
        });
        return () => unsubscribe();
    }, []);

    // Listen to trash bin records
    useEffect(() => {
        const q = query(
            scopedQuery('trashBinRecords', currentCompanyId, isSuperAdmin),
            orderBy('createdAt', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const records: TrashBinRecord[] = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            } as TrashBinRecord));
            setTrashBinRecords(records);
        });
        return () => unsubscribe();
    }, []);

    // Handlers
    const handleLabSelect = (labId: string) => {
        setSelectedLabId(labId);
        setSelectedDeviceId('');
        setSelectedProductId('');
    };

    const handleDeviceSelect = (deviceId: string) => {
        setSelectedDeviceId(deviceId);
        setIsDeviceModalOpen(false);
    };

    const handleProductSelect = (productId: string) => {
        setSelectedProductId(productId);
        setIsProductModalOpen(false);
        // Reset quantity to package value if kutu is selected
        const product = allProducts.find((p) => p.id === productId);
        if (product && quantityType === 'kutu') {
            setTestCount(product.ambalajDegeri || 1);
        }
    };

    const resetForm = () => {
        setSelectedLabId('');
        setSelectedDeviceId('');
        setSelectedProductId('');
        setQuantityType('kutu');
        setTestCount(1);
        setAciklama('');
        setLabMinMaxRules([]);
    };

    const handleSubmit = async () => {
        if (!selectedLab || !selectedDevice || !selectedProduct) {
            toast({
                title: 'Eksik Bilgi',
                description: 'Laboratuvar, cihaz ve ürün seçilmelidir.',
                variant: 'destructive',
            });
            return;
        }

        if (!aciklama.trim()) {
            toast({
                title: 'Açıklama Zorunlu',
                description: 'Lütfen açıklama alanını doldurun.',
                variant: 'destructive',
            });
            return;
        }

        setSubmitting(true);
        try {
            // Create fault report first
            const faultReportId = await openEjectedKitFaultReport({
                hospitalId: selectedLabId,
                labName: selectedLab.name,
                deviceId: selectedDeviceId,
                model: selectedDevice.model || selectedDevice.cihazAdi || '',
                serial: selectedDevice.seriNumarasi || '',
                openedByUid: currentUser?.uid || '',
                openedByName: currentUserProfile?.name || '',
                openDescription: aciklama,
                stokKodu: selectedProduct.stokKodu,
                stokAdi: selectedProduct.stokAdi,
                cihazGrubu: selectedProduct.cihazGrubu,
                testCount: calculatedTestCount,
                quantityType,
                deviceImageUrl: selectedDevice.imageUrl || undefined,
                companyId: currentUserProfile?.companyId ?? null,
            });

            // Create ejected kit record
            const ejectedKitRecord: Omit<EjectedKitRecord, 'id'> = {
                laboratoryId: selectedLabId,
                laboratoryName: selectedLab.name,
                deviceId: selectedDeviceId,
                deviceModel: selectedDevice.model || selectedDevice.cihazAdi || '',
                deviceSerial: selectedDevice.seriNumarasi || '',
                deviceImageUrl: selectedDevice.imageUrl || '',
                stokKodu: selectedProduct.stokKodu,
                stokAdi: selectedProduct.stokAdi,
                cihazGrubu: selectedProduct.cihazGrubu,
                quantityType,
                testCount: calculatedTestCount,
                aciklama,
                createdAt: serverTimestamp(),
                createdByUid: currentUser?.uid || '',
                createdByName: currentUserProfile?.name || '',
                faultReportId,
            };

            await addDoc(collection(db, 'ejectedKitRecords'), withCompanyScope(ejectedKitRecord, currentCompanyId));

            toast({
                title: 'Kayıt Oluşturuldu',
                description: 'Cihazdan çıkan kit kaydı ve arıza bildirimi oluşturuldu.',
            });

            resetForm();
        } catch (err) {
            console.error('Error creating ejected kit record:', err);
            toast({
                title: 'Hata',
                description: 'Kayıt oluşturulamadı.',
                variant: 'destructive',
            });
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (timestamp: any) => {
        if (!timestamp) return '-';
        const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
        return format(date, 'dd.MM.yyyy HH:mm', { locale: tr });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4">
            <BackButton fallback="/urun-talep" />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Unplug className="h-6 w-6 text-primary" />
                        Cihazdan Çıkan Kit
                    </CardTitle>
                    <CardDescription>
                        Cihazdan hata vererek çıkan kitleri kayıt altına alın.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="kayit">Kayıt</TabsTrigger>
                            <TabsTrigger value="gecmis">Geçmiş</TabsTrigger>
                            <TabsTrigger value="cop-kutusu">Çöp Kutusu</TabsTrigger>
                        </TabsList>

                        <TabsContent value="kayit" className="space-y-6 pt-4">
                            {/* Lab Selection */}
                            <LabSelector
                                label="Laboratuvar"
                                labs={sortedHospitals.map(h => ({ id: h.id, name: h.name, kod: h.kod }))}
                                value={selectedLabId}
                                onChange={(id) => handleLabSelect(id)}
                                placeholder="Laboratuvar seçin..."
                            />

                            {/* Device Selection */}
                            {selectedLabId && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Cihaz</label>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start"
                                        onClick={() => setIsDeviceModalOpen(true)}
                                        disabled={labDevices.length === 0}
                                    >
                                        <Monitor className="mr-2 h-4 w-4" />
                                        {selectedDevice
                                            ? `${selectedDevice.brand} ${selectedDevice.model} (${selectedDevice.seriNumarasi})`
                                            : 'Cihaz seçin...'}
                                    </Button>
                                    {labDevices.length === 0 && (
                                        <p className="text-sm text-muted-foreground">
                                            Bu laboratuvarda tanımlı cihaz bulunmuyor.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Product Selection */}
                            {selectedDeviceId && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Ürün</label>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start"
                                        onClick={() => setIsProductModalOpen(true)}
                                        disabled={availableProducts.length === 0}
                                    >
                                        <Package className="mr-2 h-4 w-4" />
                                        {selectedProduct
                                            ? `${selectedProduct.stokAdi} (${selectedProduct.stokKodu})`
                                            : 'Ürün seçin...'}
                                    </Button>
                                    {availableProducts.length === 0 && (
                                        <p className="text-sm text-muted-foreground">
                                            Bu laboratuvarda Min-Max tanımlı ürün bulunmuyor.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Quantity Type Selection */}
                            {selectedProductId && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Miktar Tipi</label>
                                        <Select
                                            value={quantityType}
                                            onValueChange={(v) => setQuantityType(v as 'kutu' | 'test')}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="kutu">Kutu (Tam Ambalaj)</SelectItem>
                                                <SelectItem value="test">Test (Manuel Adet)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">
                                            Test Adedi{' '}
                                            {quantityType === 'kutu' && (
                                                <span className="text-muted-foreground">
                                                    (Ambalaj: {selectedProduct?.ambalajDegeri || 1})
                                                </span>
                                            )}
                                        </label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={quantityType === 'kutu' ? calculatedTestCount : testCount}
                                            onChange={(e) => setTestCount(Number(e.target.value))}
                                            disabled={quantityType === 'kutu'}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Description */}
                            {selectedProductId && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">
                                        Açıklama <span className="text-destructive">*</span>
                                    </label>
                                    <Textarea
                                        placeholder="Kitin neden çıktığını açıklayın..."
                                        value={aciklama}
                                        onChange={(e) => setAciklama(e.target.value)}
                                        rows={3}
                                    />
                                </div>
                            )}

                            {/* Submit Button */}
                            {selectedProductId && (
                                <Button
                                    onClick={handleSubmit}
                                    disabled={submitting || !aciklama.trim()}
                                    className="w-full"
                                >
                                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Kaydet ve Arıza Bildirimi Oluştur
                                </Button>
                            )}
                        </TabsContent>

                        <TabsContent value="gecmis" className="pt-4">
                            <ScrollArea className="h-[500px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Tarih</TableHead>
                                            <TableHead>Laboratuvar</TableHead>
                                            <TableHead>Cihaz</TableHead>
                                            <TableHead>Ürün</TableHead>
                                            <TableHead>Adet</TableHead>
                                            <TableHead>Kaydeden</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {ejectedKitRecords.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8">
                                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                        <History className="h-8 w-8" />
                                                        <span>Henüz kayıt bulunmuyor.</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            ejectedKitRecords.map((record) => (
                                                <TableRow
                                                    key={record.id}
                                                    className="cursor-pointer hover:bg-muted/50"
                                                    onClick={() =>
                                                        router.push(`/ariza-yonetimi/${record.faultReportId}`)
                                                    }
                                                >
                                                    <TableCell className="text-xs">
                                                        {formatDate(record.createdAt)}
                                                    </TableCell>
                                                    <TableCell>{record.laboratoryName}</TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            {record.deviceImageUrl && (
                                                                <Image
                                                                    src={resolveImageSrc(record.deviceImageUrl)}
                                                                    alt={record.deviceModel}
                                                                    width={32}
                                                                    height={32}
                                                                    className="rounded"
                                                                />
                                                            )}
                                                            <span>{record.deviceModel}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div>
                                                            <div className="font-medium">{record.stokAdi}</div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {record.stokKodu}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">
                                                            {record.testCount} test
                                                            {record.quantityType === 'kutu' && ' (1 kutu)'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{record.createdByName}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </TabsContent>

                        <TabsContent value="cop-kutusu" className="pt-4">
                            <ScrollArea className="h-[500px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Tarih</TableHead>
                                            <TableHead>Laboratuvar</TableHead>
                                            <TableHead>Cihaz</TableHead>
                                            <TableHead>Ürün</TableHead>
                                            <TableHead>Kalan Test</TableHead>
                                            <TableHead>Kaydeden</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {trashBinRecords.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8">
                                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                        <AlertCircle className="h-8 w-8" />
                                                        <span>Henüz çöp kutusu kaydı bulunmuyor.</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            trashBinRecords.map((record) => (
                                                <TableRow key={record.id}>
                                                    <TableCell className="text-xs">
                                                        {formatDate(record.createdAt)}
                                                    </TableCell>
                                                    <TableCell>{record.laboratoryName}</TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{record.deviceModel}</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                SN: {record.deviceSerialNumber}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div>
                                                            <div className="font-medium">{record.stokAdi}</div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {record.stokKodu}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">
                                                            {record.remainingTests} test
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{record.createdByName}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            {/* Device Selection Modal */}
            <Dialog open={isDeviceModalOpen} onOpenChange={setIsDeviceModalOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Cihaz Seçin</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="h-[400px]">
                        <div className="grid grid-cols-2 gap-4 p-2">
                            {labDevices.map((device) => (
                                <Card
                                    key={device.id}
                                    className={cn(
                                        'cursor-pointer transition-all hover:border-primary',
                                        selectedDeviceId === device.id && 'border-primary bg-primary/5'
                                    )}
                                    onClick={() => handleDeviceSelect(device.id)}
                                >
                                    <CardContent className="p-4 flex flex-col items-center gap-2">
                                        {device.imageUrl ? (
                                            <Image
                                                src={resolveImageSrc(device.imageUrl)}
                                                alt={device.model || ''}
                                                width={80}
                                                height={80}
                                                className="rounded-lg object-contain"
                                            />
                                        ) : (
                                            <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
                                                <Monitor className="h-8 w-8 text-muted-foreground" />
                                            </div>
                                        )}
                                        <div className="text-center">
                                            <p className="font-medium text-sm">
                                                {device.brand} {device.model}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {device.seriNumarasi}
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>

            {/* Product Selection Modal */}
            <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Ürün Seçin</DialogTitle>
                    </DialogHeader>
                    <Command className="rounded-lg border shadow-md">
                        <CommandInput placeholder="Ürün ara..." />
                        <CommandList>
                            <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                            <CommandGroup>
                                <ScrollArea className="h-[300px]">
                                    {availableProducts.map((product) => (
                                        <CommandItem
                                            key={product.id}
                                            value={`${product.stokKodu} ${product.stokAdi}`}
                                            onSelect={() => handleProductSelect(product.id)}
                                        >
                                            <Check
                                                className={cn(
                                                    'mr-2 h-4 w-4',
                                                    selectedProductId === product.id
                                                        ? 'opacity-100'
                                                        : 'opacity-0'
                                                )}
                                            />
                                            <div className="flex flex-col">
                                                <span>{product.stokAdi}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {product.stokKodu} • Ambalaj: {product.ambalajDegeri || 1}
                                                </span>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </ScrollArea>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </div>
    );
}
