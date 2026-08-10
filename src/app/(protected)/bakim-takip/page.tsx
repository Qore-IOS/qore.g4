'use client';

import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Device, DeviceLabPool, Hospital, MaintenanceDefinition, MaintenanceLog, MaintenancePlan } from '@/lib/types';
import BakimTakipPanel from '@/components/bakim-takip-panel';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useDeviceLabPools, useDevicesForLabs, useHospitals, useMaintenanceDefinitions, useMaintenanceLogs, useMaintenancePlans } from '@/hooks/useFirebaseQueries';
import { HospitalGridPanelSkeleton } from '@/components/perf/PanelSkeletons';

export default function BakimTakipPage() {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdminRole = ['admin', 'admin_developer', 'super_admin'].includes(currentUserProfile?.role || '');
  const assignedLabIds = currentUserProfile?.assignedLaboratories ?? [];
  const labScope = isAdminRole || assignedLabIds.length === 0 ? null : assignedLabIds;

  const hospitalsQuery = useHospitals();
  const devicesQuery = useDevicesForLabs(labScope);
  const maintenancePlansQuery = useMaintenancePlans();
  const maintenanceLogsQuery = useMaintenanceLogs();
  const maintenanceDefinitionsQuery = useMaintenanceDefinitions();
  const deviceLabPoolsQuery = useDeviceLabPools();

  const isLoading = hospitalsQuery.isLoading || devicesQuery.isLoading || maintenancePlansQuery.isLoading || maintenanceLogsQuery.isLoading || maintenanceDefinitionsQuery.isLoading || deviceLabPoolsQuery.isLoading;

  useEffect(() => {
    if (hospitalsQuery.isError || devicesQuery.isError || maintenancePlansQuery.isError || maintenanceLogsQuery.isError || maintenanceDefinitionsQuery.isError || deviceLabPoolsQuery.isError) {
      toast({ title: 'Veri Hatası', description: 'Bakım takip verileri yüklenemedi.', variant: 'destructive' });
    }
  }, [deviceLabPoolsQuery.isError, devicesQuery.isError, hospitalsQuery.isError, maintenanceDefinitionsQuery.isError, maintenanceLogsQuery.isError, maintenancePlansQuery.isError, toast]);

  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maintenanceLogs'] }),
      queryClient.invalidateQueries({ queryKey: ['maintenanceLogs', 'forDevice'] }),
      queryClient.invalidateQueries({ queryKey: ['maintenancePlans'] }),
      queryClient.invalidateQueries({ queryKey: ['maintenanceDefinitions'] }),
    ]);
  }, [queryClient]);

  if (isLoading) return <HospitalGridPanelSkeleton />;

  return (
    <BakimTakipPanel
      hospitals={(hospitalsQuery.data ?? []) as Hospital[]}
      devices={(devicesQuery.data ?? []) as Device[]}
      maintenancePlans={(maintenancePlansQuery.data ?? []) as MaintenancePlan[]}
      maintenanceLogs={(maintenanceLogsQuery.data ?? []) as MaintenanceLog[]}
      maintenanceDefinitions={(maintenanceDefinitionsQuery.data ?? []) as MaintenanceDefinition[]}
      deviceLabPools={(deviceLabPoolsQuery.data ?? []) as DeviceLabPool[]}
      onSaved={refresh}
    />
  );
}
