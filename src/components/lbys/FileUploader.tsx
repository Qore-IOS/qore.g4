
'use client';

import React, { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { useLbysDataStore } from '@/store/lbys-data-store';
import { UploadCloud, FileSpreadsheet, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface FileUploaderProps {
    className?: string;
}

export function FileUploader({ className }: FileUploaderProps) {
    const { processAndUploadExcel, isLoading, processingProgress, error } = useLbysDataStore();
    const [files, setFiles] = useState<File[]>([]);
    const { toast } = useToast();

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
        const file = acceptedFiles[0];

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const worksheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[worksheetName];
            // header: 1 forces array of arrays, which the store expects
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            await processAndUploadExcel(jsonData);

        } catch (error) {
            console.error("Dosya işleme hatası:", error);
            toast({
                title: "Hata",
                description: "Dosya okunurken bir hata oluştu.",
                variant: "destructive"
            });
        }
    }, [processAndUploadExcel, toast]);

    const removeFile = (e: React.MouseEvent, fileToRemove: File) => {
        e.stopPropagation();
        setFiles(files.filter(f => f !== fileToRemove));
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
                <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 text-sm font-medium border border-red-200">
                    ⚠️ {error}
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
                            {processingProgress.current} / {processingProgress.total}
                        </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div 
                            className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out" 
                            style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-gray-400 mt-3 text-center">
                        Bu işlem veri büyüklüğüne göre birkaç saniye sürebilir. Lütfen bekleyin.
                    </p>
                </div>
            )}
        </div>
    );
}
