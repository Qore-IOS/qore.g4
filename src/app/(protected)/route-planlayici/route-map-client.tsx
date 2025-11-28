'use client';
import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

type Stop = { order:number; lat:number; lng:number; name:string };
type Props = {
  stops: Stop[];
  segmentStates?: ('completed' | 'current' | 'future')[]; // length = stops.length-1
};

const ASIA_BOUNDS = L.latLngBounds([40.75, 29.00],[41.35, 30.50]);
const ASIA_CENTER: [number, number] = [40.992, 29.027];

// Leaflet default marker assets (CDN)
if (typeof window !== 'undefined') {
  // @ts-ignore
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
}

export default function RouteMapClient({ stops, segmentStates }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null); // To manage markers and polylines

  // 1. Initialize map instance ONCE
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return; // Initialize only once

    const map = L.map(el, {
      maxBounds: ASIA_BOUNDS,
      maxBoundsViscosity: 1.0,
      minZoom: 9,
      attributionControl: true,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // Empty dependency array ensures this runs only once

  // 2. Update markers and lines when data changes
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    // Clear previous layers
    layerGroup.clearLayers();

    const inBoundsStops = (stops || [])
      .slice()
      .sort((a,b)=>a.order-b.order)
      .filter(s => ASIA_BOUNDS.contains([s.lat, s.lng]));

    if (inBoundsStops.length === 0) {
      map.setView(ASIA_CENTER, 11);
      return;
    }

    const bounds = L.latLngBounds([]);
    inBoundsStops.forEach((s) => {
      const p: [number, number] = [s.lat, s.lng];
      bounds.extend(p);
      const m = L.marker(p, { title: `${s.order}. ${s.name}` }).addTo(layerGroup);
      m.bindTooltip(`${s.order}. ${s.name}`, { permanent: true, direction: 'top', offset: L.point(0,-10) });
    });

    for (let i = 0; i < inBoundsStops.length - 1; i++) {
      const from = inBoundsStops[i];
      const to = inBoundsStops[i+1];
      const state = segmentStates?.[i] || 'future';
      const color = state === 'completed' ? 'green' : state === 'current' ? 'blue' : 'red';
      L.polyline([[from.lat, from.lng], [to.lat, to.lng]], { weight: 5, color }).addTo(layerGroup);
    }
    
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15));
    }

  }, [stops, segmentStates]);

  return <div ref={containerRef} className="w-full h-full rounded-xl border" />;
}
