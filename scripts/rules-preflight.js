#!/usr/bin/env node
/**
 * Firestore kuralları yayın öncesi ÖN KONTROL.
 *
 * `firebase deploy --only firestore:rules` komutu, kuralları o an neyse onunla
 * DEĞİŞTİRİR. Yeni kurallar sıkı çok-kiracılı olduğu için iki şey yanlışsa
 * kullanıcılar anında "veri okuyamaz/yazamaz" hâle gelir:
 *
 *   1. Bir kullanıcının Firebase Auth token'ında `companyId` custom claim'i
 *      YOKSA — `inCompany()` / `writingInCompany()` o kullanıcı için
 *      `companyId` etiketi taşıyan HER belgeyi reddeder. Kullanıcı hem
 *      okuyamaz hem yazamaz.
 *   2. Bir kullanıcının token'ındaki `companyId`, Firestore'daki `users/{uid}`
 *      dokümanındaki değerle UYUŞMUYORSA — aynı sonuç.
 *
 * Bu script HİÇBİR ŞEY YAZMAZ. Yalnızca raporlar. Sorun bulursa çıkış kodu 1
 * döner ki CI/deploy zincirinde durdurucu olarak kullanılabilsin.
 *
 * Kullanım:
 *   node scripts/rules-preflight.js
 *
 * Sorun bulunursa düzeltme:
 *   node scripts/sync-claims.js --apply
 *
 * Gerekli env:
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

/** `users/{uid}` dokümanından beklenen claim — userClaimSync.ts ile birebir aynı. */
function expectedClaim(data) {
  const companyId = typeof data?.companyId === 'string' ? data.companyId.trim() : '';
  const role = typeof data?.role === 'string' ? data.role : null;
  return { companyId: companyId || null, role, isSuperAdmin: role === 'super_admin' };
}

async function main() {
  const db = init();
  const usersSnap = await db.collection('users').get();

  const sorunlar = {
    claimYok: [],        // token'da companyId yok → HER etiketli belge reddedilir
    claimUyusmuyor: [],  // token'daki companyId users doc'undan farklı
    companyIdYok: [],    // users doc'unda companyId alanı yok
    authYok: [],         // Firestore user var, Auth kullanıcısı yok
    superAdminEksik: [], // role super_admin ama isSuperAdmin claim'i yok
  };
  let saglikli = 0;

  for (const docSnap of usersSnap.docs) {
    const uid = docSnap.id;
    const data = docSnap.data();
    const beklenen = expectedClaim(data);
    const etiket = `${uid} (${data.email || data.name || 'isimsiz'})`;

    if (!beklenen.companyId) {
      sorunlar.companyIdYok.push(etiket);
      continue;
    }

    let mevcut = null;
    try {
      mevcut = (await admin.auth().getUser(uid)).customClaims || {};
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        sorunlar.authYok.push(etiket);
        continue;
      }
      throw err;
    }

    if (!mevcut.companyId) {
      sorunlar.claimYok.push(etiket);
    } else if (mevcut.companyId !== beklenen.companyId) {
      sorunlar.claimUyusmuyor.push(`${etiket}: token=${mevcut.companyId} ≠ doc=${beklenen.companyId}`);
    } else if (beklenen.isSuperAdmin && mevcut.isSuperAdmin !== true) {
      sorunlar.superAdminEksik.push(etiket);
    } else {
      saglikli += 1;
    }
  }

  const yaz = (baslik, liste, aciklama) => {
    if (liste.length === 0) return;
    console.log(`\n### ${baslik}: ${liste.length}`);
    console.log(`    ${aciklama}`);
    liste.slice(0, 25).forEach((s) => console.log(`      - ${s}`));
    if (liste.length > 25) console.log(`      … +${liste.length - 25} kullanıcı daha`);
  };

  console.log(`Toplam kullanıcı: ${usersSnap.size}`);
  console.log(`Sağlıklı (claim doğru): ${saglikli}`);

  yaz('CLAIM YOK', sorunlar.claimYok,
    'Token\'da companyId yok → deploy sonrası HİÇBİR veriyi okuyamaz/yazamaz. Düzeltme: node scripts/sync-claims.js --apply');
  yaz('CLAIM UYUŞMUYOR', sorunlar.claimUyusmuyor,
    'Token\'daki companyId users dokümanından farklı → tüm sorgular reddedilir. Düzeltme: node scripts/sync-claims.js --apply');
  yaz('users DOKÜMANINDA companyId YOK', sorunlar.companyIdYok,
    'Önce users/{uid}.companyId alanı doldurulmalı (yönetim panelinden), sonra sync-claims.');
  yaz('AUTH KULLANICISI YOK', sorunlar.authYok,
    'Firestore kaydı var ama Auth hesabı yok. Zaten giriş yapamazlar; genelde zararsız artık kayıttır.');
  yaz('isSuperAdmin CLAIM EKSİK', sorunlar.superAdminEksik,
    'role=super_admin ama token\'da isSuperAdmin yok → şirketler arası erişim çalışmaz.');

  const engelleyici =
    sorunlar.claimYok.length + sorunlar.claimUyusmuyor.length +
    sorunlar.companyIdYok.length + sorunlar.superAdminEksik.length;

  console.log('');
  if (engelleyici === 0) {
    console.log('✓ Claim tarafı temiz — kurallar güvenle yayınlanabilir.');
    console.log('  Not: kullanıcıların token\'ı 1 saate kadar önbelleklenir, ancak');
    console.log('  auth-context.tsx claim eksik/uyuşmazsa açılışta force-refresh yapar.');
    process.exit(0);
  }

  console.log(`✗ ${engelleyici} kullanıcı deploy sonrası kilitlenir. Önce düzeltin:`);
  console.log('    node scripts/sync-claims.js            # dry-run, ne değişecek gösterir');
  console.log('    node scripts/sync-claims.js --apply    # uygula');
  process.exit(1);
}

main().catch((err) => {
  console.error('Ön kontrol başarısız:', err);
  process.exit(2);
});
