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
import { setDoc, doc, getDoc, deleteDoc, writeBatch, collection, getDocs, query, where } from 'firebase/firestore';

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
// Tanımsız koleksiyon — varsayılan reddet (güvenlik ağı kaldırıldıktan sonra)
//
// Faz 7 geçici güvenlik ağı silindi; `match` bloğu olmayan koleksiyon yeniden
// her erişime kapalıdır. Bu testin geri döndürülmesi, ağın gerçekten
// kaldırıldığının kanıtıdır.
// ============================================================================

test('Tanımsız koleksiyon her erişime kapalıdır (varsayılan reddet)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'someUnknownCollection', 'x'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'someUnknownCollection', 'x')));
  await assertFails(setDoc(doc(db, 'someUnknownCollection', 'y'), { companyId: 'companyA' }));
  await assertFails(getDoc(doc(unauthed(), 'someUnknownCollection', 'x')));
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
// Faz 7 — kuralı eksik kalmış koleksiyonlar
//
// Bu blok, kural dosyası yayınlandığında kullanıcıların "veri okuyamaz/
// yazamaz" hâle gelmesini önleyen davranışı sabitler: kodun tarayıcıdan
// kullandığı HER koleksiyon erişilebilir olmalı. Geçici güvenlik ağı
// kaldırıldığı için bu artık tek savunma hattıdır — aşağıdaki listeden bir
// koleksiyon düşerse üretimde sessizce reddedilir.
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

test('envanterde olmayan koleksiyon reddedilir (ağ kaldırıldı)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'gozdenKacmisKoleksiyon', 'x'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertFails(getDoc(doc(db, 'gozdenKacmisKoleksiyon', 'x')));
  await assertFails(setDoc(doc(db, 'gozdenKacmisKoleksiyon', 'y'), { companyId: 'companyA' }));
});

// Ağ kaldırıldıktan sonra da daha sıkı kuralların yerinde olduğu doğrulanır —
// silme işlemi yanlışlıkla başka bir bloğa dokunmuş olabilir.
test('AuditLogs hâlâ yalnızca süper-admin', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'AuditLogs', 'a1'), { companyId: 'companyA' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'AuditLogs', 'a1')));
  await assertSucceeds(getDoc(doc(authedAsSuperAdmin(), 'AuditLogs', 'a1')));
});

test('takvim OAuth belgeleri hâlâ tamamen kapalı', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'calendarOAuthStates', 's1'), { companyId: 'companyA' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'calendarOAuthStates', 's1')));
});

test('serialLedger olayları hâlâ değiştirilemez', async () => {
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

// ============================================================================
// SİLME (delete)
//
// Bu blok bir üretim hatasından doğdu: ürün kullanım panelinde barkodlu ve
// manuel düşüm "hata oluştu" veriyordu. Sebep, `allow write` kuralının silmeyi
// de kapsaması ama `writingInCompany()` yardımcısının `request.resource.data`
// okumasıydı — Firestore'da silme işleminde `request.resource` NULL'dur, null
// dereference kural değerlendirmesini hataya düşürür ve işlem reddedilir.
//
// Seri no takipli ürün tüketildiğinde `adet <= 1` olduğu için `depoStok`
// belgesi GÜNCELLENMEZ, SİLİNİR. Yani her seri no tüketimi reddediliyordu.
//
// Önceki 82 testin hiçbiri `deleteDoc` çağırmıyordu; bu yüzden hata testlerden
// kaçtı. Aşağıdakiler o boşluğu kapatır.
// ============================================================================

test('kendi şirketinin belgesini silebilir (seri no tüketimi bunu yapar)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokA1'), {
      companyId: 'companyA', stokKodu: 'K1', seriNumarasi: 'S1', adet: 1,
    });
  });
  await assertSucceeds(deleteDoc(doc(authedAsCompanyA(), 'depoStok', 'stokA1')));
});

test('başka şirketin belgesini silemez', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokB1'), {
      companyId: 'companyB', stokKodu: 'K1', seriNumarasi: 'S2', adet: 1,
    });
  });
  await assertFails(deleteDoc(doc(authedAsCompanyA(), 'depoStok', 'stokB1')));
});

test('companyId etiketi olmayan eski belge silinebilir', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokLegacy'), { stokKodu: 'K1', adet: 1 });
  });
  await assertSucceeds(deleteDoc(doc(authedAsCompanyA(), 'depoStok', 'stokLegacy')));
});

test('süper admin başka şirketin belgesini silebilir', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokB2'), { companyId: 'companyB', adet: 1 });
  });
  await assertSucceeds(deleteDoc(doc(authedAsSuperAdmin(), 'depoStok', 'stokB2')));
});

