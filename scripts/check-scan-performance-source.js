#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const panelFiles = [
  'src/components/ana-panel.tsx',
  'src/components/direkt-transfer-panel.tsx',
];

const forbiddenPatterns = [
  ['legacy finish callback', /\bfinishScanJsMeasurement\b/g],
  ['legacy scan ms setter', /\bsetLastScanMs\b/g],
  ['legacy scan JS setter', /\bsetLastScanJsMs\b/g],
];

const errors = [];
for (const relativePath of panelFiles) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  for (const [label, pattern] of forbiddenPatterns) {
    const matches = source.match(pattern) ?? [];
    if (matches.length > 0) {
      errors.push(`${relativePath}: ${label} found ${matches.length} time(s)`);
    }
  }

  const measurementStarts = source.match(/\bstartScanMeasurement\(\)/g) ?? [];
  if (measurementStarts.length !== 1) {
    errors.push(
      `${relativePath}: expected exactly one startScanMeasurement() call, found ${measurementStarts.length}`,
    );
  }
}

if (errors.length > 0) {
  console.error('Scan performance source guard failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Scan performance source guard passed.');
