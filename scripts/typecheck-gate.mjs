/**
 * Typecheck ratchet kapısı (kalite raporu madde 2).
 *
 * Sorun: `next.config` `ignoreBuildErrors: true` olduğundan tip hataları
 * main'e serbestçe giriyordu (örn. PR #1458'de düzeltilen, üretimde
 * ReferenceError üreten tanımsız değişkenler). Mevcut ~580 hatayı bir günde
 * sıfırlamak gerçekçi değil; bu kapı bunun yerine RATCHET uygular:
 *
 *   KURAL: Hiçbir dosyanın hata sayısı baseline'dakini aşamaz ve
 *          baseline'da olmayan (temiz) bir dosyaya hata eklenemez.
 *
 * Dosya-başına SAYI karşılaştırılır (mesaj metni değil) — böylece union
 * sıralaması gibi kararsız mesaj farkları yanlış alarm üretmez, ama kirli
 * bir dosyaya yeni hata eklemek için önce eskilerden birini düzeltmek
 * gerekir. Temiz dosyalar temiz kalmaya zorlanır.
 *
 * Kullanım:
 *   node scripts/typecheck-gate.mjs            # kapı (CI bunu çalıştırır)
 *   node scripts/typecheck-gate.mjs --update   # baseline'ı mevcut durumdan
 *                                              # yeniden yaz (hata ERİTİNCE
 *                                              # sıkılaştırmak için; PR'da
 *                                              # gerekçesiyle commit'leyin)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(root, 'quality', 'typecheck-baseline.json');
const UPDATE = process.argv.includes('--update');

// --- tsc'yi çalıştır ---
const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--pretty', 'false', '-p', join(root, 'tsconfig.json')],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

if (tsc.error) {
  console.error('tsc çalıştırılamadı:', tsc.error.message);
  process.exit(1);
}

const output = `${tsc.stdout ?? ''}\n${tsc.stderr ?? ''}`;
const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

/** dosya → hata sayısı; dosya → ham hata satırları (raporlama için) */
const counts = new Map();
const rawLines = new Map();
for (const line of output.split('\n')) {
  const m = ERROR_RE.exec(line);
  if (!m) continue; // detay/devam satırları (girintili) sayılmaz
  const file = m[1].replace(/\\/g, '/');
  // Determinizm: .next/ üretilen dosyalardır; CI'da build çalışmadığı için
  // yoktur, lokalde ise build sonrası vardır. Ortama göre değişen girdiler
  // ratchet'e dahil edilmez. (next-env.d.ts aynı sebeple commit'lidir.)
  if (file.startsWith('.next/')) continue;
  counts.set(file, (counts.get(file) ?? 0) + 1);
  if (!rawLines.has(file)) rawLines.set(file, []);
  rawLines.get(file).push(line);
}

const totalErrors = [...counts.values()].reduce((a, b) => a + b, 0);

// tsc hata bulamadıysa ama sıfır-dışı çıktıysa (config/crash) güvenli tarafta kal.
if (totalErrors === 0 && tsc.status !== 0) {
  console.error('tsc beklenmedik şekilde başarısız oldu (parse edilebilir hata yok):');
  console.error(output.slice(0, 4000));
  process.exit(1);
}

if (UPDATE) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  const files = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ note: 'scripts/typecheck-gate.mjs --update ile üretildi', totalErrors, files }, null, 2) + '\n',
  );
  console.log(`Baseline güncellendi: ${totalErrors} hata, ${counts.size} dosya → ${BASELINE_PATH}`);
  process.exit(0);
}

// --- baseline'ı oku ---
let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`Baseline okunamadı: ${BASELINE_PATH}`);
  console.error('İlk kurulum için: node scripts/typecheck-gate.mjs --update');
  process.exit(1);
}

// --- kapı ---
const violations = [];
for (const [file, count] of counts) {
  const allowed = baseline.files?.[file] ?? 0;
  if (count > allowed) violations.push({ file, count, allowed });
}

if (violations.length > 0) {
  console.error('❌ TYPECHECK KAPISI: yeni tip hatası tespit edildi.\n');
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ${v.file}: ${v.count} hata (izin verilen: ${v.allowed})`);
    for (const line of rawLines.get(v.file) ?? []) console.error(`    ${line}`);
    console.error('');
  }
  console.error('Çözüm: yeni hataları düzeltin. Hata bilinçli olarak kabul');
  console.error('ediliyorsa (nadir olmalı) gerekçesiyle birlikte baseline\'ı');
  console.error("güncelleyin: node scripts/typecheck-gate.mjs --update");
  process.exit(1);
}

const baselineTotal = baseline.totalErrors ?? 0;
console.log(`✅ Typecheck kapısı geçti: ${totalErrors} bilinen hata (baseline: ${baselineTotal}), yeni hata yok.`);
if (totalErrors < baselineTotal) {
  console.log(`👏 ${baselineTotal - totalErrors} hata eritilmiş. Ratchet'i sıkılaştırın:`);
  console.log('   node scripts/typecheck-gate.mjs --update  (ve baseline değişikliğini commit\'leyin)');
}
