export const ACTIVE_DEVICE_FAULT_STATUSES = [
  'atama_bekliyor',
  'mudahale_bekliyor',
  'mudahale_ediliyor',
  'open',
] as const;

type ActiveDeviceFaultStatus = (typeof ACTIVE_DEVICE_FAULT_STATUSES)[number];
type DeviceFaultStatus = ActiveDeviceFaultStatus | 'cozuldu' | 'closed';

type DeviceFaultTarget = {
  deviceId?: string;
  affectsAllDevices?: boolean;
  affectedDeviceIds?: string[];
};

const activeDeviceFaultStatuses = new Set<string>(ACTIVE_DEVICE_FAULT_STATUSES);

export function isActiveDeviceFaultStatus(status: DeviceFaultStatus | null | undefined): boolean {
  return status != null && activeDeviceFaultStatuses.has(status);
}

export function getAffectedDeviceIds(fault: DeviceFaultTarget): string[] {
  const ids = fault.affectsAllDevices && Array.isArray(fault.affectedDeviceIds)
    ? fault.affectedDeviceIds
    : [fault.deviceId];

  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}
