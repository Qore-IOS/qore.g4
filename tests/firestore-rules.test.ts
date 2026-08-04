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

/**
 * Kural dosyasının yolu.
 *
 * Testler `.test-dist/tests/` altına derlenip oradan koşuyor; bu yüzden
 * `__dirname/../firestore.rules` `.test-dist/firestore.rules`'a çıkıyor ve
 * dosya bulunamıyordu — kural testlerinin TAMAMI `before` kancasında ENOENT
 * ile düşüyordu (yani hiç çalışmıyordu). Depo kökünden çözmek her iki
 * çalıştırma biçiminde de doğru sonucu verir.
 */
function resolveRulesPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'firestore.rules'),
    path.resolve(__dirname, '..', 'firestore.rules'),
    path.resolve(__dirname, '..', '..', 'firestore.rules'),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`firestore.rules bulunamadı. Denenen yollar: ${candidates.join(', ')}`);
  return found;
}

const RULES_PATH = resolveRulesPath();

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


test('Company A user can read shared definition data created by Company A', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'def_labGroups', 'labGroupA'), {
      name: 'Hematoloji',
      companyId: 'companyA',
    });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'def_labGroups', 'labGroupA')));
});

test('Company A user can read shared definition data created by Company B', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'def_labGroups', 'labGroupB'), {
      name: 'Biyokimya',
      companyId: 'companyB',
    });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'def_labGroups', 'labGroupB')));
});


test('Authenticated user can create a company-independent shared definition', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(
    setDoc(doc(db, 'def_brands', 'sharedBrand'), { name: 'Ortak Marka' }),
  );
});

test('Unauthenticated user cannot read shared definitions', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'def_brands', 'sharedBrand'), { name: 'Ortak Marka' });
  });
  await assertFails(getDoc(doc(unauthed(), 'def_brands', 'sharedBrand')));
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
// Tanımsız koleksiyon — Faz 7 geçici güvenlik ağı devredeyken
//
// DAVRANIŞ DEĞİŞİKLİĞİ (bilinçli): eskiden tanımsız bir koleksiyon her erişime
// kapalıydı. Bu, kuralı unutulan her koleksiyonun kullanıcıya hiçbir ipucu
// vermeden kilitlenmesi demekti — `serialHistory` tam olarak böyle sessizce
// reddediliyordu. Güvenlik ağı bu kilitlenmeyi kaldırır, KİRACI İZOLASYONUNU
// KORUYARAK: erişim yine oturum + `inCompany()` şartına bağlıdır.
//
// Güvenlik ağı Faz 2'de silinince bu test tekrar "reddedilir"e döner.
// ============================================================================

test('Tanımsız koleksiyon: kendi şirketinde erişilebilir (kilitlenme yok)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'someUnknownCollection', 'x'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'someUnknownCollection', 'x')));
  await assertSucceeds(setDoc(doc(db, 'someUnknownCollection', 'y'), { companyId: 'companyA' }));
});

test('Tanımsız koleksiyon: başka şirkete ve anonime kapalı', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'someUnknownCollection', 'b'), { companyId: 'companyB' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'someUnknownCollection', 'b')));
  await assertFails(getDoc(doc(unauthed(), 'someUnknownCollection', 'b')));
  await assertFails(setDoc(doc(unauthed(), 'someUnknownCollection', 'z'), { companyId: 'companyA' }));
});

// ============================================================================
// Seri No Defteri (serialLedger)
//
// Bu koleksiyonun kuralı YOKTU: `serialHistory` yazımları sessizce
// reddediliyordu, depo sayımının "sayımdan düşüldü" olayı hiç kaydedilemiyordu
// ve sayımla düşülen seriler kalıcı olarak yeniden mal kabul edilemez hâle
// geliyordu. Aşağıdaki testler kuralın hem var olduğunu hem de kiracı
// izolasyonunu koruduğunu doğrular.
// ============================================================================

test('serialLedger: kullanıcı kendi şirketinin defter satırını yazabilir', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(
    setDoc(doc(db, 'serialLedger', 'sl_companyA__KOD__SN1'), {
      companyId: 'companyA', stokKodu: 'KOD', seriNumarasi: 'SN1', status: 'depoda',
    }),
  );
});

test('serialLedger: başka şirketin defter satırı yazılamaz', async () => {
  const db = authedAsCompanyA();
  await assertFails(
    setDoc(doc(db, 'serialLedger', 'sl_companyB__KOD__SN1'), {
      companyId: 'companyB', stokKodu: 'KOD', seriNumarasi: 'SN1', status: 'depoda',
    }),
  );
});

