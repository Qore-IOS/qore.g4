'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hospital, Device, MaintenancePlan, MaintenanceLog } from '@/lib/types';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

// Turkey-wide bounds (no region restriction)
const TURKEY_CENTER: [number, number] = [39.0, 35.0];
const TURKEY_BOUNDS = L.latLngBounds([36.0, 26.0], [42.5, 45.0]);

// Light, muted tile layer for neumorphic feel
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Days threshold for "maintenance approaching" warning
const MAINTENANCE_WARNING_DAYS = 30;

interface DeviceMapPanelProps {
  hospitals: Hospital[];
  panelType: 'teknik_servis' | 'aplikasyon';
}

interface HospitalSummary {
  hospital: Hospital;
  healthy: number;
  faulty: number;
  maintenanceSoon: number;
  total: number;
}

interface DeviceListItem {
  id: string;
  name: string;
  serial: string;
  category: 'faulty' | 'maintenance' | 'healthy';
  faultReportId?: string;
}

interface SelectedHospital {
  hospitalId: string;
  hospitalName: string;
  devices: DeviceListItem[];
}

function createSummaryIcon(summary: HospitalSummary): L.DivIcon {
  const { healthy, faulty, maintenanceSoon } = summary;
  const badges: string[] = [];

  if (healthy > 0) {
    badges.push(`<span style="
      display:inline-flex;align-items:center;justify-content:center;
      min-width:28px;height:28px;padding:0 7px;
      border-radius:14px;
      background:#22c55e;color:#fff;
      font-size:12px;font-weight:700;
      box-shadow:0 2px 6px rgba(34,197,94,0.35);
    ">${healthy}</span>`);
  }

  if (faulty > 0) {
    badges.push(`<span style="
      display:inline-flex;align-items:center;justify-content:center;
      min-width:28px;height:28px;padding:0 7px;
      border-radius:14px;
      background:#ef4444;color:#fff;
      font-size:12px;font-weight:700;
      box-shadow:0 2px 6px rgba(239,68,68,0.35);
    ">${faulty}</span>`);
  }

  if (maintenanceSoon > 0) {
    badges.push(`<span style="
      display:inline-flex;align-items:center;justify-content:center;
      min-width:28px;height:28px;padding:0 7px;
      border-radius:14px;
      background:#f59e0b;color:#fff;
      font-size:12px;font-weight:700;
      box-shadow:0 2px 6px rgba(245,158,11,0.35);
    ">⚠ ${maintenanceSoon}</span>`);
  }

  const badgesHtml = badges.join('');
  const totalWidth = Math.max(40, badges.length * 36 + 8);

  const html = `<div style="
    display:flex;flex-direction:column;align-items:center;gap:4px;
    pointer-events:auto;cursor:pointer;
  ">
    <div style="
      display:flex;align-items:center;gap:4px;
      padding:4px 6px;
      border-radius:16px;
      background:var(--dashboard-surface, #F3F2EF);
      border:1.5px solid var(--dashboard-stroke, rgba(0,0,0,0.06));
      box-shadow: -3px -3px 6px rgba(255,255,255,0.7), 3px 3px 6px rgba(120,120,120,0.14);
    ">${badgesHtml}</div>
    <div style="
      width:32px;height:32px;
      border-radius:10px;
      background:var(--dashboard-surface, #F3F2EF);
      border:1.5px solid var(--dashboard-stroke, rgba(0,0,0,0.06));
      box-shadow: -3px -3px 6px rgba(255,255,255,0.7), 3px 3px 6px rgba(120,120,120,0.14);
      display:flex;align-items:center;justify-content:center;
      font-size:16px;
    ">🏥</div>
  </div>`;

  return L.divIcon({
    className: 'device-map-hospital',
    html,
    iconSize: [totalWidth, 68],
    iconAnchor: [totalWidth / 2, 68],
  });
}

