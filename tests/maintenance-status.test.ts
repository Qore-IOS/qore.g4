import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeviceMaintenanceStatus } from '../src/lib/maintenance';
import type { MaintenanceLog, MaintenancePlan } from '../src/lib/types';

const basePlan: MaintenancePlan = {
  id: 'plan-1',
  deviceId: 'device-1',
  taskName: 'Pinch Tube Değişimi',
  periodValue: 60,
  periodUnit: 'hafta',
  type: 'teknik_servis',
};

test('plansız cihazları plansız olarak işaretler', () => {
  const result = calculateDeviceMaintenanceStatus([], [], new Date('2026-08-05T00:00:00Z'));
  assert.equal(result.status, 'plansiz');
  assert.equal(result.planStatuses.length, 0);
});

test('hiç bakım logu olmayan planlı cihazları bakım yok olarak işaretler', () => {
  const result = calculateDeviceMaintenanceStatus([basePlan], [], new Date('2026-08-05T00:00:00Z'));
  assert.equal(result.status, 'bakim_yok');
  assert.equal(result.worstPlan?.daysRemaining, null);
});

test('vadesi geçen bakım planını kritik olarak işaretler', () => {
  const plan: MaintenancePlan = { ...basePlan, periodValue: 1, periodUnit: 'hafta' };
  const log: MaintenanceLog = {
    id: 'log-1',
    deviceId: 'device-1',
    planId: 'plan-1',
    taskName: 'Pinch Tube Değişimi',
    completedAt: new Date('2026-07-01T00:00:00Z'),
    completedByUid: 'u1',
    completedByName: 'Teknisyen',
    nextDueDate: new Date('2026-07-08T00:00:00Z'),
  };
  const result = calculateDeviceMaintenanceStatus([plan], [log], new Date('2026-08-05T00:00:00Z'));
  assert.equal(result.status, 'kritik');
});
