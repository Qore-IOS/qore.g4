import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecoverableLabTransfer } from '../../src/lib/urun-kullanim/transfer-recovery';

test('recovers a lab transfer even when a newer depot intake exists for the same serial', () => {
  const transfer = { type: 'transfer', details: { stokKodu: '08324174190', targetHospitalId: 'lab-1' } };
  const result = findRecoverableLabTransfer([
    { type: 'intake', details: { stokKodu: '08324174190', depotId: 'depot-1' } },
    transfer,
  ], '08324174190', ['lab-1']);

  assert.equal(result, transfer);
});

test('does not recover a transfer already consumed from the selected lab pool', () => {
  const result = findRecoverableLabTransfer([
    { type: 'consumption', details: { stokKodu: '08324174190', deductedFromLabId: 'lab-1' } },
    { type: 'transfer', details: { stokKodu: '08324174190', targetHospitalId: 'lab-1' } },
  ], '08324174190', ['lab-1']);

  assert.equal(result, null);
});

test('does not recover a transfer belonging to another lab', () => {
  const result = findRecoverableLabTransfer([
    { type: 'transfer', details: { stokKodu: '08324174190', targetHospitalId: 'lab-2' } },
  ], '08324174190', ['lab-1']);

  assert.equal(result, null);
});
