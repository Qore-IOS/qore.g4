'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { ocrBlob } from '@/lib/pdf';

type CameraBarcodeScannerProps = {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
  enableOcrLabelScan?: boolean;
  onOcrLabelScan?: (text: string) => void;
};

export default function CameraBarcodeScanner({
  onScanSuccess,
  onClose,
  enableOcrLabelScan = false,
  onOcrLabelScan,
}: CameraBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const isOcrRunningRef = useRef(false);

  const cleanup = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    if (animationFrameId.current != null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
  }, []);

  const startScan = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      if (!videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Fallback to ZXing
      codeReaderRef.current = new BrowserMultiFormatReader();
      codeReaderRef.current.decodeFromVideoDevice(
        null,
        videoRef.current,
        (result, err) => {
          if (result) {
            onScanSuccess(result.getText());
            cleanup();
          }
          if (err && !(err instanceof NotFoundException)) {
            console.error('ZXing scan error:', err);
          }
        }
      );

    } catch (err) {
      console.error('Camera setup error:', err);
      // Handle permission errors, etc.
    }
  }, [onScanSuccess, cleanup]);

  useEffect(() => {
    startScan();
    return () => {
      cleanup();
    };
  }, [startScan, cleanup]);

  const runOcrFromFrame = useCallback(async () => {
    if (!videoRef.current || !onOcrLabelScan || isOcrRunningRef.current) return;

    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    isOcrRunningRef.current = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92);
      });
      if (!blob) return;

      const text = await ocrBlob(blob);
      if (text?.trim()) {
        onOcrLabelScan(text);
      }
    } catch (error) {
      console.error('OCR label scan error:', error);
    } finally {
      isOcrRunningRef.current = false;
    }
  }, [onOcrLabelScan]);

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
      />
       <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-4/5 h-2/5 border-2 border-red-500/50 rounded-lg shadow-lg animate-pulse"/>
      </div>
      <button
        onClick={() => {
          cleanup();
          onClose();
        }}
        className="absolute top-4 right-4 p-2 bg-white/80 rounded-full hover:bg-white z-10"
      >
        <X className="h-6 w-6 text-gray-900" />
      </button>
      {enableOcrLabelScan && onOcrLabelScan && (
        <button
          onClick={runOcrFromFrame}
          disabled={isOcrRunningRef.current}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/90 text-gray-900 rounded-md text-sm font-medium hover:bg-white disabled:opacity-60 z-10"
        >
          Etiket Tara (OCR)
        </button>
      )}
    </div>
  );
}
