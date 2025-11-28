'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api';
import { Loader2 } from 'lucide-react';

const MAP_STYLES_HIDE_LABELS: google.maps.MapTypeStyle[] = [
  { featureType: 'all', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

type Props = {
  value?: { lat?: number; lng?: number };
  onChange: (coords: { lat: number; lng: number }) => void;
  height?: string | number;
};

export default function GoogleLocationPicker({ value, onChange, height = 360 }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    (window as any).gm_authFailure = () => setAuthFailed(true);
    return () => { try { delete (window as any).gm_authFailure; } catch {} };
  }, []);

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-[360px] text-sm text-center p-4">
        Google Maps API anahtarı eksik. <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> giriniz.
      </div>
    );
  }

  const { isLoaded, loadError } = useLoadScript({
    id: 'gmp-loader',
    googleMapsApiKey: apiKey,
    language: 'tr',
    region: 'TR',
    version: 'weekly',
  });

  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(
    value?.lat && value?.lng ? { lat: value.lat, lng: value.lng } : null
  );

  const center = pos || { lat: 41.0082, lng: 28.9784 }; // Default to Istanbul

  const handleClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    const newPos = { lat, lng };
    setPos(newPos);
    onChange(newPos);
  }, [onChange]);

  useEffect(() => {
    if (value?.lat && value?.lng) {
        setPos({ lat: value.lat, lng: value.lng });
    }
  }, [value]);

  if (authFailed) {
    return (
      <div className="flex items-center justify-center h-[360px] text-sm text-center p-4">
        Harita yetkilendirme hatası. Billing + referrer kısıtlarını kontrol edin.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-[360px] text-sm text-center p-4">
        Harita yüklenemedi. API/Referrer/Billing yapılandırmasını doğrulayın.
      </div>
    );
  }

  if (!isLoaded) return <div className="flex items-center justify-center h-[360px]"><Loader2 className="h-6 w-6 animate-spin"/></div>;

  return (
    <div className="rounded-lg overflow-hidden border">
      <GoogleMap
        zoom={12}
        center={center}
        onClick={handleClick}
        mapContainerStyle={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          styles: MAP_STYLES_HIDE_LABELS,
        }}
      >
        {pos && (
          <Marker
            position={pos}
            draggable
            onDragEnd={(e) => {
              const lat = e.latLng?.lat(); const lng = e.latLng?.lng();
              if (typeof lat === 'number' && typeof lng === 'number') {
                const next = { lat, lng };
                setPos(next);
                onChange(next);
              }
            }}
          />
        )}
      </GoogleMap>
      <div className="p-2 text-xs text-muted-foreground">
        Haritaya tıklayarak konum atayabilir veya marker’ı sürükleyebilirsiniz.
      </div>
    </div>
  );
}