test('oturum açmamış kullanıcı silemez', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokA2'), { companyId: 'companyA', adet: 1 });
  });
  await assertFails(deleteDoc(doc(unauthed(), 'depoStok', 'stokA2')));
});

test('tüketim yolu: tuketimKayitlari yazımı + depoStok silimi birlikte geçer', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokA3'), {
      companyId: 'companyA', stokKodu: 'K1', seriNumarasi: 'S3', adet: 1,
    });
  });
  const db = authedAsCompanyA();
  const batch = writeBatch(db);
  batch.set(doc(db, 'tuketimKayitlari', 't1'), { companyId: 'companyA', stokKodu: 'K1' });
  batch.set(doc(db, 'serialLedger', 'slK1S3'), { companyId: 'companyA', stokKodu: 'K1' }, { merge: true });
  batch.set(doc(db, 'serialLedger', 'slK1S3', 'events', 'ev1'), { companyId: 'companyA', type: 'tuketim' });
  batch.delete(doc(db, 'depoStok', 'stokA3'));
  await assertSucceeds(batch.commit());
});

test('serialLedger satırı silinemez (süper admin dışında)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serialLedger', 'slDel'), { companyId: 'companyA' });
  });
  await assertFails(deleteDoc(doc(authedAsCompanyA(), 'serialLedger', 'slDel')));
  await assertSucceeds(deleteDoc(doc(authedAsSuperAdmin(), 'serialLedger', 'slDel')));
});

// ============================================================================
// Liste (query) kuralları — `__legacy__` etiketli belgeler
//
// src/lib/firestore-helpers.ts#getScopedDocs her yüklemede İKİ sorgu atar:
//   1) where('companyId','==',<şirket>)
//   2) where('companyId','==','__legacy__')
// İkincisi `Promise.all` içinde olduğu için reddedilirse TÜM yükleme düşer.
//
// Firestore liste kurallarını dönen HER belge için ayrı değerlendirir; tek bir
// belge kuralı sağlamazsa sorgunun tamamı permission-denied olur.
// ============================================================================

test('şirket etiketli liste sorgusu geçer', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'malKabulTransactions', 'mkA1'), { companyId: 'companyA' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDocs(query(
    collection(db, 'malKabulTransactions'), where('companyId', '==', 'companyA'),
  )));
});

test('__legacy__ etiketli liste sorgusu geçer (getScopedDocs bunu her yüklemede atar)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'malKabulTransactions', 'mkLegacy'), { companyId: '__legacy__' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDocs(query(
    collection(db, 'malKabulTransactions'), where('companyId', '==', '__legacy__'),
  )));
});

test('__legacy__ etiketli belge tek tek de okunabilir', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'malKabulTransactions', 'mkLegacy2'), { companyId: '__legacy__' });
  });
  await assertSucceeds(getDoc(doc(authedAsCompanyA(), 'malKabulTransactions', 'mkLegacy2')));
});

test('başka şirketin belgesi liste sorgusuyla da alınamaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'malKabulTransactions', 'mkB1'), { companyId: 'companyB' });
  });
  const db = authedAsCompanyA();
  await assertFails(getDocs(query(
    collection(db, 'malKabulTransactions'), where('companyId', '==', 'companyB'),
  )));
});

// REGRESYON — kiracı izolasyonu.
//
// Etiketsiz-belge dalı `list` için de açıkken filtresiz sorgu kural motorunca
// KABUL ediliyor ve bütün şirketlerin belgelerini döndürüyordu. Ayıklama
// sadece istemcideki `matchesCompanyScope` ile yapıldığı için başka şirketin
// verisi yine de tarayıcıya iniyordu.
test('filtresiz liste sorgusu reddedilir — başka şirketin belgesi sızmaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'malKabulTransactions', 'mkA2'), { companyId: 'companyA' });
    await setDoc(doc(db, 'malKabulTransactions', 'mkB2'), { companyId: 'companyB' });
  });
  await assertFails(getDocs(query(collection(authedAsCompanyA(), 'malKabulTransactions'))));
});

test('etiketsiz belge tek tek okunabilir ama listelenemez', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'malKabulTransactions', 'mkNoTag'), { note: 'companyId alanı yok' });
  });
  const db = authedAsCompanyA();
  await assertSucceeds(getDoc(doc(db, 'malKabulTransactions', 'mkNoTag')));
  await assertFails(getDocs(query(collection(db, 'malKabulTransactions'))));
});

