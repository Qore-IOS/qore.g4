/**
 * Knowledge Base - RAG (Retrieval Augmented Generation) Altyapisi
 *
 * Bu modul harici dokumanlari (Roche kilavuzlari, teknik dokumanlar vb.)
 * AI'in erisebilecegi bir bilgi tabanina donusturur.
 *
 * Kullanim:
 * 1. Dokumanlari chunks'lara bol
 * 2. Her chunk icin embedding olustur (veya keyword-based search)
 * 3. Soru soruldugunda en alakali chunk'lari bul
 * 4. Context'e ekle
 */

import { adminDb } from '@/lib/firebase-admin';
import { anthropic, CLAUDE_MODEL } from './config';

// ============================================
// TYPES
// ============================================

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  metadata: {
    pageNumber?: number;
    section?: string;
    category: DocumentCategory;
    deviceModel?: string;
    productCode?: string;
    keywords: string[];
  };
  createdAt: Date;
}

export type DocumentCategory =
  | 'user_manual'        // Kullanim kilavuzu
  | 'technical_guide'    // Teknik kilavuz
  | 'troubleshooting'    // Sorun giderme
  | 'maintenance'        // Bakim
  | 'safety'             // Guvenlik
  | 'calibration'        // Kalibrasyon
  | 'reagent_info'       // Reaktif bilgisi
  | 'general';           // Genel

export interface Document {
  id: string;
  title: string;
  category: DocumentCategory;
  deviceModel?: string;
  brand?: string;
  uploadedAt: Date;
  uploadedBy: string;
  chunkCount: number;
  status: 'processing' | 'ready' | 'error';
}

export interface RetrievedKnowledge {
  chunks: DocumentChunk[];
  totalRelevance: number;
  sources: string[];
}

// ============================================
// KEYWORD EXTRACTION
// ============================================

// Turkce stop words
const STOP_WORDS = new Set([
  've', 'veya', 'ile', 'icin', 'bir', 'bu', 'su', 'o', 'da', 'de', 'mi', 'mu',
  'ne', 'ki', 'gibi', 'daha', 'en', 'cok', 'az', 'her', 'hic', 'kadar', 'sonra',
  'once', 'ise', 'olan', 'olarak', 'uzerine', 'gore', 'dolayi', 'tarafindan',
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'of', 'is', 'are',
]);

function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  // Extract unique keywords
  const uniqueKeywords = [...new Set(words)];

  // Also extract n-grams (2-word phrases)
  const ngrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(`${words[i]} ${words[i + 1]}`);
  }

  return [...uniqueKeywords, ...ngrams].slice(0, 50);
}

// ============================================
// TEXT CHUNKING
// ============================================

interface ChunkOptions {
  maxChunkSize: number;  // Max characters per chunk
  overlap: number;       // Overlap between chunks
  preserveSections: boolean;
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChunkSize: 1500,
  overlap: 200,
  preserveSections: true,
};

