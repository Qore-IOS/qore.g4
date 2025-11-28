
'use client';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LocationPickerProps {
  initialPosition: [number, number];
  markerPosition?: [number, number];
  onSelect: (lat: number, lng: number) => void;
}

export default function LocationPicker({
  initialPosition,
  markerPosition,
  onSelect,
}: LocationPickerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (containerRef.current && !mapRef.current) {
      const map = L.map(containerRef.current, {
        center: initialPosition,
        zoom: 11,
        zoomControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      map.on('click', (e) => {
        onSelect(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;

      if (markerPosition) {
        markerRef.current = L.marker(markerPosition).addTo(map);
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // Run only once

  useEffect(() => {
    if (mapRef.current && markerPosition) {
      if (markerRef.current) {
        markerRef.current.setLatLng(markerPosition);
      } else {
        markerRef.current = L.marker(markerPosition).addTo(mapRef.current);
      }
      mapRef.current.setView(markerPosition, 13);
    }
  }, [markerPosition]);

  return <div ref={containerRef} className="h-full w-full rounded-md" />;
}