test('serialLedger: başka şirketin defter satırı okunamaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serialLedger', 'slB'), {
      companyId: 'companyB', stokKodu: 'KOD', seriNumarasi: 'SN1',
    });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'serialLedger', 'slB')));
});

test('serialLedger: oturum açmamış kullanıcı erişemez', async () => {
  await assertFails(getDoc(doc(unauthed(), 'serialLedger', 'sl_companyA__KOD__SN1')));
  await assertFails(
    setDoc(doc(unauthed(), 'serialLedger', 'sl_anon'), { companyId: 'companyA' }),
  );
});

test('serialLedger: sayımdan düşüm olayı yazılabilir (eski akışta reddediliyordu)', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(
    setDoc(doc(db, 'serialLedger', 'sl_companyA__KOD__SN1', 'events', 'e1'), {
      companyId: 'companyA', type: 'sayim_dusum', stokKodu: 'KOD', seriNumarasi: 'SN1',
    }),
  );
});

test('serialLedger: olaylar değiştirilemez (append-only denetim izi)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serialLedger', 'slA', 'events', 'e1'), {
      companyId: 'companyA', type: 'tuketim',
    });
  });
  const db = authedAsCompanyA();
  await assertFails(
    setDoc(doc(db, 'serialLedger', 'slA', 'events', 'e1'), { companyId: 'companyA', type: 'mal_kabul' }),
  );
});

test('serialLedger: başka şirketin olayı yazılamaz', async () => {
  const db = authedAsCompanyA();
  await assertFails(
    setDoc(doc(db, 'serialLedger', 'slB', 'events', 'e2'), {
      companyId: 'companyB', type: 'tuketim',
    }),
  );
});

test('serialHistory: eski geçmiş yazımı artık reddedilmiyor', async () => {
  const db = authedAsCompanyA();
  await assertSucceeds(
    setDoc(doc(db, 'serialHistory', 'SN1', 'events', 'e1'), {
      type: 'sayimdan_dusum', details: { stokKodu: 'KOD' },
    }),
  );
});

test('serialHistory: oturum açmamış kullanıcı yazamaz', async () => {
  await assertFails(
    setDoc(doc(unauthed(), 'serialHistory', 'SN1', 'events', 'e1'), { type: 'intake' }),
  );
});

// ============================================================================
// Faz 7 — kuralı eksik kalmış koleksiyonlar ve geçici güvenlik ağı
//
// Bu blok, kural dosyası yayınlandığında kullanıcıların "veri okuyamaz/
// yazamaz" hâle gelmesini önleyen davranışı sabitler. İki gereksinim var:
//   1. Kodun tarayıcıdan kullandığı HER koleksiyon erişilebilir olmalı
//      (Firestore tanımsız koleksiyonu sessizce reddeder).
//   2. Güvenlik ağı, kendi bloğu daha sıkı olan koleksiyonları GEVŞETMEMELİ
//      (Firestore'da `allow` kuralları OR'lanır).
// ============================================================================

const FAZ7_COLLECTIONS = [
  'shortcuts', 'shortcutRuns', 'shortcutRunRequests', 'shortcutRunLogs',
  'routeRequests', 'routeSequences', 'lotNfcDefinitions', 'lot_tags',
  'labTransferDates', 'labManualSerialSnapshots', 'depoSayimBackfillLogs',
  'yedekParcaDepoMinMax', 'ceomedDepoStok', 'ceomedSevkiyatRequests',
  'ceomedSevkiyatResults', 'isAnaliziVerileri', 'analysis_results',
  'actionFormNumberCounters', 'qoreCalculationPeriodCounters',
  'notificationLogs', 'ordersArchive', 'appSettings', 'settings',
  'config_hospitals',
];

for (const col of FAZ7_COLLECTIONS) {
  test(`${col}: kendi şirketinde okunup yazılabilir (kilitlenme yok)`, async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), col, 'd1'), { companyId: 'companyA', v: 1 });
    });
    const db = authedAsCompanyA();
    await assertSucceeds(getDoc(doc(db, col, 'd1')));
    await assertSucceeds(setDoc(doc(db, col, 'd2'), { companyId: 'companyA', v: 2 }));
  });

  test(`${col}: başka şirketin belgesi engellenir`, async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), col, 'dB'), { companyId: 'companyB', v: 1 });
    });
    await assertFails(getDoc(doc(authedAsCompanyA(), col, 'dB')));
  });
}

