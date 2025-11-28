
'use client';

import * as pdfjsLib from 'pdfjs-dist';

// Ensure the worker is set up
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.js';
}

interface ParsedTestData {
  [testName: string]: number;
}

const IGNORED_TERMS = ['expired', 'dil', 'pre', 'waste', 'mag', 'procell', 'system', 'clean', 'ISE', 'NA', 'K', 'CL', 'REF'];

/**
 * Extracts test data from a single PDF file by reconstructing lines based on text coordinates.
 * It identifies test names and their available counts, handles duplicates within the PDF, and sums the distinct counts.
 * This version uses a more flexible regex and applies validation rules as requested.
 * @param file The PDF file to parse.
 * @returns A promise that resolves to a record of test names and their aggregated counts.
 */
export async function parseReagentPDF(file: File): Promise<ParsedTestData> {
  const fileAsArrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: fileAsArrayBuffer }).promise;
  const testMap = new Map<string, Set<number>>();
  let headersFound = false;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lines: string[] = [];

    let currentLineItems: any[] = [];
    let lastY: number | null = null;
    
    const sortedItems = [...textContent.items].sort((a: any, b: any) => {
        if (a.transform[5] > b.transform[5]) return -1;
        if (a.transform[5] < b.transform[5]) return 1;
        if (a.transform[4] < b.transform[4]) return -1;
        if (a.transform[4] > b.transform[4]) return 1;
        return 0;
    });

    for (const item of sortedItems) {
      const y = (item as any).transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        lines.push(currentLineItems.map(i => (i as any).str).join(' '));
        currentLineItems = [];
      }
      currentLineItems.push(item);
      lastY = y;
    }
    lines.push(currentLineItems.map(i => (i as any).str).join(' '));

    // Flexible header check
    if (!headersFound) {
      headersFound = lines.some(line => /test/i.test(line) && /available/i.test(line));
    }
    
    // Regex to find a potential product at the start of the line and a number at the end.
    const productRegex = /^(?<test>\w+[\w\d-]*)\s+.*?\s+(?<available>[\d.,]+)\s*$/;

    for (const line of lines) {
        if (IGNORED_TERMS.some(term => line.toLowerCase().includes(term.toLowerCase()))) {
            continue;
        }

        const match = line.match(productRegex);
        
        if (match && match.groups) {
            const { test, available: availableRaw } = match.groups;
            
            const cleanedValue = parseInt(availableRaw.replace(/[.,\s]/g, ''), 10);
            
            // Apply validation rules: must be a valid number, > 0, and < 100,000
            if (test.length >= 3 && !isNaN(cleanedValue) && cleanedValue > 0 && cleanedValue < 100000) {
                const upperTest = test.toUpperCase();
                if (!testMap.has(upperTest)) {
                    testMap.set(upperTest, new Set<number>());
                }
                testMap.get(upperTest)?.add(cleanedValue);
            }
        }
    }
  }

  if (!headersFound) {
      throw new Error("No Test and Available Tests headers found in the document.");
  }

  const finalResult: ParsedTestData = {};
  for (const [testName, counts] of testMap) {
    // Sum of unique counts for this test in this PDF
    finalResult[testName] = Array.from(counts).reduce((a, b) => a + b, 0);
  }

  return finalResult;
}