export default function DeviceMapPanel({
  hospitals,
  panelType,
}: DeviceMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const router = useRouter();

  // Real-time devices from 'devices' collection
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  // Real-time open fault reports: deviceId -> { faultType, reportId }
  const [openFaultMap, setOpenFaultMap] = useState<Record<string, { faultType: 'teknik_servis' | 'aplikasyon'; reportId: string }>>({});
  // Maintenance plans
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  // Maintenance logs
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  // Selected hospital for device list popup
  const [selectedHospital, setSelectedHospital] = useState<SelectedHospital | null>(null);

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
        const map: Record<string, { faultType: 'teknik_servis' | 'aplikasyon'; reportId: string }> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.deviceId && data.faultType) {
            if (panelType === 'teknik_servis') {
              if (map[data.deviceId]?.faultType === 'teknik_servis') return;
            } else {
              if (map[data.deviceId]?.faultType === 'aplikasyon') return;
            }
            map[data.deviceId] = { faultType: data.faultType, reportId: d.id };
          }
        });
        setOpenFaultMap(map);
      }
    );
    return () => unsub();
  }, [panelType]);

  // Listen to maintenance plans for this panel type
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'maintenancePlans'),
        where('type', '==', panelType)
      ),
      (snap) => {
        setMaintenancePlans(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MaintenancePlan));
      }
    );
    return () => unsub();
  }, [panelType]);

  // Listen to maintenance logs
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'maintenanceLogs'),
      (snap) => {
        setMaintenanceLogs(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            completedAt: data.completedAt?.toDate?.() || data.completedAt,
            nextDueDate: data.nextDueDate?.toDate?.() || data.nextDueDate,
          } as MaintenanceLog;
        }));
      }
    );
    return () => unsub();
  }, []);

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

  // Build set of device IDs with approaching maintenance
  const maintenanceSoonDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    const now = new Date();

    maintenancePlans.forEach((plan) => {
      const latestLog = maintenanceLogs
        .filter((l) => l.planId === plan.id)
        .sort((a, b) => {
          const aTime = a.completedAt instanceof Date ? a.completedAt.getTime() : 0;
          const bTime = b.completedAt instanceof Date ? b.completedAt.getTime() : 0;
          return bTime - aTime;
        })[0];

      let nextDueDate: Date | null = null;

      if (latestLog && latestLog.nextDueDate) {
        nextDueDate = latestLog.nextDueDate instanceof Date
          ? latestLog.nextDueDate
          : new Date(latestLog.nextDueDate as any);
      } else {
        ids.add(plan.deviceId);
        return;
      }

      if (nextDueDate) {
        const diffMs = nextDueDate.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays <= MAINTENANCE_WARNING_DAYS) {
          ids.add(plan.deviceId);
        }
      }
    });

    return ids;
  }, [maintenancePlans, maintenanceLogs]);

  // Determine effective fault status for a device
  const getDeviceFaultType = (device: Device): string | null => {
    const fromReports = openFaultMap[device.id]?.faultType;
    const fromDevice = device.arizaDurumu && device.arizaDurumu !== 'yok' ? device.arizaDurumu : null;
    return fromReports || fromDevice || null;
  };

  // Determine device category: 'faulty' | 'maintenance' | 'healthy'
  const getDeviceCategory = (device: Device): 'faulty' | 'maintenance' | 'healthy' => {
    const faultType = getDeviceFaultType(device);
    if (faultType) return 'faulty';
    if (maintenanceSoonDeviceIds.has(device.id)) return 'maintenance';
    return 'healthy';
  };

  // Stats
  const stats = useMemo(() => {
    let healthy = 0;
    let faulty = 0;
    let maintenanceSoon = 0;
    let total = 0;

    hospitalMap.forEach((_, hospitalId) => {
      const devices = devicesByHospital.get(hospitalId) || [];
      devices.forEach((device) => {
        total++;
        const category = getDeviceCategory(device);
        if (category === 'faulty') faulty++;
        else if (category === 'maintenance') maintenanceSoon++;
        else healthy++;
      });
    });

    return { healthy, faulty, maintenanceSoon, total };
  }, [hospitalMap, devicesByHospital, openFaultMap, maintenanceSoonDeviceIds, panelType]);

  // Build hospital summaries for markers
  const hospitalSummaries = useMemo(() => {
    const summaries: HospitalSummary[] = [];
    hospitalMap.forEach((hospital, hospitalId) => {
      const devices = devicesByHospital.get(hospitalId) || [];
      let healthy = 0;
      let faulty = 0;
      let maintenanceSoon = 0;

      devices.forEach((device) => {
        const category = getDeviceCategory(device);
        if (category === 'faulty') faulty++;
        else if (category === 'maintenance') maintenanceSoon++;
        else healthy++;
      });

      summaries.push({ hospital, healthy, faulty, maintenanceSoon, total: devices.length });
    });
    return summaries;
  }, [hospitalMap, devicesByHospital, openFaultMap, maintenanceSoonDeviceIds, panelType]);

  // Handle hospital marker click -> show device list
  const handleHospitalClick = useCallback((hospitalId: string) => {
    const hospital = hospitalMap.get(hospitalId);
    if (!hospital) return;

    const devices = devicesByHospital.get(hospitalId) || [];
    const deviceItems: DeviceListItem[] = devices.map((device) => ({
      id: device.id,
      name: device.cihazAdi || device.model || 'Cihaz',
      serial: device.seriNumarasi || '',
      category: getDeviceCategory(device),
      faultReportId: openFaultMap[device.id]?.reportId,
    }));

    // Sort: faulty first, then maintenance, then healthy
    const order = { faulty: 0, maintenance: 1, healthy: 2 };
    deviceItems.sort((a, b) => order[a.category] - order[b.category]);

    setSelectedHospital({
      hospitalId,
      hospitalName: hospital.name || hospital.ad || 'Laboratuvar',
      devices: deviceItems,
    });
  }, [hospitalMap, devicesByHospital, openFaultMap, maintenanceSoonDeviceIds]);

  // Handle device click -> navigate
  const handleDeviceClick = useCallback((device: DeviceListItem) => {
    if (device.category === 'faulty' && device.faultReportId) {
      router.push(`/ariza-yonetimi/${device.faultReportId}`);
    } else {
      const basePath = panelType === 'teknik_servis'
        ? '/teknik-servis/islem-formu'
        : '/aplikasyon-paneli/islem-formu';
      router.push(`${basePath}/${device.id}`);
    }
  }, [panelType, router]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: TURKEY_CENTER,
      zoom: 6,
      maxBounds: TURKEY_BOUNDS.pad(0.5),
      maxBoundsViscosity: 0.8,
      minZoom: 5,
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

  // Store handleHospitalClick in ref so Leaflet event handlers can access latest version
  const handleHospitalClickRef = useRef(handleHospitalClick);
  handleHospitalClickRef.current = handleHospitalClick;

  // Update markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const bounds = L.latLngBounds([]);

    hospitalSummaries.forEach((summary) => {
      const { hospital } = summary;
      const lat = hospital.lat!;
      const lng = hospital.lng!;
      const pos: [number, number] = [lat, lng];
      bounds.extend(pos);

      if (summary.total === 0) return;

      const icon = createSummaryIcon(summary);
      const marker = L.marker(pos, { icon, zIndexOffset: 1000 });

      const tooltipParts = [
        `<div style="font-weight:600;font-size:13px;margin-bottom:4px">${hospital.name || hospital.ad || 'Laboratuvar'}</div>`,
        `<div style="font-size:11px;color:#666;margin-bottom:2px">Toplam ${summary.total} cihaz</div>`,
      ];
      if (summary.healthy > 0) {
        tooltipParts.push(`<div style="font-size:11px;color:#22c55e;font-weight:500">● ${summary.healthy} Sağlıklı</div>`);
      }
      if (summary.faulty > 0) {
        tooltipParts.push(`<div style="font-size:11px;color:#ef4444;font-weight:500">● ${summary.faulty} Arızalı</div>`);
      }
      if (summary.maintenanceSoon > 0) {
        tooltipParts.push(`<div style="font-size:11px;color:#f59e0b;font-weight:500">⚠ ${summary.maintenanceSoon} Bakımı Yaklaşan</div>`);
      }

      marker.bindTooltip(
        tooltipParts.join(''),
        { direction: 'top', offset: L.point(0, -4), className: 'device-map-tooltip' }
      );

      marker.on('click', () => {
        handleHospitalClickRef.current(hospital.id);
      });

      marker.addTo(layerGroup);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15));
    }
  }, [hospitalSummaries]);

  const panelLabel = panelType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';

  // Group selected hospital devices by category
  const groupedDevices = useMemo(() => {
    if (!selectedHospital) return null;
    const faulty = selectedHospital.devices.filter((d) => d.category === 'faulty');
    const maintenance = selectedHospital.devices.filter((d) => d.category === 'maintenance');
    const healthy = selectedHospital.devices.filter((d) => d.category === 'healthy');
    return { faulty, maintenance, healthy };
  }, [selectedHospital]);

  return (
    <div className="device-map-shell">
      {/* Header */}
      <div className="device-map-header">
        <div>
          <h1 className="device-map-title">{panelLabel} Harita Paneli</h1>
          <p className="device-map-subtitle">Cihaz durumları · Tüm bölgeler</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="device-map-stats">
        <div className="device-map-stat">
          <span className="device-map-stat-dot" style={{ background: '#22c55e' }} />
          <span className="device-map-stat-label">Sağlıklı</span>
          <span className="device-map-stat-value">{stats.healthy}</span>
        </div>
        <div className="device-map-stat">
          <span className="device-map-stat-dot" style={{ background: '#ef4444' }} />
          <span className="device-map-stat-label">Arızalı</span>
          <span className="device-map-stat-value">{stats.faulty}</span>
        </div>
        <div className="device-map-stat">
          <span className="device-map-stat-dot device-map-stat-dot-warning" style={{ background: '#f59e0b' }} />
          <span className="device-map-stat-label">Bakımı Yaklaşan</span>
          <span className="device-map-stat-value">{stats.maintenanceSoon}</span>
        </div>
        <div className="device-map-stat device-map-stat-total">
          <span className="device-map-stat-label">Toplam</span>
          <span className="device-map-stat-value">{stats.total}</span>
        </div>
      </div>

      {/* Map container */}
      <div className="device-map-container">
        <div ref={containerRef} className="device-map-leaflet" />

        {/* Device list popup overlay */}
        {selectedHospital && groupedDevices && (
          <div className="device-map-popup-overlay" onClick={() => setSelectedHospital(null)}>
            <div className="device-map-popup" onClick={(e) => e.stopPropagation()}>
              {/* Popup header */}
              <div className="device-map-popup-header">
                <div>
                  <h2 className="device-map-popup-title">{selectedHospital.hospitalName}</h2>
                  <p className="device-map-popup-subtitle">{selectedHospital.devices.length} cihaz</p>
                </div>
                <button
                  className="device-map-popup-close"
                  onClick={() => setSelectedHospital(null)}
                  aria-label="Kapat"
                >
                  ✕
                </button>
              </div>

              {/* Device list */}
              <div className="device-map-popup-body">
                {/* Faulty devices */}
                {groupedDevices.faulty.length > 0 && (
                  <div className="device-map-popup-section">
                    <div className="device-map-popup-section-header device-map-popup-section-faulty">
                      <span className="device-map-popup-section-dot" style={{ background: '#ef4444' }} />
                      Arızalı Cihazlar ({groupedDevices.faulty.length})
                    </div>
                    {groupedDevices.faulty.map((device) => (
                      <button
                        key={device.id}
                        className="device-map-popup-device device-map-popup-device-faulty"
                        onClick={() => handleDeviceClick(device)}
                      >
                        <div className="device-map-popup-device-info">
                          <span className="device-map-popup-device-name">{device.name}</span>
                          {device.serial && (
                            <span className="device-map-popup-device-serial">{device.serial}</span>
                          )}
                        </div>
                        <span className="device-map-popup-device-arrow">→</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Maintenance approaching devices */}
                {groupedDevices.maintenance.length > 0 && (
                  <div className="device-map-popup-section">
                    <div className="device-map-popup-section-header device-map-popup-section-maintenance">
                      <span className="device-map-popup-section-dot" style={{ background: '#f59e0b' }} />
                      Bakımı Yaklaşan Cihazlar ({groupedDevices.maintenance.length})
                    </div>
                    {groupedDevices.maintenance.map((device) => (
                      <button
                        key={device.id}
                        className="device-map-popup-device device-map-popup-device-maintenance"
                        onClick={() => handleDeviceClick(device)}
                      >
                        <div className="device-map-popup-device-info">
                          <span className="device-map-popup-device-name">{device.name}</span>
                          {device.serial && (
                            <span className="device-map-popup-device-serial">{device.serial}</span>
                          )}
                        </div>
                        <span className="device-map-popup-device-arrow">→</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Healthy devices */}
                {groupedDevices.healthy.length > 0 && (
                  <div className="device-map-popup-section">
                    <div className="device-map-popup-section-header device-map-popup-section-healthy">
                      <span className="device-map-popup-section-dot" style={{ background: '#22c55e' }} />
                      Sağlıklı Cihazlar ({groupedDevices.healthy.length})
                    </div>
                    {groupedDevices.healthy.map((device) => (
                      <button
                        key={device.id}
                        className="device-map-popup-device device-map-popup-device-healthy"
                        onClick={() => handleDeviceClick(device)}
                      >
                        <div className="device-map-popup-device-info">
                          <span className="device-map-popup-device-name">{device.name}</span>
                          {device.serial && (
                            <span className="device-map-popup-device-serial">{device.serial}</span>
                          )}
                        </div>
                        <span className="device-map-popup-device-arrow">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
