'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Haversine formula ile iki koordinat arasındaki mesafeyi metre cinsinden hesapla
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Dünya yarıçapı (metre)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface GeofenceStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  order: number;
  hasArrived?: boolean;
  hasDeparted?: boolean;
}

export interface GeofencingConfig {
  /** Varış olarak kabul edilecek mesafe eşiği (metre) */
  arrivalThreshold?: number;
  /** Ayrılma olarak kabul edilecek mesafe eşiği (metre) */
  departureThreshold?: number;
  /** Kabul edilebilir maksimum GPS doğruluk hatası (metre) */
  maxAccuracy?: number;
  /** Konum güncellemesi arasındaki minimum süre (ms) */
  minUpdateInterval?: number;
  /** Otomatik işlem aktif mi? */
  enabled?: boolean;
}

export interface GeofencingState {
  /** Konum takibi aktif mi? */
  isTracking: boolean;
  /** Konum izni durumu */
  permissionStatus: 'prompt' | 'granted' | 'denied' | 'unavailable' | 'checking';
  /** Son bilinen kullanıcı konumu */
  userLocation: { lat: number; lng: number; accuracy: number } | null;
  /** Mevcut hedef durak */
  targetStop: GeofenceStop | null;
  /** Hedef durağa olan mesafe (metre) */
  distanceToTarget: number | null;
  /** Hedefe yaklaşıldı mı? (200m içinde) */
  isApproaching: boolean;
  /** Menzilde mi? (100m içinde) */
  isInRange: boolean;
  /** Otomatik varış tetiklendi mi? */
  autoArrivalTriggered: boolean;
  /** Otomatik ayrılma tetiklendi mi? */
  autoDepartureTriggered: boolean;
  /** Son hata mesajı */
  error: string | null;
  /** Arka plan modu aktif mi? */
  isBackgroundMode: boolean;
  /** İnternet bağlantısı var mı? */
  isOnline: boolean;
  /** Bekleyen işlem sayısı (offline iken biriken) */
  pendingActionsCount: number;
}

export interface GeofencingCallbacks {
  onAutoArrival?: (stop: GeofenceStop) => void;
  onAutoDeparture?: (stop: GeofenceStop) => void;
  onLocationUpdate?: (lat: number, lng: number, accuracy: number) => void;
  onError?: (error: string) => void;
}

const DEFAULT_CONFIG: Required<GeofencingConfig> = {
  arrivalThreshold: 100, // 100 metre yaklaşınca varış (geofence alanına giriş)
  departureThreshold: 100, // 100 metre uzaklaşınca ayrılma (geofence alanından çıkış)
  maxAccuracy: 100, // 100 metreden fazla hata payı varsa işlem yapma
  minUpdateInterval: 3000, // En az 3 saniyede bir güncelle
  enabled: true,
};

/** Yaklaşma uyarı eşiği - bu mesafede "Hedefe yaklaşıldı" gösterilir */
const APPROACHING_THRESHOLD = 200; // 200 metre

