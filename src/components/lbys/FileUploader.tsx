'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { useLbysDataStore } from '@/store/lbys-data-store';
import { UploadCloud, FileSpreadsheet, X, Loader2, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface FileUploaderProps {
    className?: string;
}

interface WorkerMessage {
    type: 'progress' | 'complete' | 'error';
    current?: number;
    total?: number;
    status?: string;
    data?: any[];
    stats?: {
        totalRows: number;
        processedRows: number;
        skippedCount: number;
        skippedDuplicateDates: number;
        labAcceptedCount: number;
        workedCount: number;
        approvedCount: number;
        uniqueGroups: number;
        newDates: string[];
    };
    error?: string;
}

export function FileUploader({ className }: FileUploaderProps) {
    const {
        processAndUploadExcel,
        uploadParsedData,
        isLoading,
        processingProgress,
        error,
        getExistingDates
    } = useLbysDataStore();
    const [files, setFiles] = useState<File[]>([]);
    const [useWorker, setUseWorker] = useState(true);
    const [workerSupported, setWorkerSupported] = useState(false);
    const [parseStats, setParseStats] = useState<WorkerMessage['stats'] | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const { toast } = useToast();

    // Check Web Worker support on mount
    useEffect(() => {
        setWorkerSupported(typeof Worker !== 'undefined');
    }, []);

    // Cleanup worker on unmount
    useEffect(() => {
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);

    const processWithWorker = useCallback(async (buffer: ArrayBuffer, existingDates: string[]) => {
        return new Promise<{ data: any[]; stats: WorkerMessage['stats'] }>((resolve, reject) => {
            // Create worker
            workerRef.current = new Worker('/workers/excel-parser.worker.js');

            workerRef.current.onmessage = (e: MessageEvent<WorkerMessage>) => {
                const { type, current, total, status, data, stats, error: workerError } = e.data;

                if (type === 'progress') {
                    useLbysDataStore.setState({
                        processingProgress: {
                            current: current || 0,
                            total: total || 0,
                            status: status || 'İşleniyor...'
                        }
                    });
                } else if (type === 'complete') {
                    workerRef.current?.terminate();
                    workerRef.current = null;
                    resolve({ data: data || [], stats });
                } else if (type === 'error') {
                    workerRef.current?.terminate();
                    workerRef.current = null;
                    reject(new Error(workerError || 'Worker hatası'));
                }
            };

            workerRef.current.onerror = (error) => {
                workerRef.current?.terminate();
                workerRef.current = null;
                reject(new Error(error.message || 'Worker hatası'));
            };

            // Start processing
            workerRef.current.postMessage({
                type: 'parse',
                buffer,
                existingDates
            });
        });
    }, []);

    const processWithMainThread = useCallback(async (buffer: ArrayBuffer) => {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        await processAndUploadExcel(jsonData);
    }, [processAndUploadExcel]);

    const onDrop = useCallback(async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
        if (fileRejections.length > 0) {
            toast({
                title: "Dosya Kabul Edilmedi",
                description: `${fileRejections.length} dosya kabul edilmedi. Lütfen formatı kontrol edin.`,
                variant: "destructive"
            });
        }
        if (acceptedFiles.length === 0) return;

        setFiles(acceptedFiles);
        setParseStats(null);
        const file = acceptedFiles[0];

        try {
            const buffer = await file.arrayBuffer();

            if (useWorker && workerSupported) {
                // Get existing dates for incremental upload
                useLbysDataStore.setState({
                    isLoading: true,
                    error: null,
                    processingProgress: { current: 0, total: 100, status: 'Mevcut tarihler kontrol ediliyor...' }
                });

                const existingDates = await getExistingDates();

                useLbysDataStore.setState({
                    processingProgress: { current: 0, total: 100, status: 'Web Worker başlatılıyor...' }
                });

                // Process with Web Worker
                const { data, stats } = await processWithWorker(buffer, existingDates);

                setParseStats(stats);

                if (data.length === 0) {
                    if (stats && stats.skippedDuplicateDates > 0) {
                        toast({
                            title: "Veri Zaten Mevcut",
                            description: `${stats.skippedDuplicateDates} satır zaten yüklenmiş tarihler içeriyor. Yeni veri yok.`,
                        });
                    } else {
                        toast({
                            title: "Geçerli Veri Bulunamadı",
                            description: "Excel dosyasında işlenecek geçerli veri bulunamadı.",
                            variant: "destructive"
                        });
                    }
                    useLbysDataStore.setState({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
                    return;
                }

                // Upload parsed data
                await uploadParsedData(data);

                toast({
                    title: "Yükleme Tamamlandı",
                    description: `${stats?.labAcceptedCount || data.length} test kaydı başarıyla yüklendi.${stats?.skippedDuplicateDates ? ` (${stats.skippedDuplicateDates} mevcut kayıt atlandı)` : ''}`,
                });

            } else {
                // Fallback to main thread processing
                await processWithMainThread(buffer);
            }

        } catch (error) {
            console.error("Dosya işleme hatası:", error);
            toast({
                title: "Hata",
                description: error instanceof Error ? error.message : "Dosya okunurken bir hata oluştu.",
                variant: "destructive"
            });
            useLbysDataStore.setState({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
    }, [processAndUploadExcel, processWithWorker, processWithMainThread, toast, useWorker, workerSupported, getExistingDates, uploadParsedData]);

    const removeFile = (e: React.MouseEvent, fileToRemove: File) => {
        e.stopPropagation();
        setFiles(files.filter(f => f !== fileToRemove));
        setParseStats(null);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
            'text/csv': ['.csv']
        }
    });

    return (
        <div className={cn("w-full max-w-4xl mx-auto mb-8", className)}>
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 text-sm font-medium border border-red-200 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Worker toggle (only show if supported) */}
            {workerSupported && !isLoading && (
                <div className="flex items-center justify-end gap-2 mb-2">
                    <button
                        onClick={() => setUseWorker(!useWorker)}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                            useWorker
                                ? "bg-primary/10 text-primary border border-primary/20"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                    >
                        <Zap className="h-3 w-3" />
                        {useWorker ? "Hızlı Mod Aktif" : "Hızlı Mod Kapalı"}
                    </button>
                </div>
            )}

            {!isLoading ? (
                <div
                  {...getRootProps()}
                  className={cn(
                    "relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200",
                    isDragActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  )}
                >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <div className={`p-4 rounded-full ${isDragActive ? 'bg-primary/20' : 'bg-muted'}`}>
                            <UploadCloud className={`w-8 h-8 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                            <p className="text-lg font-semibold text-foreground">
                                {isDragActive ? 'Dosyayı buraya bırakın' : 'Excel/CSV Dosyasını Yükle'}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                İstatistik.xlsx dosyasını sürükleyip bırakın veya tıklayın
                            </p>
                            {useWorker && workerSupported && (
                                <p className="text-xs text-primary mt-2 flex items-center justify-center gap-1">
                                    <Zap className="h-3 w-3" />
                                    Hızlı Mod: 150K+ satır arka planda işlenecek
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                            <Loader2 className="h-5 w-5 animate-spin text-primary"/>
                            <h3 className="font-semibold text-gray-800">{processingProgress.status}</h3>
                        </div>
                        <span className="text-sm font-mono text-gray-500">
                            {processingProgress.total > 0 ? `${processingProgress.current.toLocaleString('tr-TR')} / ${processingProgress.total.toLocaleString('tr-TR')}` : '...'}
                        </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div
                            className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out"
                            style={{ width: processingProgress.total > 0 ? `${(processingProgress.current / processingProgress.total) * 100}%` : '0%' }}
                        ></div>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-gray-400">
                            {useWorker && workerSupported
                                ? "Hızlı Mod: İşlem arka planda çalışıyor, UI donmayacak."
                                : "Bu işlem veri büyüklüğüne göre birkaç saniye sürebilir."}
                        </p>
                        {processingProgress.total > 0 && (
                            <span className="text-xs font-medium text-primary">
                                {Math.round((processingProgress.current / processingProgress.total) * 100)}%
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Parse statistics (shown after successful parse) */}
            {parseStats && !isLoading && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <h4 className="font-semibold text-green-800">İşlem Tamamlandı</h4>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="bg-white/60 rounded-md p-2">
                            <span className="text-gray-500">Lab Kabul:</span>
                            <span className="font-medium text-gray-800 ml-1">{parseStats.labAcceptedCount.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="bg-white/60 rounded-md p-2">
                            <span className="text-gray-500">Çalışılmış:</span>
                            <span className="font-medium text-gray-800 ml-1">{parseStats.workedCount.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="bg-white/60 rounded-md p-2">
                            <span className="text-gray-500">Onaylanmış:</span>
                            <span className="font-medium text-gray-800 ml-1">{parseStats.approvedCount.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="bg-white/60 rounded-md p-2">
                            <span className="text-gray-500">Grup Sayısı:</span>
                            <span className="font-medium text-gray-800 ml-1">{parseStats.uniqueGroups.toLocaleString('tr-TR')}</span>
                        </div>
                    </div>
                    {parseStats.skippedDuplicateDates > 0 && (
                        <p className="text-xs text-green-700 mt-2">
                            {parseStats.skippedDuplicateDates.toLocaleString('tr-TR')} satır mevcut tarihlerde olduğu için atlandı.
                        </p>
                    )}
                    {parseStats.newDates.length > 0 && (
                        <p className="text-xs text-green-700 mt-1">
                            Yeni tarihler: {parseStats.newDates.slice(0, 5).join(', ')}{parseStats.newDates.length > 5 ? ` ve ${parseStats.newDates.length - 5} diğer` : ''}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
