#!/usr/bin/env node

/** Fail CI/builds when unresolved Git merge markers reach source files. */
const fs = require('node:fs');
const path = require('node:path');

const roots = ['src', 'scripts'];
const excludedDirectories = new Set(['node_modules', '.next', '.git']);
const excludedFiles = new Set([path.normalize('src/lib/exceljs-browser.min.js')]);
const markerPattern = /^(<<<<<<<|=======|>>>>>>>)/;
const findings = [];

function scan(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    if (excludedDirectories.has(path.basename(target))) return;
    for (const entry of fs.readdirSync(target)) scan(path.join(target, entry));
    return;
  }
  if (!stat.isFile() || excludedFiles.has(path.normalize(target))) return;

  // Source files are UTF-8 text in this repository. Reading binary-like files
  // is harmless, but null bytes let us skip them without producing noise.
  const content = fs.readFileSync(target, 'utf8');
  if (content.includes('\0')) return;
  content.split(/\r?\n/).forEach((line, index) => {
    if (markerPattern.test(line)) findings.push(`${target}:${index + 1}:${line}`);
  });
}

for (const root of roots) scan(root);

if (findings.length) {
  process.stderr.write('Çözümlenmemiş Git conflict marker bulundu:\n');
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Conflict marker source guard passed.\n');
