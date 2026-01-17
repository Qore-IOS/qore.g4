/**
 * Entity Resolver - Akilli Isim Eslestirme Modulu
 *
 * Bu modul dogal dil ifadelerini sistem verilerine esler:
 * - "Line 7" = "L7" = "7. Line" = "Laboratuvar 7" → ayni lab
 * - "TSH" = "tiroid" = "TSH ELECSYS 300 G2" → ayni urun
 * - Turkce karakter ve yazim hatalarini tolere eder
 */

import { adminDb } from '@/lib/firebase-admin';

// ============================================
// TYPES
// ============================================

export interface ResolvedEntity {
  type: 'hospital' | 'product' | 'device';
  id: string;
  name: string;
  confidence: number; // 0-1 arasi
  aliases: string[];
  originalQuery: string;
}

export interface EntityResolutionResult {
  hospitals: ResolvedEntity[];
  products: ResolvedEntity[];
  devices: ResolvedEntity[];
  unresolved: string[];
}

// ============================================
// TURKISH TEXT NORMALIZATION
// ============================================

const TURKISH_CHAR_MAP: Record<string, string> = {
  'ç': 'c', 'Ç': 'c',
  'ğ': 'g', 'Ğ': 'g',
  'ı': 'i', 'I': 'i', 'İ': 'i',
  'ö': 'o', 'Ö': 'o',
  'ş': 's', 'Ş': 's',
  'ü': 'u', 'Ü': 'u',
};

