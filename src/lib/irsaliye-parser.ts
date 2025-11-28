'use client';
import { ProductCode } from './types';
import { normalizeMiad } from './date';

export interface IrsaliyeParseResult {
  stokKodu: string;
  quantity: number;
  lot?: string;
  miad?: string;
  rawLine: string;
}

const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
};

const parseQuantity = (value: string): number => {
  const num = parseInt(value.replace(/\D/g, ''), 10);
  return isNaN(num) ? 0 : num;
};

export function parseIrsaliyeText(text: string, productCodes: ProductCode[]): IrsaliyeParseResult[] {
  const lines = text.split('\n').filter(line => line.trim().length > 10);
  const results: IrsaliyeParseResult[] = [];
  const productMap = new Map(productCodes.map(p => [p.stokKodu, p]));

  // Regex definitions
  const dateRegex = /\b(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})\b/g;
  const lotRegex = /(?:lot|parti|batch)\s*[:.]?\s*([a-z0-9-]+)/i;
  const qtyRegex = /(\d+)\s*(?:adet|kutu|ad|box|pcs|ea|koli)/i;
  const trailingNumberRegex = /(\d+)\s*$/;
  const leadingNumberRegex = /^(\d+)\s+/;


  for (const line of lines) {
    let stokKodu: string | undefined;

    // Find known product code first
    for (const product of productCodes) {
      if (line.includes(product.stokKodu)) {
        stokKodu = product.stokKodu;
        break;
      }
    }
    
    if (!stokKodu) {
        for (const product of productCodes) {
            if (line.toLowerCase().includes(product.stokAdi.toLowerCase())) {
                stokKodu = product.stokKodu;
                break;
            }
        }
    }

    if (!stokKodu) continue;

    const normalizedLine = normalizeText(line);
    
    // Extract data using regex
    const dateMatch = line.match(dateRegex);
    const lotMatch = normalizedLine.match(lotRegex);
    const qtyMatch = normalizedLine.match(qtyRegex);
    
    const miad = dateMatch ? normalizeMiad(dateMatch[0]) : undefined;
    const lot = lotMatch ? lotMatch[1].toUpperCase() : undefined;
    
    let quantity: number | undefined;
    if (qtyMatch) {
      quantity = parseQuantity(qtyMatch[1]);
    } else {
      const trailingMatch = line.match(trailingNumberRegex);
      if (trailingMatch) {
        quantity = parseQuantity(trailingMatch[1]);
      } else {
        const leadingMatch = line.match(leadingNumberRegex);
        if(leadingMatch) {
            quantity = parseQuantity(leadingMatch[1]);
        }
      }
    }

    if (stokKodu && quantity !== undefined && quantity > 0) {
      results.push({ stokKodu, quantity, lot, miad, rawLine: line.trim() });
    }
  }

  return results;
}
