/**
 * Multi-tenancy custom claim sync — one-shot script (Faz 2).
 *
 * Tüm Firestore `users` dokümanlarını gezer, her birinin `companyId`,
 * `role` ve `isSuperAdmin` değerlerini Firebase Auth custom claim'lerine
 * yazar. Bu script bir kez (initial seeding) çalıştırılır. Sonrasında
 * `onUserClaimSync` Cloud Function her users yazısında otomatik claim
 * günceller.
 *
 * GÜVENLİK:
 *   - Default mode `--dry-run`.
 *   - `--apply` flag'i şart.
 *
 * Kullanım:
 *   node scripts/sync-claims.js                    # dry-run
 *   node scripts/sync-claims.js --apply            # tüm kullanıcılara uygula
 *   node scripts/sync-claims.js --uid <UID>        # tek kullanıcı (dry-run)
 *   node scripts/sync-claims.js --uid <UID> --apply
 *
 * Gerekli env:
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, uid: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--dry-run') out.apply = false;
    else if (args[i] === '--uid' && args[i + 1]) out.uid = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node scripts/sync-claims.js [--apply] [--uid <UID>]');
      process.exit(0);
    }
  }
  return out;
}

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

function buildClaim(data) {
  if (!data) return { companyId: null, role: null, isSuperAdmin: false };
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const role = typeof data.role === 'string' ? data.role : null;
  return {
    companyId: companyId || null,
    role,
    isSuperAdmin: role === 'super_admin',
  };
}

function claimsEqual(a, b) {
  if (!a || !b) return false;
  return a.companyId === b.companyId && a.role === b.role && a.isSuperAdmin === b.isSuperAdmin;
}

async function syncOne(uid, data, apply) {
  const target = buildClaim(data);

  let current = null;
  try {
    const user = await admin.auth().getUser(uid);
    current = user.customClaims || null;
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') {
      return { uid, status: 'auth-not-found' };
    }
    throw err;
  }

  if (claimsEqual(current, target)) {
    return { uid, status: 'unchanged', target };
  }

  if (!apply) {
    return { uid, status: 'would-update', current, target };
  }

  await admin.auth().setCustomUserClaims(uid, target);
  return { uid, status: 'updated', target };
}

async function main() {
  const opts = parseArgs();
  const db = init();
  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';

  console.log(`Custom claim sync — ${new Date().toISOString()}`);
  console.log(`Project : ${process.env.FIREBASE_PROJECT_ID || '(applicationDefault)'}`);
  console.log(`Mode    : ${mode}`);
  console.log(`Scope   : ${opts.uid ? `single uid=${opts.uid}` : 'all users'}\n`);

  if (opts.apply) {
    console.log('⚠️  APPLY modu — 3 saniye içinde Ctrl+C ile iptal et.\n');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const counters = { total: 0, unchanged: 0, updated: 0, wouldUpdate: 0, authNotFound: 0, error: 0 };

  if (opts.uid) {
    counters.total = 1;
    const snap = await db.collection('users').doc(opts.uid).get();
    if (!snap.exists) {
      console.error(`Firestore'da users/${opts.uid} bulunamadı.`);
      process.exit(1);
    }
    try {
      const r = await syncOne(opts.uid, snap.data(), opts.apply);
      console.log(`  ${r.uid.padEnd(36)} ${r.status}`);
      if (r.status === 'unchanged') counters.unchanged++;
      else if (r.status === 'updated') counters.updated++;
      else if (r.status === 'would-update') counters.wouldUpdate++;
      else if (r.status === 'auth-not-found') counters.authNotFound++;
    } catch (err) {
      console.error(`  ${opts.uid} ERROR: ${err.message || err}`);
      counters.error++;
    }
  } else {
    const snap = await db.collection('users').get();
    counters.total = snap.size;
    for (const doc of snap.docs) {
      try {
        const r = await syncOne(doc.id, doc.data(), opts.apply);
        if (r.status === 'unchanged') counters.unchanged++;
        else if (r.status === 'updated') {
          counters.updated++;
          console.log(`  ${doc.id.padEnd(36)} updated  companyId=${r.target.companyId} role=${r.target.role}`);
        } else if (r.status === 'would-update') {
          counters.wouldUpdate++;
          console.log(`  ${doc.id.padEnd(36)} would-update  companyId=${r.target.companyId} role=${r.target.role}`);
        } else if (r.status === 'auth-not-found') {
          counters.authNotFound++;
        }
      } catch (err) {
        console.error(`  ${doc.id} ERROR: ${err.message || err}`);
        counters.error++;
      }
    }
  }

  console.log('\n=== ÖZET ===');
  console.log(`  Toplam users doc       : ${counters.total}`);
  console.log(`  Unchanged (skip)       : ${counters.unchanged}`);
  console.log(`  ${opts.apply ? 'Updated' : 'Would-update'}        : ${opts.apply ? counters.updated : counters.wouldUpdate}`);
  console.log(`  Auth user yok          : ${counters.authNotFound}`);
  console.log(`  Error                  : ${counters.error}`);

  if (!opts.apply) console.log('\nGerçek yazma için --apply ekle.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Hata:', err);
    process.exit(1);
  });
