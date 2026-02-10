
'use client';
import Tesseract from 'tesseract.js';

const PDF_JS_VERSION = '4.5.136';
const PDF_JS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}`;

let pdfJsPromise: Promise<any> | null = null;

/**
 * Lazily loads PDF.js only when needed (not on every page load)
 * This eliminates the preload warning and reduces initial bundle size
 */
async function getPdfJs() {
  if (typeof window === 'undefined') {
    throw new Error("PDF.js can only be used in browser environment");
  }

  // Return cached promise if already loading/loaded
  if (pdfJsPromise) {
    return pdfJsPromise;
  }

  // Check if already loaded
  if ((window as any).pdfjsLib) {
    const pdfjsLib = (window as any).pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDF_JS_CDN}/pdf.worker.min.mjs`;
    return pdfjsLib;
  }

  // Dynamically load the script
  pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDF_JS_CDN}/pdf.min.mjs`;
    script.type = 'module';
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      // Give a moment for the module to initialize
      setTimeout(() => {
        if ((window as any).pdfjsLib) {
          const pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDF_JS_CDN}/pdf.worker.min.mjs`;
          resolve(pdfjsLib);
        } else {
          reject(new Error("PDF.js loaded but pdfjsLib not found on window"));
        }
      }, 100);
    };

    script.onerror = () => {
      pdfJsPromise = null;
      reject(new Error("Failed to load PDF.js library"));
    };

    document.head.appendChild(script);
  });

  return pdfJsPromise;
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await getPdfJs();
  const fileAsArrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: fileAsArrayBuffer }).promise;
  let allText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Group text items by Y-position to preserve table row structure
    // Each item has transform: [scaleX, skewX, skewY, scaleY, x, y]
    const lineMap = new Map<number, { x: number; str: string }[]>();
    const yTolerance = 3; // items within 3 units Y-distance are on the same line

    for (const item of textContent.items) {
      const str = (item as any).str;
      if (!str || str.trim() === '') continue;

      const x = (item as any).transform[4];
      const y = Math.round((item as any).transform[5]);

      // Find existing line within tolerance
      let matchedY: number | undefined;
      for (const [existingY] of lineMap) {
        if (Math.abs(existingY - y) <= yTolerance) {
          matchedY = existingY;
          break;
        }
      }

      const targetY = matchedY ?? y;
      if (!lineMap.has(targetY)) {
        lineMap.set(targetY, []);
      }
      lineMap.get(targetY)!.push({ x, str });
    }

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
    const sortedLines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0]);

    // Build text: items sorted left-to-right within each line
    const pageLines: string[] = [];
    for (const [, items] of sortedLines) {
      items.sort((a, b) => a.x - b.x);
      const lineText = items.map(it => it.str).join(' ');
      if (lineText.trim()) {
        pageLines.push(lineText.trim());
      }
    }

    allText += pageLines.join('\n') + '\n';
  }

  console.log('[PDF Extract] Raw text output:\n', allText);
  return allText;
}

export async function renderFirstPageToBlob(file: File): Promise<Blob | null> {
    const pdfjsLib = await getPdfJs();
    const fileAsArrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: fileAsArrayBuffer }).promise;
    if (pdf.numPages === 0) return null;
    
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
    }
    return null;
}

export async function ocrBlob(imageBlob: Blob): Promise<string> {
    const worker = await Tesseract.createWorker('tur');
    const { data: { text } } = await worker.recognize(imageBlob as File);
    await worker.terminate();
    return text;
}