test('etiketsiz (legacy) belgeler okunmaya ve yazılmaya devam eder', async () => {
  // `companyId` alanı hiç taşımayan eski kayıtlar bu geçişte kaybolmamalı.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'shortcuts', 'legacy'), { name: 'eski kayıt' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'shortcuts', 'legacy')));
  await assertSucceeds(setDoc(doc(db, 'shortcuts', 'legacy2'), { name: 'etiketsiz' }));
});

test('güvenlik ağı: envanterde HİÇ olmayan bir koleksiyon da kilitlenmez', async () => {
  // Statik envanterde gözden kaçan bir koleksiyon, kullanıcıya hiçbir ipucu
  // vermeyen bir kilitlenmeye yol açmamalı.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gozdenKacmisKoleksiyon', 'x'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'gozdenKacmisKoleksiyon', 'x')));
  await assertSucceeds(setDoc(doc(db, 'gozdenKacmisKoleksiyon', 'y'), { companyId: 'companyA' }));
});

test('güvenlik ağı kiracı izolasyonunu ZAYIFLATMAZ', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gozdenKacmisKoleksiyon', 'b'), { companyId: 'companyB' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'gozdenKacmisKoleksiyon', 'b')));
  await assertFails(
    setDoc(doc(authedAsCompanyA(), 'gozdenKacmisKoleksiyon', 'c'), { companyId: 'companyB' }),
  );
});

test('güvenlik ağı oturum açmamış kullanıcıya açılmaz', async () => {
  await assertFails(getDoc(doc(unauthed(), 'gozdenKacmisKoleksiyon', 'x')));
  await assertFails(setDoc(doc(unauthed(), 'gozdenKacmisKoleksiyon', 'z'), { companyId: 'companyA' }));
});

// ── Güvenlik ağının EZMEMESİ gereken kurallar ───────────────────────────────

test('güvenlik ağı AuditLogs süper-admin kısıtını ezmez', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'AuditLogs', 'a1'), { companyId: 'companyA' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'AuditLogs', 'a1')));
  await assertSucceeds(getDoc(doc(authedAsSuperAdmin(), 'AuditLogs', 'a1')));
});

test('güvenlik ağı takvim OAuth belgelerini açmaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'calendarOAuthStates', 's1'), { companyId: 'companyA' });
    await setDoc(doc(ctx.firestore(), 'calendarConnections', 'userA', 'tokens', 't1'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'calendarOAuthStates', 's1')));
  await assertFails(getDoc(doc(db, 'calendarConnections', 'userA', 'tokens', 't1')));
});

test('güvenlik ağı stockAdjustmentLogs değiştirilemezliğini bozmaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'stockAdjustmentLogs', 'l1'), { companyId: 'companyA', diff: -1 });
  });
  await assertFails(
    setDoc(doc(authedAsCompanyA(), 'stockAdjustmentLogs', 'l1'), { companyId: 'companyA', diff: 99 }),
  );
});

test('güvenlik ağı serialLedger olaylarının değiştirilemezliğini bozmaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serialLedger', 'slA', 'events', 'e9'), {
      companyId: 'companyA', type: 'tuketim',
    });
  });
  await assertFails(
    setDoc(doc(authedAsCompanyA(), 'serialLedger', 'slA', 'events', 'e9'), {
      companyId: 'companyA', type: 'mal_kabul',
    }),
  );
});

test('güvenlik ağı kullanıcıların birbirinin profilini yazmasına izin vermez', async () => {
  await assertFails(
    setDoc(doc(authedAsCompanyA(), 'users', 'userA2'), { name: 'ele geçirildi', companyId: 'companyA' }),
  );
});

test('güvenlik ağı companyStats salt-okunurluğunu bozmaz', async () => {
  await assertFails(
    setDoc(doc(authedAsCompanyA(), 'companyStats', 'companyA'), { companyId: 'companyA', total: 1 }),
  );
});

test('companyId claim eksik kullanıcı etiketli belgeye erişemez (claim senkronu şart)', async () => {
  // Bu, "kurallar güncellenince kullanıcılar yazamaz oldu" şikâyetinin ikinci
  // kök nedeni: `onUserClaimSync` çalışmamış / `sync-claims.js` koşulmamışsa
  // token'da companyId olmaz ve `inCompany()` her etiketli belgeyi reddeder.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'devices', 'devA9'), { companyId: 'companyA' });
  });
  const noClaim = testEnv.authenticatedContext('userNoClaim', {}).firestore();
  await assertFails(getDoc(doc(noClaim, 'devices', 'devA9')));
  await assertFails(setDoc(doc(noClaim, 'devices', 'devA10'), { companyId: 'companyA' }));
});
