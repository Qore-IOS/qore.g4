import test from 'node:test';
import assert from 'node:assert/strict';
import { getAffectedDeviceIds, getFaultyDeviceIds, isActiveDeviceFaultStatus } from '../../src/lib/device-faults';

test('yalnızca gerçekten açık arıza durumlarını aktif kabul eder', () => {
  assert.equal(isActiveDeviceFaultStatus('atama_bekliyor'), true);
  assert.equal(isActiveDeviceFaultStatus('mudahale_bekliyor'), true);
  assert.equal(isActiveDeviceFaultStatus('mudahale_ediliyor'), true);
  assert.equal(isActiveDeviceFaultStatus('open'), true);
  assert.equal(isActiveDeviceFaultStatus('cozuldu'), false);
  assert.equal(isActiveDeviceFaultStatus('closed'), false);
});

test('tek cihaz arızasında yalnızca cihaz kimliğini döndürür', () => {
  assert.deepEqual(getAffectedDeviceIds({
    deviceId: 'device-1',
    affectsAllDevices: false,
  }), ['device-1']);
});

test('tüm laboratuvarı etkileyen arızalarda etkilenen cihazları benzersiz sayar', () => {
  assert.deepEqual(getAffectedDeviceIds({
    deviceId: 'source-device',
    affectsAllDevices: true,
    affectedDeviceIds: ['device-1', 'device-2', 'device-1', ''],
  }), ['device-1', 'device-2']);
});

test('teknik servis ve aplikasyon arızalarını aynı cihaz sağlık sayımına dahil eder', () => {
  assert.deepEqual([...getFaultyDeviceIds([
    { deviceId: 'teknik-device' },
    { deviceId: 'aplikasyon-device' },
    {
      deviceId: 'lab-fault-source',
      affectsAllDevices: true,
      affectedDeviceIds: ['lab-device-1', 'lab-device-2'],
    },
  ])], ['teknik-device', 'aplikasyon-device', 'lab-device-1', 'lab-device-2']);
});
