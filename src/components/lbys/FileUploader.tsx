
'use client';

import React, { useCallback, useState } from 'react';
import { useDropzone, FileRejection, DropEvent } from 'react-dropzone';
import { Upload, FileSpreadsheet, X, AlertCircle, File as FileIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

interface FileUploaderProps {
    onDataLoaded?: (data: any[]) => void; // Artık opsiyonel
    onFilesSelected?: (files: File[]) => void; // Raw dosya transferi için
    maxFiles?: number;
    acceptedFileTypes?: Record<string, string[]>;
    className?: string;
}

export function FileUploader({
    onDataLoaded,
    onFilesSelected,
    maxFiles = 1,
    acceptedFileTypes = {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'text/csv': ['.csv']
    },
    className
}: FileUploaderProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const { toast } = useToast();

    const onDrop = useCallback(async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
        // Hatalı dosyalar varsa bildir
        if (fileRejections.length > 0) {
            toast({
              title: "Dosya Kabul Edilmedi",
              description: `${fileRejections.length} dosya kabul edilmedi. Lütfen formatı kontrol edin.`,
              variant: "destructive"
            });
        }

        if (acceptedFiles.length === 0) return;

        setFiles(acceptedFiles);
        setIsLoading(true);

        try {
            // SENARYO 1: Sadece dosya seçimi isteniyorsa (Yeni Mimarimiz)
            if (onFilesSelected) {
                onFilesSelected(acceptedFiles);
                // Eğer onDataLoaded yoksa, burada işlemi bitirebiliriz.
                if (!onDataLoaded) {
                    setIsLoading(false);
                    return; 
                }
            }

            // SENARYO 2: Veri ayrıştırma isteniyorsa (Eski Mimari / Opsiyonel)
            if (onDataLoaded) {
                const file = acceptedFiles[0];
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer);
                const worksheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[worksheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                onDataLoaded(jsonData);
            }

        } catch (error) {
            console.error("Dosya işleme hatası:", error);
            toast({
              title: "Hata",
              description: "Dosya okunurken bir hata oluştu.",
              variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }

    }, [onDataLoaded, onFilesSelected, toast]);

    const removeFile = (e: React.MouseEvent, fileToRemove: File) => {
        e.stopPropagation();
        setFiles(files.filter(f => f !== fileToRemove));
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles,
        accept: acceptedFileTypes
    });

    return (
        <div className={cn("w-full", className)}>
            <div
                {...getRootProps()}
                className={cn(
                    "relative border-2 border-dashed rounded-xl p-8 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-3 text-center",
                    isDragActive 
                        ? "border-primary bg-primary/10" 
                        : "border-border hover:border-primary/50 hover:bg-accent/50",
                    isLoading && "opacity-50 pointer-events-none"
                )}
            >
                <input {...getInputProps()} />
                
                {isLoading ? (
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-10 h-10 text-primary animate-spin" />
                        <p className="mt-2 font-semibold text-muted-foreground">Dosya işleniyor...</p>
                    </div>
                ) : files.length > 0 ? (
                    <div className="w-full max-w-md space-y-2">
                        {files.map((file, i) => (
                            <div key={i} className="flex items-center gap-3 bg-background p-2 rounded-lg border shadow-sm text-left">
                                <div className="p-2 bg-green-100 rounded text-green-700">
                                    <FileSpreadsheet className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                                <button 
                                    onClick={(e) => removeFile(e, file)}
                                    className="p-1 hover:bg-red-100 text-muted-foreground hover:text-destructive rounded transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                        <p className="text-xs text-primary mt-2 font-medium">Değiştirmek için tıklayın veya dosya sürükleyin</p>
                    </div>
                ) : (
                    <>
                        <div className="p-3 bg-muted/50 rounded-full text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                            <Upload className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground">
                                Excel dosyasını buraya sürükleyin
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                veya dosya seçmek için tıklayın (.xlsx)
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

