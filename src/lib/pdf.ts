
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
    const pageText = textContent.items.map((item: any) => (item as any).str).join(' ');
    allText += pageText + '\n';
  }
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
