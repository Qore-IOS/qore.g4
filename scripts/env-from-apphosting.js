#!/usr/bin/env node
/**
 * `apphosting.yaml` içindeki NEXT_PUBLIC_* değerlerinden `.env.local` üretir.
 *
 * NEDEN VAR: Terminal paketi (masaüstü ve Android) Firebase istemci
 * anahtarlarını derleme sırasında gömer ve eksik olduklarında derleme durur.
 * O anahtarlar zaten `apphosting.yaml` içinde, depoda, açık hâlde duruyor —
 * istemci anahtarlarıdır, gizli değildirler; erişimi Firestore kuralları
 * belirler. Yeni bir makinede (ya da CI'da) aynı değerleri elle kopyalamak
 * gereksiz ve hataya açık bir adımdı.
 *
 * MEVCUT `.env.local` DOSYASINA DOKUNULMAZ. Geliştiricinin kendi ayarları
 * (emülatör adresleri, deneysel bayraklar) sessizce silinseydi bu betik
 * yardımcı olmaktan çok zarar verirdi. Üzerine yazmak için `--force`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readApphostingPublicEnv } = require('./apphosting-env');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'apphosting.yaml');
const TARGET = path.join(REPO_ROOT, '.env.local');
const FORCE = process.argv.includes('--force');

if (fs.existsSync(TARGET) && !FORCE) {
  console.log('[qore-terminal] .env.local zaten var, dokunulmadı (--force ile üzerine yazılır).');
  process.exit(0);
}

if (!fs.existsSync(SOURCE)) {
  console.error('[qore-terminal] apphosting.yaml bulunamadı.');
  process.exit(1);
}

const values = Object.entries(readApphostingPublicEnv(REPO_ROOT)).map(
  ([key, value]) => `${key}=${value}`,
);

if (values.length === 0) {
  console.error('[qore-terminal] apphosting.yaml içinde NEXT_PUBLIC_* değeri bulunamadı.');
  process.exit(1);
}

fs.writeFileSync(
  TARGET,
  ['# apphosting.yaml içinden üretildi (scripts/env-from-apphosting.js).', ...values, ''].join('\n'),
);

console.log(`[qore-terminal] .env.local yazıldı — ${values.length} değişken.`);
