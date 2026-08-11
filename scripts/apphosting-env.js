/**
 * `apphosting.yaml` içindeki NEXT_PUBLIC_* değerlerini okur.
 *
 * NEDEN ORTAK BİR MODÜL: Aynı değerlere iki yerden ihtiyaç var — terminal
 * paketinin derlemesi (`vite.config.terminal.ts`) ve `.env.local` üreticisi
 * (`env-from-apphosting.js`). Ayrıştırma iki kopya olsaydı biri güncellenip
 * diğeri unutulduğunda ortaya "derleme çalışıyor ama .exe'de anahtar yok"
 * gibi teşhisi zor bir fark çıkardı.
 *
 * Bu anahtarlar Firebase'in İSTEMCİ anahtarlarıdır: zaten tarayıcıya
 * gönderilirler ve depoda açık hâlde dururlar. Erişimi belirleyen şey
 * `firestore.rules`tır, anahtarın gizliliği değil.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Küçük ve kasıtlı olarak dar bir ayrıştırıcı.
 *
 * Tam bir YAML kütüphanesi eklemek yerine yalnızca aradığımız kalıbı okuyoruz:
 *
 *     - variable: NEXT_PUBLIC_X
 *       value: "..."
 *
 * `secret:` ile tanımlı girdiler değersizdir ve doğal olarak atlanır — bu
 * modülün gizli değerlere hiç dokunmaması İSTENEN davranış.
 *
 * @param {string} repoRoot Depo kökü.
 * @returns {Record<string, string>} Bulunan değişkenler (yoksa boş nesne).
 */
function readApphostingPublicEnv(repoRoot) {
  const source = path.join(repoRoot, 'apphosting.yaml');
  if (!fs.existsSync(source)) return {};

  const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
  const values = {};

  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/^\s*-\s*variable:\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*$/);
    if (!nameMatch) continue;

    const valueMatch = (lines[i + 1] || '').match(/^\s*value:\s*"?(.*?)"?\s*$/);
    if (!valueMatch) continue;

    values[nameMatch[1]] = valueMatch[1];
  }

  return values;
}

module.exports = { readApphostingPublicEnv };
