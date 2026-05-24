/**
 * Firestore Security Rules unit tests.
 *
 * Uses @firebase/rules-unit-testing with the Firestore emulator.
 *
 * Prerequisites:
 *   1. pnpm add -D @firebase/rules-unit-testing firebase-admin
 *   2. firebase emulators:exec --only firestore "pnpm test:rules"
 *   (or run the emulator manually with `firebase emulators:start --only firestore`
 *    and then `pnpm test:rules` in a second terminal)
 *
 * Coverage:
 *   - Tenant isolation (Company A user cannot read/write Company B docs)
 *   - SuperAdmin can read/write across tenants
 *   - Unauthenticated requests are denied
 *   - Users can read their own profile + same-company profiles
 *   - Loose-tier collections still allow signed-in access
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setDoc, doc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'qore-multitenancy-test';
const RULES_PATH = path.resolve(__dirname, '..', 'firestore.rules');

let testEnv: RulesTestEnvironment;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf-8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] ?? '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080),
    },
  });
});

test.after(async () => {
  await testEnv?.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed: one device in companyA, one in companyB.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'devices', 'devA1'), { name: 'A-device', companyId: 'companyA' });
    await setDoc(doc(db, 'devices', 'devB1'), { name: 'B-device', companyId: 'companyB' });
    await setDoc(doc(db, 'users', 'userA'), { name: 'A-user', role: 'user', companyId: 'companyA' });
    await setDoc(doc(db, 'users', 'userB'), { name: 'B-user', role: 'user', companyId: 'companyB' });
  });
});

function authedAsCompanyA() {
  return testEnv
    .authenticatedContext('userA', { companyId: 'companyA', isSuperAdmin: false })
    .firestore();
}
function authedAsCompanyB() {
  return testEnv
    .authenticatedContext('userB', { companyId: 'companyB', isSuperAdmin: false })
    .firestore();
}
function authedAsSuperAdmin() {
  return testEnv
    .authenticatedContext('superAdmin', { companyId: 'companyA', isSuperAdmin: true })
    .firestore();
}
function unauthed() {
  return testEnv.unauthenticatedContext().firestore();
}

// ============================================================================
// Tenant isolation
// ============================================================================

test('Company A user can read own device', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'devices', 'devA1')));
});

test('Company A user cannot read Company B device', async () => {
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'devices', 'devB1')));
});

test('Company A user cannot write a device with companyId=companyB', async () => {
  const db = authedAsCompanyA();
  await assertFails(
    setDoc(doc(db, 'devices', 'devNew'), { name: 'New', companyId: 'companyB' }),
  );
});

test('Company A user can write a device with companyId=companyA', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(
    setDoc(doc(db, 'devices', 'devNew'), { name: 'New', companyId: 'companyA' }),
  );
});

// ============================================================================
// SuperAdmin bypass
// ============================================================================

test('SuperAdmin can read any tenant device', async () => {
  const db = authedAsSuperAdmin();
  await assertSucceeds(getDoc(doc(db, 'devices', 'devA1')));
  await assertSucceeds(getDoc(doc(db, 'devices', 'devB1')));
});

test('SuperAdmin can write a device in any company', async () => {
  const db = authedAsSuperAdmin();
  await assertSucceeds(
    setDoc(doc(db, 'devices', 'devSuper'), { name: 'super', companyId: 'companyB' }),
  );
});

// ============================================================================
// Unauthenticated
// ============================================================================

test('Unauthenticated cannot read devices', async () => {
  const db = unauthed();
  await assertFails(getDoc(doc(db, 'devices', 'devA1')));
});

test('Unauthenticated cannot write devices', async () => {
  const db = unauthed();
  await assertFails(
    setDoc(doc(db, 'devices', 'devAnon'), { name: 'anon', companyId: 'companyA' }),
  );
});

// ============================================================================
// /users/{uid} special rules
// ============================================================================

test('User can read own profile', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'users', 'userA')));
});

test('User can read same-company users', async () => {
  // Seed another user in companyA
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'userA2'), {
      name: 'A2', role: 'user', companyId: 'companyA',
    });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'users', 'userA2')));
});

test('User cannot read cross-tenant user profile', async () => {
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'users', 'userB')));
});

test('User cannot write another users profile', async () => {
  const db = authedAsCompanyA();
  await assertFails(
    setDoc(doc(db, 'users', 'userB'), { name: 'hacked', companyId: 'companyB' }),
  );
});

// ============================================================================
// Loose tier (still requires auth, no tenant filter yet)
// ============================================================================

test('Loose-tier collection (vehicles) allows signed-in read', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'vehicles', 'v1'), { plate: 'XYZ' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'vehicles', 'v1')));
});

test('Loose-tier collection denies unauthenticated', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'vehicles', 'v1'), { plate: 'XYZ' });
  });
  const db = unauthed();
  await assertFails(getDoc(doc(db, 'vehicles', 'v1')));
});

// ============================================================================
// Unknown collection (default deny)
// ============================================================================

test('Unknown collection denies all access (default-deny)', async () => {
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'someUnknownCollection', 'x')));
  await assertFails(setDoc(doc(db, 'someUnknownCollection', 'x'), { foo: 'bar' }));
});