function chunkText(
  text: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): string[] {
  const chunks: string[] = [];

  // Try to split by sections first
  if (options.preserveSections) {
    const sections = text.split(/(?=^#{1,3}\s|\n#{1,3}\s)/gm);

    for (const section of sections) {
      if (section.length <= options.maxChunkSize) {
        if (section.trim()) {
          chunks.push(section.trim());
        }
      } else {
        // Section too large, split by paragraphs
        const paragraphs = section.split(/\n\n+/);
        let currentChunk = '';

        for (const para of paragraphs) {
          if (currentChunk.length + para.length < options.maxChunkSize) {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
          } else {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = para;
          }
        }

        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }
  } else {
    // Simple sliding window
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + options.maxChunkSize, text.length);
      chunks.push(text.slice(start, end).trim());
      start = end - options.overlap;
    }
  }

  return chunks.filter(c => c.length > 50); // Filter very short chunks
}

// ============================================
// DOCUMENT PROCESSING
// ============================================

export async function processDocument(
  content: string,
  title: string,
  category: DocumentCategory,
  metadata: {
    deviceModel?: string;
    brand?: string;
    uploadedBy: string;
  }
): Promise<Document> {
  const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create document record
  const document: Document = {
    id: documentId,
    title,
    category,
    deviceModel: metadata.deviceModel,
    brand: metadata.brand,
    uploadedAt: new Date(),
    uploadedBy: metadata.uploadedBy,
    chunkCount: 0,
    status: 'processing',
  };

  try {
    // Chunk the document
    const textChunks = chunkText(content);

    // Create chunk records
    const chunks: DocumentChunk[] = textChunks.map((chunk, index) => ({
      id: `${documentId}_chunk_${index}`,
      documentId,
      documentTitle: title,
      content: chunk,
      metadata: {
        pageNumber: Math.floor(index / 3) + 1, // Approximate
        section: extractSectionTitle(chunk),
        category,
        deviceModel: metadata.deviceModel,
        keywords: extractKeywords(chunk),
      },
      createdAt: new Date(),
    }));

    // Save to Firestore
    const batch = adminDb.batch();

    // Save document
    batch.set(adminDb.collection('knowledgeBase').doc(documentId), {
      ...document,
      chunkCount: chunks.length,
      status: 'ready',
    });

    // Save chunks
    for (const chunk of chunks) {
      batch.set(
        adminDb.collection('knowledgeBase').doc(documentId).collection('chunks').doc(chunk.id),
        chunk
      );
    }

    await batch.commit();

    console.log(`[KnowledgeBase] Document processed: ${title} (${chunks.length} chunks)`);

    return {
      ...document,
      chunkCount: chunks.length,
      status: 'ready',
    };
  } catch (error) {
    console.error('[KnowledgeBase] Error processing document:', error);

    // Update status to error
    await adminDb.collection('knowledgeBase').doc(documentId).set({
      ...document,
      status: 'error',
    });

    throw error;
  }
}

function extractSectionTitle(chunk: string): string {
  // Try to find a heading
  const headingMatch = chunk.match(/^#+\s*(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].slice(0, 100);
  }

  // Use first line as title
  const firstLine = chunk.split('\n')[0];
  return firstLine.slice(0, 100);
}

// ============================================
// KNOWLEDGE RETRIEVAL
// ============================================

export async function retrieveRelevantKnowledge(
  query: string,
  options: {
    category?: DocumentCategory;
    deviceModel?: string;
    maxResults?: number;
  } = {}
): Promise<RetrievedKnowledge> {
  const maxResults = options.maxResults || 5;
  const queryKeywords = extractKeywords(query);

  console.log(`[KnowledgeBase] Searching for: ${queryKeywords.slice(0, 10).join(', ')}`);

  // Get all documents (or filtered by category/device)
  let docsQuery = adminDb.collection('knowledgeBase')
    .where('status', '==', 'ready');

  if (options.category) {
    docsQuery = docsQuery.where('category', '==', options.category);
  }

  const docsSnapshot = await docsQuery.get();

  if (docsSnapshot.empty) {
    return { chunks: [], totalRelevance: 0, sources: [] };
  }

  // Search through chunks
  const allChunks: Array<DocumentChunk & { relevanceScore: number }> = [];

  for (const docDoc of docsSnapshot.docs) {
    const docData = docDoc.data() as Document;

    // Filter by device model if specified
    if (options.deviceModel && docData.deviceModel !== options.deviceModel) {
      continue;
    }

    const chunksSnapshot = await adminDb
      .collection('knowledgeBase')
      .doc(docDoc.id)
      .collection('chunks')
      .get();

    for (const chunkDoc of chunksSnapshot.docs) {
      const chunk = chunkDoc.data() as DocumentChunk;

      // Calculate relevance score
      const relevanceScore = calculateRelevance(queryKeywords, chunk);

      if (relevanceScore > 0.1) {
        allChunks.push({ ...chunk, relevanceScore });
      }
    }
  }

  // Sort by relevance and take top results
  allChunks.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topChunks = allChunks.slice(0, maxResults);

  // Extract unique sources
  const sources = [...new Set(topChunks.map(c => c.documentTitle))];

  return {
    chunks: topChunks,
    totalRelevance: topChunks.reduce((sum, c) => sum + c.relevanceScore, 0) / topChunks.length,
    sources,
  };
}

function calculateRelevance(queryKeywords: string[], chunk: DocumentChunk): number {
  const chunkKeywords = new Set(chunk.metadata.keywords);
  const contentLower = chunk.content.toLowerCase();

  let score = 0;
  let matchCount = 0;

  for (const keyword of queryKeywords) {
    // Direct keyword match
    if (chunkKeywords.has(keyword)) {
      score += 1;
      matchCount++;
    }

    // Content contains keyword
    if (contentLower.includes(keyword)) {
      score += 0.5;
      matchCount++;
    }

    // Partial match in keywords
    for (const chunkKw of chunkKeywords) {
      if (chunkKw.includes(keyword) || keyword.includes(chunkKw)) {
        score += 0.3;
        matchCount++;
        break;
      }
    }
  }

  // Normalize by query length
  return queryKeywords.length > 0 ? score / queryKeywords.length : 0;
}

// ============================================
// KNOWLEDGE-ENHANCED QUERY
// ============================================

export async function enhanceQueryWithKnowledge(
  query: string,
  systemData: string
): Promise<string> {
  // Retrieve relevant knowledge
  const knowledge = await retrieveRelevantKnowledge(query, { maxResults: 3 });

  if (knowledge.chunks.length === 0) {
    return systemData;
  }

  // Format knowledge as context
  const knowledgeContext = formatKnowledgeContext(knowledge);

  return `${systemData}

---

# Bilgi Tabanından Alınan Ek Bilgiler

${knowledgeContext}

---

**Not:** Yukarıdaki "Bilgi Tabanı" bölümü, yüklenen dokümanlardan (kullanım kılavuzları, teknik dokümanlar vb.) alınmıştır. Bu bilgileri de cevabınızda kullanabilirsiniz.`;
}

function formatKnowledgeContext(knowledge: RetrievedKnowledge): string {
  const sections: string[] = [];

  sections.push(`**Kaynaklar:** ${knowledge.sources.join(', ')}`);
  sections.push('');

  for (const chunk of knowledge.chunks) {
    sections.push(`### ${chunk.metadata.section || 'Bilgi'}`);
    sections.push(`*Kaynak: ${chunk.documentTitle}*`);
    sections.push('');
    sections.push(chunk.content);
    sections.push('');
  }

  return sections.join('\n');
}

// ============================================
// DOCUMENT MANAGEMENT
// ============================================

export async function listDocuments(): Promise<Document[]> {
  const snapshot = await adminDb.collection('knowledgeBase').get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as Document));
}

