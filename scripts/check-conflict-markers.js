#!/usr/bin/env node

/** Fail CI/builds when unresolved Git merge markers reach source files. */
const { execFileSync } = require('node:child_process');

const markerPattern = '^(<<<<<<<|=======|>>>>>>>)';
const args = [
  '--line-number',
  '--regexp', markerPattern,
  'src',
  'scripts',
  '--glob', '!**/node_modules/**',
  '--glob', '!src/lib/exceljs-browser.min.js',
];

try {
  const output = execFileSync('rg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stderr.write('Çözümlenmemiş Git conflict marker bulundu:\n');
  process.stderr.write(output);
  process.exit(1);
} catch (error) {
  // ripgrep 1: no matches. Any other code means the guard itself failed.
  if (error?.status === 1) {
    process.stdout.write('Conflict marker source guard passed.\n');
    process.exit(0);
  }
  process.stderr.write(error?.stderr || String(error));
  process.exit(error?.status || 1);
}