function normalizeTurkish(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map(char => TURKISH_CHAR_MAP[char] || char)
    .join('')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// FUZZY MATCHING (Levenshtein Distance)
// ============================================

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function fuzzyMatch(query: string, target: string, threshold: number = 0.7): number {
  const normalizedQuery = normalizeTurkish(query);
  const normalizedTarget = normalizeTurkish(target);

  // Exact match
  if (normalizedQuery === normalizedTarget) return 1.0;

  // Contains match
  if (normalizedTarget.includes(normalizedQuery)) return 0.9;
  if (normalizedQuery.includes(normalizedTarget)) return 0.85;

  // Word-level matching
  const queryWords = normalizedQuery.split(' ');
  const targetWords = normalizedTarget.split(' ');
  let matchedWords = 0;

  for (const qWord of queryWords) {
    if (qWord.length < 2) continue;
    for (const tWord of targetWords) {
      if (tWord.includes(qWord) || qWord.includes(tWord)) {
        matchedWords++;
        break;
      }
    }
  }

  const wordMatchScore = queryWords.length > 0
    ? matchedWords / queryWords.length
    : 0;

  if (wordMatchScore > 0.5) return 0.7 + (wordMatchScore * 0.2);

  // Levenshtein similarity
  const maxLen = Math.max(normalizedQuery.length, normalizedTarget.length);
  const distance = levenshteinDistance(normalizedQuery, normalizedTarget);
  const similarity = 1 - (distance / maxLen);

  return similarity >= threshold ? similarity : 0;
}

// ============================================
// HOSPITAL/LAB NAME PATTERNS
// ============================================

// "Line 7", "L7", "7. Line", "Lab 7", "Laboratuvar 7" gibi kaliplari yakala
const LAB_PATTERNS = [
  /line\s*(\d+)/i,           // Line 7, Line7
  /l(\d+)/i,                  // L7
  /(\d+)\.\s*line/i,          // 7. Line
  /lab(?:oratuvar)?\s*(\d+)/i, // Lab 7, Laboratuvar 7
  /(\d+)\.\s*lab/i,           // 7. Lab
];

function extractLabNumber(query: string): string | null {
  const normalized = normalizeTurkish(query);

  for (const pattern of LAB_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// ============================================
// PRODUCT ALIAS DATABASE
// ============================================

// Yaygin urun kisaltmalari ve alternatifleri
const PRODUCT_ALIASES: Record<string, string[]> = {
  // Tiroid testleri
  'TSH': ['tsh', 'tiroid', 'tiroid stimulan hormon', 'tsh elecsys', 'tsh 300', 'tsh g2'],
  'FT3': ['ft3', 'serbest t3', 'free t3', 't3'],
  'FT4': ['ft4', 'serbest t4', 'free t4', 't4', 'tiroksin'],

  // Kardiyak markerlar
  'TROPONIN': ['troponin', 'trop', 'troponin t', 'hs troponin', 'cardiac'],
  'BNP': ['bnp', 'pro bnp', 'nt probnp', 'kalp yetmezligi'],
  'CK-MB': ['ck mb', 'ckmb', 'kreatin kinaz'],

  // Enfeksiyon markerlari
  'CRP': ['crp', 'c reaktif protein', 'c-reaktif', 'enfeksiyon marker'],
  'PCT': ['pct', 'prokalsitonin', 'sepsis'],
  'IL-6': ['il6', 'il 6', 'interlökin 6', 'sitokin'],

  // Hematoloji
  'HBA1C': ['hba1c', 'a1c', 'glikozile hemoglobin', 'diyabet'],
  'FERRITIN': ['ferritin', 'demir', 'demir deposu'],
  'B12': ['b12', 'vitamin b12', 'kobalamin'],
  'FOLAT': ['folat', 'folik asit', 'b9'],

  // Biyokimya
  'KREATININ': ['kreatinin', 'kreatinin', 'böbrek', 'gfr'],
  'GLUKOZ': ['glukoz', 'kan şekeri', 'açlık şekeri', 'glucose'],
  'ALT': ['alt', 'sgpt', 'karaciğer enzimi'],
  'AST': ['ast', 'sgot', 'karaciğer'],

  // Koagülasyon
  'PT INR': ['pt', 'inr', 'protrombin', 'pıhtılaşma'],
  'APTT': ['aptt', 'ptt', 'aktive parsiyel'],
  'D-DIMER': ['d dimer', 'ddimer', 'fibrin'],

  // Immunoassay
  'PSA': ['psa', 'prostat', 'prostat spesifik antijen'],
  'AFP': ['afp', 'alfa fetoprotein', 'karaciğer tümör'],
  'CEA': ['cea', 'karsinoembriyonik', 'tümör marker'],
  'CA125': ['ca125', 'ca 125', 'over kanseri'],
  'CA19-9': ['ca199', 'ca 19 9', 'pankreas'],

  // Elektrolit
  'SODYUM': ['sodyum', 'na', 'sodium'],
  'POTASYUM': ['potasyum', 'k', 'potassium'],
  'KALSIYUM': ['kalsiyum', 'ca', 'calcium'],

  // Roche spesifik
  'ELECSYS': ['elecsys', 'roche elecsys', 'e601', 'e801'],
  'COBAS': ['cobas', 'roche cobas', 'c501', 'c701'],
};

function findProductAliasMatch(query: string): string[] {
  const normalized = normalizeTurkish(query);
  const matches: string[] = [];

  for (const [productKey, aliases] of Object.entries(PRODUCT_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeTurkish(alias);
      if (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)) {
        matches.push(productKey);
        break;
      }
    }
  }

  return matches;
}

// ============================================
// DATABASE RESOLUTION
// ============================================

// Cache for database entities
let hospitalCache: Array<{ id: string; name: string; kod?: string; aliases: string[] }> | null = null;
let productCache: Array<{ stokKodu: string; stokAdi: string; aliases: string[] }> | null = null;

async function loadHospitalCache() {
  if (hospitalCache) return hospitalCache;

  const snapshot = await adminDb.collection('hospitals').get();
  hospitalCache = snapshot.docs.map(doc => {
    const data = doc.data();
    const name = data.name || data.ad || '';
    const kod = data.kod || '';

    // Generate aliases
    const aliases: string[] = [name, kod].filter(Boolean);

    // Add variations
    if (name) {
      // "Ankara Hastanesi" -> ["ankara", "hastanesi", "ankara hastanesi"]
      const words = name.toLowerCase().split(/\s+/);
      aliases.push(...words);

      // Lab number extraction
      const labNum = extractLabNumber(name);
      if (labNum) {
        aliases.push(`line ${labNum}`, `l${labNum}`, `lab ${labNum}`);
      }
    }

    return {
      id: doc.id,
      name,
      kod,
      aliases,
    };
  });

  return hospitalCache;
}

async function loadProductCache() {
  if (productCache) return productCache;

  const snapshot = await adminDb.collection('productCodes').limit(2000).get();
  productCache = snapshot.docs.map(doc => {
    const data = doc.data();
    const stokKodu = data.stokKodu || '';
    const stokAdi = data.stokAdi || '';

    // Generate aliases from product name
    const aliases: string[] = [stokKodu, stokAdi].filter(Boolean);

    // Extract meaningful parts
    if (stokAdi) {
      const words = stokAdi.toLowerCase().split(/[\s\-_]+/);
      aliases.push(...words.filter(w => w.length > 2));

      // Add alias matches
      const aliasMatches = findProductAliasMatch(stokAdi);
      aliases.push(...aliasMatches);
    }

    return {
      stokKodu,
      stokAdi,
      aliases,
    };
  });

  return productCache;
}

// ============================================
// MAIN ENTITY RESOLUTION
// ============================================

export async function resolveEntities(query: string): Promise<EntityResolutionResult> {
  const result: EntityResolutionResult = {
    hospitals: [],
    products: [],
    devices: [],
    unresolved: [],
  };

  const normalizedQuery = normalizeTurkish(query);
  const queryWords = query.split(/[\s,]+/).filter(w => w.length > 1);

  // Load caches
  const hospitals = await loadHospitalCache();
  const products = await loadProductCache();

  // =====================
  // HOSPITAL RESOLUTION
  // =====================

  // Check for lab number pattern first
  const labNumber = extractLabNumber(query);
  if (labNumber) {
    // Find hospital matching lab number
    for (const hospital of hospitals) {
      if (hospital.aliases.some(a =>
        a.includes(`line ${labNumber}`) ||
        a.includes(`l${labNumber}`) ||
        a.includes(`lab ${labNumber}`) ||
        a.includes(labNumber)
      )) {
        result.hospitals.push({
          type: 'hospital',
          id: hospital.id,
          name: hospital.name,
          confidence: 0.95,
          aliases: hospital.aliases,
          originalQuery: query,
        });
      }
    }
  }

  // Fuzzy match against hospital names
  if (result.hospitals.length === 0) {
    for (const hospital of hospitals) {
      const score = Math.max(
        fuzzyMatch(query, hospital.name),
        ...hospital.aliases.map(a => fuzzyMatch(query, a))
      );

      if (score > 0.6) {
        result.hospitals.push({
          type: 'hospital',
          id: hospital.id,
          name: hospital.name,
          confidence: score,
          aliases: hospital.aliases,
          originalQuery: query,
        });
      }
    }
  }

  // Sort by confidence
  result.hospitals.sort((a, b) => b.confidence - a.confidence);
  result.hospitals = result.hospitals.slice(0, 5); // Top 5 matches

  // =====================
  // PRODUCT RESOLUTION
  // =====================

  // First check known aliases
  const aliasMatches = findProductAliasMatch(query);

  for (const product of products) {
    let score = 0;

    // Direct matches
    if (normalizeTurkish(product.stokKodu) === normalizedQuery) {
      score = 1.0;
    } else if (normalizeTurkish(product.stokAdi).includes(normalizedQuery)) {
      score = 0.9;
    } else if (aliasMatches.some(alias =>
      product.stokAdi.toLowerCase().includes(alias.toLowerCase()) ||
      product.aliases.some(a => a.toLowerCase().includes(alias.toLowerCase()))
    )) {
      score = 0.85;
    } else {
      // Fuzzy match
      score = Math.max(
        fuzzyMatch(query, product.stokKodu),
        fuzzyMatch(query, product.stokAdi),
        ...product.aliases.map(a => fuzzyMatch(query, a))
      );
    }

    if (score > 0.5) {
      result.products.push({
        type: 'product',
        id: product.stokKodu,
        name: product.stokAdi,
        confidence: score,
        aliases: product.aliases,
        originalQuery: query,
      });
    }
  }

  // Sort by confidence
  result.products.sort((a, b) => b.confidence - a.confidence);
  result.products = result.products.slice(0, 10); // Top 10 matches

  // Track unresolved terms
  if (result.hospitals.length === 0 && result.products.length === 0) {
    result.unresolved.push(query);
  }

  return result;
}

// ============================================
// SMART QUERY EXTRACTION
// ============================================

export interface ExtractedQueryIntent {
  action: 'query' | 'analyze' | 'compare' | 'list' | 'count' | 'trend';
  entities: EntityResolutionResult;
  timeRange?: { start?: Date; end?: Date; days?: number };
  filters: Record<string, unknown>;
  originalQuery: string;
}

const TIME_PATTERNS = [
  { pattern: /son\s*(\d+)\s*gun/i, extract: (m: RegExpMatchArray) => ({ days: parseInt(m[1]) }) },
  { pattern: /son\s*(\d+)\s*ay/i, extract: (m: RegExpMatchArray) => ({ days: parseInt(m[1]) * 30 }) },
  { pattern: /son\s*(\d+)\s*hafta/i, extract: (m: RegExpMatchArray) => ({ days: parseInt(m[1]) * 7 }) },
  { pattern: /bu\s*ay/i, extract: () => ({ days: 30 }) },
  { pattern: /bu\s*hafta/i, extract: () => ({ days: 7 }) },
  { pattern: /bugun/i, extract: () => ({ days: 1 }) },
  { pattern: /dun/i, extract: () => ({ days: 2 }) },
];

const ACTION_PATTERNS: Array<{ patterns: RegExp[]; action: ExtractedQueryIntent['action'] }> = [
  { patterns: [/kac\s*(tane|adet)?/i, /ne\s*kadar/i, /miktar/i, /sayisi/i], action: 'count' },
  { patterns: [/analiz/i, /incele/i, /degerlend/i], action: 'analyze' },
  { patterns: [/karsilast/i, /farki/i, /versus/i, /vs/i], action: 'compare' },
  { patterns: [/listele/i, /goster/i, /neler/i, /hangi/i], action: 'list' },
  { patterns: [/trend/i, /gidis/i, /zaman/i, /gecmis/i], action: 'trend' },
];

export async function extractQueryIntent(query: string): Promise<ExtractedQueryIntent> {
  const normalized = normalizeTurkish(query);

  // Extract entities
  const entities = await resolveEntities(query);

  // Extract time range
  let timeRange: ExtractedQueryIntent['timeRange'];
  for (const { pattern, extract } of TIME_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      timeRange = extract(match);
      break;
    }
  }

  // Determine action
  let action: ExtractedQueryIntent['action'] = 'query';
  for (const { patterns, action: detectedAction } of ACTION_PATTERNS) {
    if (patterns.some(p => p.test(query))) {
      action = detectedAction;
      break;
    }
  }

  // Extract additional filters
  const filters: Record<string, unknown> = {};

  // Status filters
  if (/acik|aktif|devam/i.test(query)) filters.status = 'open';
  if (/kapali|bitmis|cozulmus/i.test(query)) filters.status = 'closed';

  // Severity/priority
  if (/kritik|acil|onemli/i.test(query)) filters.priority = 'high';
  if (/dusuk|az/i.test(query)) filters.threshold = 'low';

  return {
    action,
    entities,
    timeRange,
    filters,
    originalQuery: query,
  };
}

// ============================================
// CACHE MANAGEMENT
// ============================================

export function clearEntityCaches() {
  hospitalCache = null;
  productCache = null;
}

// Refresh cache every 5 minutes
setInterval(() => {
  clearEntityCaches();
}, 5 * 60 * 1000);