test('__legacy__ etiketli belge silinebilir (tüketimde depoStok silimi bu kayıtlarda da düşmemeli)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'stokLegacyTag'), { companyId: '__legacy__', adet: 1 });
  });
  await assertSucceeds(deleteDoc(doc(authedAsCompanyA(), 'depoStok', 'stokLegacyTag')));
});

test('__legacy__ etiketiyle yazılabilir (normalizeCompanyId boş şirketi buna çevirir)', async () => {
  await assertSucceeds(
    setDoc(doc(authedAsCompanyA(), 'malKabulTransactions', 'yeniLegacy'), { companyId: '__legacy__' }),
  );
});

test('total verimlilik panelinin okuduğu koleksiyonlarda da __legacy__ sorgusu geçer', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const col of ['efficiencyPools', 'labPools', 'depots', 'kumulatifHesaplamaGecmisi', 'cihazUstuGecmisi']) {
      await setDoc(doc(db, col, 'legacyDoc'), { companyId: '__legacy__' });
    }
  });
  const db = authedAsCompanyA();
  for (const col of ['efficiencyPools', 'labPools', 'depots', 'kumulatifHesaplamaGecmisi', 'cihazUstuGecmisi']) {
    await assertSucceeds(getDocs(query(collection(db, col), where('companyId', '==', '__legacy__'))));
  }
});

// ============================================================================
// Liste (query) kuralları — companyId filtresi zorunlu
//
// Firestore `list` kurallarını dönen belgelere bakarak değil, SORGUNUN
// KISITLARINDAN ispatlanabilirlik üzerinden değerlendirir. Sonuçta yalnızca
// kendi şirketinin belgeleri gelecek olsa bile, filtre sorguda yoksa istek
// reddedilir. Bu yüzden panellerin "filtresiz çek, istemcide ayıkla" deseni
// çalışmaz — üretimde direkt transfer bu yüzden sonsuz loading'de kalmıştı.
// ============================================================================

test('companyId filtreli liste sorgusu geçer', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'depoStok', 'q1'), { companyId: 'companyA', depotId: 'D1', stokKodu: 'K1' });
  });
  await assertSucceeds(getDocs(query(
    collection(authedAsCompanyA(), 'depoStok'),
    where('companyId', '==', 'companyA'),
    where('depotId', '==', 'D1'),
  )));
});

test('companyId filtresi olmayan liste sorgusu reddedilir — belgeler kendi şirketine ait olsa bile', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'depoStok', 'q2'), { companyId: 'companyA', depotId: 'D1', stokKodu: 'K1' });
    await setDoc(doc(db, 'depoStok', 'q3'), { companyId: 'companyA', depotId: 'D1', stokKodu: 'K2' });
  });
  await assertFails(getDocs(query(
    collection(authedAsCompanyA(), 'depoStok'),
    where('depotId', '==', 'D1'),
  )));
});

// REGRESYON — özyinelemeli joker kiracı izolasyonunu deliyordu.
//
// `match /deviceFaultReports/{id} { match /{path=**} { ... isSignedIn() } }`
// yazımında joker SIFIR segment de eşleştiği için üst belgenin KENDİSİNİ de
// kapsıyor ve `isSignedIn()`'i `inCompany()` ile OR'luyordu. Sonuç: başka
// şirketin arıza raporu okunabiliyor/yazılabiliyordu.
test('başka şirketin arıza raporu okunamaz (özyinelemeli joker sızdırmamalı)', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'deviceFaultReports', 'fB'), { companyId: 'companyB', deviceId: 'd1' });
  });
  await assertFails(getDoc(doc(authedAsCompanyA(), 'deviceFaultReports', 'fB')));
});

test('başka şirketin arıza raporu yazılamaz', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'deviceFaultReports', 'fB2'), { companyId: 'companyB', deviceId: 'd1' });
  });
  await assertFails(setDoc(doc(authedAsCompanyA(), 'deviceFaultReports', 'fB2'), { companyId: 'companyB', note: 'x' }));
});

test('arıza raporu filtresiz listelenemez', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'deviceFaultReports', 'fA'), { companyId: 'companyA', deviceId: 'd1' });
  });
  await assertFails(getDocs(query(
    collection(authedAsCompanyA(), 'deviceFaultReports'),
    where('deviceId', '==', 'd1'),
  )));
});

test('arıza raporunun alt koleksiyonu hâlâ erişilebilir', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'deviceFaultReports', 'fA2'), { companyId: 'companyA' });
    await setDoc(doc(db, 'deviceFaultReports', 'fA2', 'notes', 'n1'), { text: 'not' });
  });
  await assertSucceeds(getDocs(collection(authedAsCompanyA(), 'deviceFaultReports', 'fA2', 'notes')));
});
