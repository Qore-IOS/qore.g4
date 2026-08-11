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

/**
 * Küçük ve kasıtlı olarak dar bir ayrıştırıcı.
 *
 * Tam bir YAML kütüphanesi eklemek yerine yalnızca aradığımız kalıbı okuyoruz:
 *
 *     - variable: NEXT_PUBLIC_X
 *       value: "..."
 *
 * `secret:` ile tanımlı girdiler değersizdir ve doğal olarak atlanır — bu
 * betiğin gizli değerlere hiç dokunmaması İSTENEN davranış.
 */
const lines = fs.readFileSync(SOURCE, 'utf8').split(/\r?\n/);
const values = [];

for (let i = 0; i < lines.length; i++) {
  const nameMatch = lines[i].match(/^\s*-\s*variable:\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*$/);
  if (!nameMatch) continue;

  const valueMatch = (lines[i + 1] || '').match(/^\s*value:\s*"?(.*?)"?\s*$/);
  if (!valueMatch) continue;

  values.push(`${nameMatch[1]}=${valueMatch[1]}`);
}

if (values.length === 0) {
  console.error('[qore-terminal] apphosting.yaml içinde NEXT_PUBLIC_* değeri bulunamadı.');
  process.exit(1);
}

fs.writeFileSync(
  TARGET,
  ['# apphosting.yaml içinden üretildi (scripts/env-from-apphosting.js).', ...values, ''].join('\n'),
);

console.log(`[qore-terminal] .env.local yazıldı — ${values.length} değişken.`);
