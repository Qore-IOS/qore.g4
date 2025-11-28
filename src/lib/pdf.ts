
'use client';
import Tesseract from 'tesseract.js';

// Dynamically load pdfjsLib from the global scope (window)
async function getPdfJs() {
  if (typeof window === 'undefined' || !(window as any).pdfjsLib) {
    // Wait a bit for the script to load if it's not there immediately
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!(window as any).pdfjsLib) {
      throw new Error("pdf.js library not found on window object. Check the script tag in layout.tsx.");
    }
  }
  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
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