export async function deleteDocument(documentId: string): Promise<void> {
  // Delete all chunks first
  const chunksSnapshot = await adminDb
    .collection('knowledgeBase')
    .doc(documentId)
    .collection('chunks')
    .get();

  const batch = adminDb.batch();

  for (const chunkDoc of chunksSnapshot.docs) {
    batch.delete(chunkDoc.ref);
  }

  // Delete document
  batch.delete(adminDb.collection('knowledgeBase').doc(documentId));

  await batch.commit();
  console.log(`[KnowledgeBase] Document deleted: ${documentId}`);
}

// ============================================
// SAMPLE ROCHE KNOWLEDGE
// ============================================

// Ornek Roche cihaz bilgileri - gercek kilavuzlardan alinacak
export const SAMPLE_ROCHE_KNOWLEDGE = `
# Roche Cobas c501 Analyzer

## Genel Bakis
Cobas c501, yuksek hacimli klinik kimya analizleri icin tasarlanmis bir otoanalizordur.
- Saat basi 500 test kapasitesi
- 52 reaktif pozisyonu
- Otomatik kalibrasyon

## Sik Karsilasilan Hatalar

### Hata E001: Reaktif Seviye Dusuk
**Sebep:** Reaktif sisesindeki sivi seviyesi minimum altina dustu.
**Cozum:**
1. Reaktif sisesini kontrol edin
2. Gerekirse yeni reaktif yukleyin
3. Priming islemini baslatin

### Hata E002: Isik Kaynagi Hatasi
**Sebep:** Spektrofotometre lambasinda sorun.
**Cozum:**
1. Cihazi yeniden baslatin
2. Sorun devam ederse teknik servisi arayin
3. Lamba omru 2000 saat

### Hata E003: Sicaklik Sapmasii
**Sebep:** Inkubasyon sicakligi hedeften sapti.
**Cozum:**
1. Ortam sicakligini kontrol edin (18-32°C olmali)
2. Havalandirma acikliklarini kontrol edin
3. Sogutma sistemi bakimini yapin

## Bakim Programi

### Gunluk Bakim
- Prob yikama
- Atik tankini bosaltma
- ISE modulu temizligi

### Haftalik Bakim
- Reaktif pozisyonlarini temizleme
- Kuvet yikama
- Sistem testleri

### Aylik Bakim
- Kalibrasyon kontrolu
- Ayrintili temizlik
- Performans dogrulamasi

---

# Roche Cobas e801 Immunoassay Analyzer

## Genel Bakis
Cobas e801, elektrokemiluminesans (ECL) teknolojisi kullanan immunoassay analizordur.
- Saat basi 300 test kapasitesi
- Hassas Troponin, TSH, Vitamin D olcumu
- Tam otomatik operasyon

## Onemli Testler

### TSH (Tiroid Stimulan Hormon)
- Normal aralik: 0.27-4.2 mIU/L
- Yuksek TSH: Hipotiroidizm
- Dusuk TSH: Hipertiroidizm

### Troponin T hs
- Karar limiti: 14 ng/L
- AMI tanimi icin kritik
- Seri olcum onerilir

### Vitamin D (25-OH)
- Optimal seviye: 30-100 ng/mL
- <20 ng/mL: Eksiklik
- <10 ng/mL: Ciddi eksiklik

## Sorun Giderme

### "Probe Error" Hatasi
1. Probu temizleyin
2. Prob pozisyonunu kontrol edin
3. Hasar varsa degistirin

### "Temperature Error"
1. Sicaklik sensorunu kontrol edin
2. Ortam sicakligini dogrulayin
3. Sogutma fanini kontrol edin

---

# Reaktif Saklama Kosullari

## Genel Kurallar
- Orijinal ambalajda saklayin
- Direkt isinaktan koruyun
- Sicaklik izleme yapin

## Sicaklik Gereksinimleri

| Reaktif Tipi | Saklama | Kullanim |
|--------------|---------|----------|
| Genel kimya | 2-8°C | 15-25°C |
| Immunoassay | 2-8°C | Cihazda |
| Kalibrator | -20°C | 2-8°C |
| Kontrol | 2-8°C | 15-25°C |

## Stabilite Sureleri
- Acilmamis reaktif: Etiket tarihine kadar
- Acilmis reaktif: Genellikle 30 gun
- Kalibrasyon sonrasi: 7-28 gun (reaktife gore)
`;

// Initialize sample knowledge on first load
export async function initializeSampleKnowledge(): Promise<void> {
  const existingDocs = await listDocuments();

  if (existingDocs.length === 0) {
    console.log('[KnowledgeBase] Initializing sample Roche knowledge...');

    await processDocument(
      SAMPLE_ROCHE_KNOWLEDGE,
      'Roche Cobas Cihazlari Kilavuzu',
      'user_manual',
      {
        brand: 'Roche',
        uploadedBy: 'system',
      }
    );

    console.log('[KnowledgeBase] Sample knowledge initialized');
  }
}
