export type TestNameMatchStatus = 'exact' | 'normalized' | 'alias' | 'fuzzy' | 'unknown';

export type TestNameCandidate = {
  id: string;
  displayName: string;
  aliases?: string[];
};

export type TestNameMatch = {
  input: string;
  normalizedInput: string;
  candidate: TestNameCandidate | null;
  status: TestNameMatchStatus;
  score: number;
  matchedBy?: string;
};

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
};

const ROMAN_NUMERAL_MAP: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

function foldLocaleChars(value: string): string {
  return value.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => TURKISH_CHAR_MAP[ch] ?? ch);
}

function replaceStandaloneRomanNumerals(value: string): string {
  return value.replace(/(^|[^a-z0-9])(i{1,3}|iv|v|vi{0,3}|ix|x)(?=$|[^a-z0-9])/gi, (match, prefix, roman) => {
    const normalizedRoman = String(roman).toLowerCase();
    return `${prefix}${ROMAN_NUMERAL_MAP[normalizedRoman] ?? normalizedRoman}`;
  });
}

/**
 * Cihaz/PDF/TXT çıktılarındaki test adlarını karşılaştırma anahtarına indirger.
 * Örn: "A-HCV II", "A-HCV 2", "a.hcv-2" → "ahcv2".
 */
export function normalizeTestName(value: string | null | undefined): string {
  return replaceStandaloneRomanNumerals(foldLocaleChars(String(value ?? '')))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

export function testNameSimilarity(a: string, b: string): number {
  const left = normalizeTestName(a);
  const right = normalizeTestName(b);
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) return 1;
  return 1 - levenshtein(left, right) / maxLen;
}

export function matchTestName(
  input: string,
  candidates: TestNameCandidate[],
  options: { fuzzyThreshold?: number } = {}
): TestNameMatch {
  const fuzzyThreshold = options.fuzzyThreshold ?? 0.9;
  const normalizedInput = normalizeTestName(input);

  if (!normalizedInput) {
    return { input, normalizedInput, candidate: null, status: 'unknown', score: 0 };
  }

  let best: TestNameMatch = { input, normalizedInput, candidate: null, status: 'unknown', score: 0 };

  for (const candidate of candidates) {
    const names = [candidate.displayName, ...(candidate.aliases ?? [])].filter(Boolean);
    for (const name of names) {
      const normalizedName = normalizeTestName(name);
      if (!normalizedName) continue;

      if (input.trim().toLocaleLowerCase('tr-TR') === name.trim().toLocaleLowerCase('tr-TR')) {
        return { input, normalizedInput, candidate, status: 'exact', score: 1, matchedBy: name };
      }

      if (normalizedInput === normalizedName) {
        return {
          input,
          normalizedInput,
          candidate,
          status: name === candidate.displayName ? 'normalized' : 'alias',
          score: 1,
          matchedBy: name,
        };
      }

      const score = testNameSimilarity(normalizedInput, normalizedName);
      if (score > best.score) {
        best = { input, normalizedInput, candidate, status: 'fuzzy', score, matchedBy: name };
      }
    }
  }

  return best.score >= fuzzyThreshold ? best : { input, normalizedInput, candidate: null, status: 'unknown', score: best.score };
}
