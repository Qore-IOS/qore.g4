'use client';

import React, { useEffect, useRef, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hospital, Device } from '@/lib/types';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Anatolian side of Istanbul bounds & center
const ANATOLIA_BOUNDS = L.latLngBounds([40.85, 28.80], [41.25, 29.70]);
const ANATOLIA_CENTER: [number, number] = [41.00, 29.10];

// Light, muted tile layer for neumorphic feel
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

interface DeviceMapPanelProps {
  hospitals: Hospital[];
  panelType: 'teknik_servis' | 'aplikasyon';
}

function createCircleIcon(color: string, size: number = 14): L.DivIcon {
  return L.divIcon({
    className: 'device-map-dot',
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 4px rgba(0,0,0,0.18), 0 0 8px ${color}44;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createHospitalIcon(): L.DivIcon {
  return L.divIcon({
    className: 'device-map-hospital',
    html: `<div style="
      width:32px;height:32px;
      border-radius:10px;
      background:var(--dashboard-surface, #F3F2EF);
      border:1.5px solid var(--dashboard-stroke, rgba(0,0,0,0.06));
      box-shadow: -3px -3px 6px rgba(255,255,255,0.7), 3px 3px 6px rgba(120,120,120,0.14);
      display:flex;align-items:center;justify-content:center;
      font-size:16px;
    ">🏥</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export default function DeviceMapPanel({
  hospitals,
  panelType,
}: DeviceMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Real-time devices from 'devices' collection (same source as teknik-servis/[id])
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  // Real-time open fault reports: deviceId -> faultType
  const [openFaultMap, setOpenFaultMap] = useState<Record<string, 'teknik_servis' | 'aplikasyon'>>({});

  // Listen to all devices in real-time
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'devices'),
      (snap) => {
        setAllDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Device));
      }
    );
    return () => unsub();
  }, []);

  // Listen to open fault reports in real-time
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'deviceFaultReports'),
        where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
      ),
      (snap) => {
        const map: Record<string, 'teknik_servis' | 'aplikasyon'> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.deviceId && data.faultType) {
            // Prefer the panel's own fault type for display priority
            if (panelType === 'teknik_servis') {
              if (map[data.deviceId] === 'teknik_servis') return;
            } else {
              if (map[data.deviceId] === 'aplikasyon') return;
            }
            map[data.deviceId] = data.faultType;
          }
        });
        setOpenFaultMap(map);
      }
    );
    return () => unsub();
  }, [panelType]);

  // Build hospital location map (only hospitals with coordinates)
  const hospitalMap = useMemo(() => {
    const map = new Map<string, Hospital>();
    hospitals.forEach((h) => {
      if (h.lat && h.lng) map.set(h.id, h);
    });
    return map;
  }, [hospitals]);

  // Group devices by hospitalId
  const devicesByHospital = useMemo(() => {
    const map = new Map<string, Device[]>();
    allDevices.forEach((device) => {
      const hId = (device as any).hospitalId as string | undefined;
      if (!hId) return;
      const arr = map.get(hId) || [];
      arr.push(device);
      map.set(hId, arr);
    });
    return map;
  }, [allDevices]);

  // Determine effective fault status for a device
  const getDeviceFaultType = (device: Device): string | null => {
    const fromReports = openFaultMap[device.id];
    const fromDevice = device.arizaDurumu && device.arizaDurumu !== 'yok' ? device.arizaDurumu : null;
    return fromReports || fromDevice || null;
  };

  // Stats (only count devices that belong to hospitals with coordinates)
  const stats = useMemo(() => {
    let healthy = 0;
    let ownFault = 0;
    let otherFault = 0;
    let total = 0;

    hospitalMap.forEach((_, hospitalId) => {
      const devices = devicesByHospital.get(hospitalId) || [];
      devices.forEach((device) => {
        total++;
        const faultType = getDeviceFaultType(device);
        if (!faultType) {
          healthy++;
        } else if (faultType === panelType) {
          ownFault++;
        } else {
          otherFault++;
        }
      });
    });

    return { healthy, ownFault, otherFault, total };
  }, [hospitalMap, devicesByHospital, openFaultMap, panelType]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: ANATOLIA_CENTER,
      zoom: 11,
      maxBounds: ANATOLIA_BOUNDS.pad(0.3),
      maxBoundsViscosity: 0.8,
      minZoom: 10,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTR,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const hospitalIcon = createHospitalIcon();
    const bounds = L.latLngBounds([]);

    hospitalMap.forEach((hospital, hospitalId) => {
      const lat = hospital.lat!;
      const lng = hospital.lng!;
      const pos: [number, number] = [lat, lng];
      bounds.extend(pos);

      const devices = devicesByHospital.get(hospitalId) || [];
      const healthyCount = devices.filter((d) => !getDeviceFaultType(d)).length;
      const faultyCount = devices.length - healthyCount;

      // Hospital marker
      const hospitalMarker = L.marker(pos, { icon: hospitalIcon, zIndexOffset: 1000 });
      hospitalMarker.bindTooltip(
        `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${hospital.name || hospital.ad || 'Laboratuvar'}</div>
         <div style="font-size:11px;color:#666">${devices.length} cihaz · ${healthyCount} sağlıklı${faultyCount > 0 ? ` · ${faultyCount} arızalı` : ''}</div>`,
        { direction: 'top', offset: L.point(0, -18), className: 'device-map-tooltip' }
      );
      hospitalMarker.addTo(layerGroup);

      // Device dots arranged in a circle around the hospital
      if (devices.length > 0) {
        const radius = 0.003 + devices.length * 0.0004;
        devices.forEach((device, idx) => {
          const angle = (2 * Math.PI * idx) / devices.length - Math.PI / 2;
          const dLat = lat + radius * Math.sin(angle);
          const dLng = lng + radius * 1.4 * Math.cos(angle);

          const faultType = getDeviceFaultType(device);
          let color = '#4ADE80'; // green - healthy
          if (faultType) {
            color = faultType === panelType ? '#EF4444' : '#F59E0B'; // red=own, orange=other
          }

          const deviceName = device.cihazAdi || device.model || 'Cihaz';
          const deviceSerial = device.seriNumarasi || '';

          const dot = L.marker([dLat, dLng], {
            icon: createCircleIcon(color),
            zIndexOffset: 500,
          });
          dot.bindTooltip(
            `<div style="font-weight:600;font-size:12px">${deviceName}</div>
             ${deviceSerial ? `<div style="font-size:11px;color:#888">${deviceSerial}</div>` : ''}
             <div style="font-size:11px;margin-top:2px;color:${color};font-weight:500">${
              !faultType
                ? 'Sağlıklı'
                : faultType === 'teknik_servis'
                  ? 'Arızalı (Teknik Servis)'
                  : 'Arızalı (Aplikasyon)'
            }</div>`,
            { direction: 'top', offset: L.point(0, -8), className: 'device-map-tooltip' }
          );
          dot.addTo(layerGroup);
        });
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12));
    }
  }, [hospitalMap, devicesByHospital, openFaultMap, panelType]);

  const panelLabel = panelType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';

  return (
    <div className="device-map-shell">
      {/* Header */}
      <div className="device-map-header">
        <div>
          <h1 className="device-map-title">{panelLabel} Harita Paneli</h1>
          <p className="device-map-subtitle">Cihaz durumları · İstanbul Anadolu Yakası</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="device-map-stats">
        <div className="device-map-stat">
          <span className="device-map-stat-dot" style={{ background: '#4ADE80' }} />
          <span className="device-map-stat-label">Sağlıklı</span>
          <span className="device-map-stat-value">{stats.healthy}</span>
        </div>
        <div className="device-map-stat">
          <span className="device-map-stat-dot" style={{ background: '#EF4444' }} />
          <span className="device-map-stat-label">
            {panelType === 'teknik_servis' ? 'Teknik Arıza' : 'Aplikasyon Arıza'}
          </span>
          <span className="device-map-stat-value">{stats.ownFault}</span>
        </div>
        <div className="device-map-stat">
          <span className="device-map-stat-dot" style={{ background: '#F59E0B' }} />
          <span className="device-map-stat-label">
            {panelType === 'teknik_servis' ? 'Aplikasyon Arıza' : 'Teknik Arıza'}
          </span>
          <span className="device-map-stat-value">{stats.otherFault}</span>
        </div>
        <div className="device-map-stat device-map-stat-total">
          <span className="device-map-stat-label">Toplam</span>
          <span className="device-map-stat-value">{stats.total}</span>
        </div>
      </div>

      {/* Map container */}
      <div className="device-map-container">
        <div ref={containerRef} className="device-map-leaflet" />
      </div>
    </div>
  );
}
