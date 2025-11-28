'use client';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, X, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CameraCaptureProps {
  onCapture: (imageBlob: Blob) => void;
  onClose: () => void;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Tarayıcınız kamera erişimini desteklemiyor.");
      return;
    }

    const constraints: MediaStreamConstraints = {
      video: { 
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.warn("Environment camera failed, trying default camera:", err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
         if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (finalErr: any) {
        let message = 'Kamera başlatılamadı.';
        if (finalErr.name === 'NotAllowedError') {
          message = "Kamera erişimine izin verilmedi. Lütfen tarayıcı ayarlarını kontrol edin.";
        } else if (finalErr.name === 'NotFoundError') {
          message = "Kamera bulunamadı.";
        } else {
          message = "Kamera başlatılamadı: " + finalErr.message;
        }
        setError(message);
        toast({ title: 'Kamera Hatası', description: message, variant: 'destructive' });
      }
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            onCapture(blob);
            stopCamera();
          } else {
            toast({ title: 'Hata', description: 'Görüntü yakalanamadı.', variant: 'destructive' });
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
      {error ? (
        <div className="text-white text-center p-4">
          <p className="mb-4 text-red-400">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={startCamera}>
                <RefreshCw className="mr-2 h-4 w-4" /> Yeniden Dene
            </Button>
            <Button variant="destructive" onClick={onClose}>
                Kapat
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <video 
              ref={videoRef} 
              className="max-w-full max-h-full object-contain" 
              playsInline 
              autoPlay 
              muted 
            />
            <div className="absolute inset-0 border-2 border-white/30 pointer-events-none m-8 rounded-lg">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500/50 transform -translate-y-1/2"></div>
            </div>
          </div>

          <div className="absolute bottom-8 flex gap-8 items-center">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-12 w-12 rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20"
              onClick={onClose}
            >
              <X className="h-6 w-6" />
            </Button>
            
            <Button 
              size="icon" 
              className="h-20 w-20 rounded-full bg-white border-4 border-gray-300 hover:bg-gray-100 transition-all active:scale-95 ring-2 ring-offset-2 ring-offset-black ring-white"
              onClick={capturePhoto}
            >
              <Camera className="h-8 w-8 text-black" />
            </Button>
             <div className="w-12 h-12" />
          </div>
        </>
      )}
    </div>
  );
};