export function useGeofencing(
  stops: GeofenceStop[],
  currentStopIndex: number,
  isAtStop: boolean, // Şu an bir durakta mı (varış yapılmış ama ayrılma yapılmamış)
  config: GeofencingConfig = {},
  callbacks: GeofencingCallbacks = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [state, setState] = useState<GeofencingState>({
    isTracking: false,
    permissionStatus: 'checking',
    userLocation: null,
    targetStop: null,
    distanceToTarget: null,
    isApproaching: false,
    isInRange: false,
    autoArrivalTriggered: false,
    autoDepartureTriggered: false,
    error: null,
    isBackgroundMode: false,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingActionsCount: 0,
  });

  // ============================================
  // STALE CLOSURE FIX: useRef ile güncel değerleri tut
  // watchPosition callback'i başlangıçta yakalandığı için,
  // değerler değiştiğinde eski closure'daki değerler kullanılıyordu.
  // useRef ile her zaman güncel değerlere erişiyoruz.
  // ============================================

  const callbacksRef = useRef(callbacks);
  const configRef = useRef(mergedConfig);
  const isAtStopRef = useRef(isAtStop);
  const stopsRef = useRef(stops);
  const currentStopIndexRef = useRef(currentStopIndex);

  // Ref'leri her render'da güncelle
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    configRef.current = mergedConfig;
  }, [mergedConfig]);

  useEffect(() => {
    isAtStopRef.current = isAtStop;
  }, [isAtStop]);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    currentStopIndexRef.current = currentStopIndex;
  }, [currentStopIndex]);

  const watchIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoArrivalCooldownRef = useRef<boolean>(false);
  const autoDepartureCooldownRef = useRef<boolean>(false);

  // Şoför mevcut durağa hiç yaklaştı mı? (otomatik çıkış için gerekli)
  const wasInRangeRef = useRef<boolean>(false);

  // Hedef durağı belirle (render sırasında)
  const targetStop = stops[currentStopIndex] || null;

  // Hedef değiştiğinde mesafeyi yeniden hesapla (son bilinen konumla)
  useEffect(() => {
    if (!targetStop || !state.userLocation) return;

    const distance = calculateDistance(
      state.userLocation.lat,
      state.userLocation.lng,
      targetStop.lat,
      targetStop.lng
    );

    const isApproaching = distance <= APPROACHING_THRESHOLD;
    const isInRange = distance <= mergedConfig.arrivalThreshold;

    setState(s => ({
      ...s,
      targetStop,
      distanceToTarget: Math.round(distance),
      isApproaching,
      isInRange,
    }));
  }, [targetStop?.id, state.userLocation?.lat, state.userLocation?.lng, mergedConfig.arrivalThreshold]);

  // Wake Lock API ile ekranı açık tut
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current?.addEventListener('release', () => {
          setState(s => ({ ...s, isBackgroundMode: true }));
        });
      } catch {
        // Wake lock desteklenmiyor veya izin verilmedi
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Konum izni kontrolü
  const checkPermission = useCallback(async () => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, permissionStatus: 'unavailable' }));
      return 'unavailable';
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      const status = result.state as 'prompt' | 'granted' | 'denied';
      setState(s => ({ ...s, permissionStatus: status }));

      result.addEventListener('change', () => {
        setState(s => ({ ...s, permissionStatus: result.state as any }));
      });

      return status;
    } catch {
      return 'prompt';
    }
  }, []);

  // ============================================
  // CORE FIX: Konum güncellemesi işleyicisi
  // Bu fonksiyon watchPosition'a bir kez veriliyor.
  // İçinde useRef kullanarak her zaman güncel değerlere erişiyoruz.
  // ============================================
  const handlePositionUpdate = useCallback((position: GeolocationPosition) => {
    const now = Date.now();
    const currentConfig = configRef.current;

    if (now - lastUpdateRef.current < currentConfig.minUpdateInterval) return;
    lastUpdateRef.current = now;

    const { latitude: lat, longitude: lng, accuracy } = position.coords;

    // Doğruluk çok kötüyse işlemi atla
    if (accuracy > currentConfig.maxAccuracy) {
      setState(s => ({
        ...s,
        userLocation: { lat, lng, accuracy },
        error: `GPS doğruluğu yetersiz (${Math.round(accuracy)}m)`,
      }));
      return;
    }

    // Callback çağır (güncel ref'ten)
    callbacksRef.current.onLocationUpdate?.(lat, lng, accuracy);

    // Güncel hedef durağı al
    const currentTargetStop = stopsRef.current[currentStopIndexRef.current] || null;

    // Hedef durak yoksa sadece konumu güncelle
    if (!currentTargetStop) {
      setState(s => ({
        ...s,
        userLocation: { lat, lng, accuracy },
        distanceToTarget: null,
        error: null,
      }));
      return;
    }

    // Hedef durağa mesafeyi hesapla
    const distance = calculateDistance(lat, lng, currentTargetStop.lat, currentTargetStop.lng);

    // Yaklaşma ve menzil durumlarını hesapla
    const isApproaching = distance <= APPROACHING_THRESHOLD;
    const isInRange = distance <= currentConfig.arrivalThreshold;

    setState(s => ({
      ...s,
      userLocation: { lat, lng, accuracy },
      targetStop: currentTargetStop,
      distanceToTarget: Math.round(distance),
      isApproaching,
      isInRange,
      error: null,
      isBackgroundMode: false,
    }));

    // Menzile girdiyse flag'i işaretle (otomatik çıkış için gerekli)
    if (isInRange) {
      wasInRangeRef.current = true;
    }

    // Güncel isAtStop değerini al
    const currentIsAtStop = isAtStopRef.current;

    // ============================================
    // OTOMATİK VARIŞ KONTROLÜ
    // ============================================
    if (
      currentConfig.enabled &&
      !currentIsAtStop &&
      !autoArrivalCooldownRef.current &&
      distance <= currentConfig.arrivalThreshold
    ) {
      console.log('[Geofencing] 🎯 Otomatik varış tetikleniyor!', {
        stopName: currentTargetStop.name,
        distance: Math.round(distance),
        threshold: currentConfig.arrivalThreshold,
        isAtStop: currentIsAtStop,
      });

      autoArrivalCooldownRef.current = true;
      wasInRangeRef.current = true;
      setState(s => ({ ...s, autoArrivalTriggered: true }));

      // GÜNCEL callback'i çağır
      callbacksRef.current.onAutoArrival?.(currentTargetStop);

      // 10 saniye cooldown
      setTimeout(() => {
        autoArrivalCooldownRef.current = false;
        setState(s => ({ ...s, autoArrivalTriggered: false }));
      }, 10000);
    }

    // ============================================
    // OTOMATİK ÇIKIŞ KONTROLÜ
    // ============================================
    if (
      currentConfig.enabled &&
      currentIsAtStop &&
      wasInRangeRef.current &&
      !autoDepartureCooldownRef.current &&
      distance > currentConfig.departureThreshold
    ) {
      console.log('[Geofencing] 🚗 Otomatik çıkış tetikleniyor!', {
        stopName: currentTargetStop.name,
        distance: Math.round(distance),
        threshold: currentConfig.departureThreshold,
        isAtStop: currentIsAtStop,
        wasInRange: wasInRangeRef.current,
      });

      autoDepartureCooldownRef.current = true;
      setState(s => ({ ...s, autoDepartureTriggered: true }));

      // GÜNCEL callback'i çağır
      callbacksRef.current.onAutoDeparture?.(currentTargetStop);

      // 10 saniye cooldown
      setTimeout(() => {
        autoDepartureCooldownRef.current = false;
        setState(s => ({ ...s, autoDepartureTriggered: false }));
      }, 10000);
    }
  }, []); // BOŞ dependency - ref'ler kullanıldığı için yeniden oluşturulmaya gerek yok

  // Konum hatası işleyicisi
  const handlePositionError = useCallback((error: GeolocationPositionError) => {
    let errorMsg = 'Konum alınamadı';
    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMsg = 'Konum izni reddedildi';
        setState(s => ({ ...s, permissionStatus: 'denied' }));
        break;
      case error.POSITION_UNAVAILABLE:
        errorMsg = 'Konum bilgisi mevcut değil';
        break;
      case error.TIMEOUT:
        errorMsg = 'Konum isteği zaman aşımına uğradı';
        break;
    }
    setState(s => ({ ...s, error: errorMsg }));
    callbacksRef.current.onError?.(errorMsg);
  }, []);

  // Konum takibini başlat
  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, permissionStatus: 'unavailable', error: 'Geolocation desteklenmiyor' }));
      return false;
    }

    // Önce mevcut izlemeyi durdur
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    try {
      await requestWakeLock();

      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePositionUpdate,
        handlePositionError,
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );

      setState(s => ({
        ...s,
        isTracking: true,
        permissionStatus: 'granted',
        error: null,
      }));

      console.log('[Geofencing] ✅ Konum takibi başlatıldı');
      return true;
    } catch (err) {
      setState(s => ({ ...s, error: 'Konum takibi başlatılamadı' }));
      return false;
    }
  }, [handlePositionUpdate, handlePositionError, requestWakeLock]);

  // Konum takibini durdur
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    setState(s => ({
      ...s,
      isTracking: false,
      autoArrivalTriggered: false,
      autoDepartureTriggered: false,
    }));
    console.log('[Geofencing] ⏹️ Konum takibi durduruldu');
  }, [releaseWakeLock]);

  // Sayfa görünürlüğü değiştiğinde
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && state.isTracking) {
        requestWakeLock();
        setState(s => ({ ...s, isBackgroundMode: false }));
      } else if (document.visibilityState === 'hidden') {
        setState(s => ({ ...s, isBackgroundMode: true }));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [state.isTracking, requestWakeLock]);

  // Component unmount olduğunda temizle
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  // İzin durumunu başlangıçta kontrol et
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // currentStopIndex değiştiğinde cooldown'ları ve wasInRange flag'ini sıfırla
  useEffect(() => {
    console.log('[Geofencing] 🔄 Stop index değişti:', currentStopIndex);
    autoArrivalCooldownRef.current = false;
    autoDepartureCooldownRef.current = false;
    wasInRangeRef.current = false;
  }, [currentStopIndex]);

  // İnternet bağlantısı durumunu takip et
  useEffect(() => {
    const handleOnline = () => {
      setState(s => ({ ...s, isOnline: true, error: null }));
    };
    const handleOffline = () => {
      setState(s => ({ ...s, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    ...state,
    startTracking,
    stopTracking,
    checkPermission,
    config: mergedConfig,
  };
}
