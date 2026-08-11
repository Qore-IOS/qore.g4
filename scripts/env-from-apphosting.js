#!/usr/bin/env node
/**
 * `apphosting.yaml` içindeki NEXT_PUBLIC_* değerlerini `.env.local`'e yazar.
 *
 * NEDEN VAR: Terminal paketi (masaüstü ve Android) Firebase istemci
 * anahtarlarını derleme sırasında gömer. O anahtarlar zaten `apphosting.yaml`
 * içinde, depoda, açık hâlde duruyor — istemci anahtarlarıdır, gizli
 * değildirler; erişimi Firestore kuralları belirler. Yeni bir makinede aynı
 * değerleri elle kopyalamak gereksiz ve hataya açık bir adımdı.
 *
 * DAVRANIŞ — BİRLEŞTİRİR, EZMEZ:
 *
 * Dosya varsa yalnızca EKSİK anahtarlar eklenir; mevcut satırlara
 * dokunulmaz. Bu davranış bir hatadan öğrenildi: betik önceden ".env.local
 * zaten var" deyip hiçbir şey yapmadan çıkıyordu ve dosyası olan ama içinde
 * Firebase anahtarları OLMAYAN bir makinede hiçbir işe yaramıyordu —
 * kullanıcı komutu çalıştırıyor, "dokunulmadı" mesajını görüyor ve derleme
 * yine aynı hatayla duruyordu.
 *
 * Tümünü `apphosting.yaml` değerlerine döndürmek için `--force`. Bu, mevcut
 * değerlerin ÜZERİNE yazar; dosyadaki diğer satırlar (başka servislerin
 * anahtarları, emülatör adresleri) yine korunur.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readApphostingPublicEnv } = require('./apphosting-env');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'apphosting.yaml');
const TARGET = path.join(REPO_ROOT, '.env.local');
const FORCE = process.argv.includes('--force');

if (!fs.existsSync(SOURCE)) {
  console.error('[qore-terminal] apphosting.yaml bulunamadı.');
  process.exit(1);
}

const wanted = readApphostingPublicEnv(REPO_ROOT);

if (Object.keys(wanted).length === 0) {
  console.error('[qore-terminal] apphosting.yaml içinde NEXT_PUBLIC_* değeri bulunamadı.');
  process.exit(1);
}

const existingLines = fs.existsSync(TARGET)
  ? fs.readFileSync(TARGET, 'utf8').split(/\r?\n/)
  : [];

const output = [...existingLines];
const added = [];
const updated = [];

/**
 * Mevcut satırlar önce yerinde güncellenir.
 *
 * Değeri BOŞ olan satır ("KEY=") eksik sayılır — derleme tarafı da boş
 * değeri eksik kabul ediyor, iki tarafın aynı şeyi anlaması gerek. Böyle bir
 * satır sonuna yeni bir satır EKLENEREK değil, yerinde doldurularak
 * düzeltilir; aksi hâlde dosyada aynı anahtarın iki satırı kalır ve hangisinin
 * geçerli olduğu okuyana bakarak anlaşılmaz.
 */
const handled = new Set();

for (let i = 0; i < output.length; i++) {
  const match = output[i].match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!match) continue;

  const [, key, value] = match;
  if (!Object.prototype.hasOwnProperty.call(wanted, key)) continue;

  const isEmpty = value.trim() === '';
  if (isEmpty || FORCE) {
    output[i] = `${key}=${wanted[key]}`;
    (isEmpty ? added : updated).push(key);
  }
  handled.add(key);
}

// Dosyada hiç geçmeyen anahtarlar sona eklenir.
const missing = Object.keys(wanted).filter(key => !handled.has(key));

if (missing.length > 0) {
  if (output.length > 0 && output[output.length - 1].trim() !== '') output.push('');
  output.push('# apphosting.yaml içinden eklendi (scripts/env-from-apphosting.js).');
  missing.forEach(key => {
    output.push(`${key}=${wanted[key]}`);
    added.push(key);
  });
  output.push('');
}

if (added.length === 0 && updated.length === 0) {
  console.log('[qore-terminal] .env.local zaten eksiksiz — değişiklik yok.');
  process.exit(0);
}

fs.writeFileSync(TARGET, output.join('\n'));

const parts = [];
if (added.length > 0) parts.push(`${added.length} anahtar eklendi (${added.join(', ')})`);
if (updated.length > 0) parts.push(`${updated.length} anahtar güncellendi`);
console.log(`[qore-terminal] .env.local: ${parts.join(', ')}.`);
