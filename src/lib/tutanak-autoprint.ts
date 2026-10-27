'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
  type Firestore,
} from './data/client';

import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  Packer,
} from 'docx';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';

// ---- Types ----
export type TutanakGroup = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  adet: number;
  anaBirim?: string;
  ambalajDegeri?: number | null;
  serials?: string[];
};

export type TutanakContext = {
  transferOrShipmentId: string;
  sourceDepotName: string;
  targetLabName: string;
  userName?: string;
  timestamp: Date;
};

// ---- Lab flag (tolerant to field naming) ----
export function isAutoTutanakEnabled(lab: any | null | undefined): boolean {
  if (!lab) return false;
  return Boolean(
    lab.autoTutanak ??
      lab.autoPrintTutanak ??
      lab.autoPrintNote ??
      lab.auto_print_tutanak
  );
}

// ---- Helpers: group items & build DOCX ----
export function buildGroupsFromItems(items: Array<{
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  seriNumarasi?: string;
  anaBirim?: string;
  ambalajDegeri?: number | null;
}>): TutanakGroup[] {
  const map = new Map<string, TutanakGroup>();
  for (const it of items) {
    const key = `${it.stokKodu}__${it.lotNumarasi || ''}__${it.miad || ''}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi || '',
        miad: it.miad || '',
        adet: 1,
        anaBirim: it.anaBirim || 'Adet',
        ambalajDegeri: it.ambalajDegeri ?? null,
        serials: it.seriNumarasi ? [it.seriNumarasi] : [],
      });
    } else {
      prev.adet += 1;
      if (it.seriNumarasi) prev.serials?.push(it.seriNumarasi);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.stokAdi.localeCompare(b.stokAdi)
  );
}

function createHeader(ctx: TutanakContext) {
  return [
    new Paragraph({ text: 'Teslim Tutanağı', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `Ref No: ${ctx.transferOrShipmentId}` }),
    new Paragraph({ text: `Kaynak Depo: ${ctx.sourceDepotName}` }),
    new Paragraph({ text: `Hedef Laboratuvar: ${ctx.targetLabName}` }),
    new Paragraph({ text: `İşlemi Yapan: ${ctx.userName || '-'}` }),
    new Paragraph({
      text: `Tarih: ${ctx.timestamp.toLocaleString('tr-TR')}`,
    }),
    new Paragraph({ text: '' }),
  ];
}

async function createTutanakDocx(
  groups: TutanakGroup[],
  ctx: TutanakContext
): Promise<Blob> {
  const head = new TableRow({
    children: ['Stok Adı', 'Stok Kodu', 'Lot', 'Miad', 'Adet', 'Birim'].map(
      (h) => new TableCell({ children: [new Paragraph({ text: h })] })
    ),
  });

  const body = groups.map(
    (g) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: g.stokAdi })] }),
          new TableCell({ children: [new Paragraph({ text: g.stokKodu })] }),
          new TableCell({
            children: [new Paragraph({ text: g.lotNumarasi || '-' })],
          }),
          new TableCell({ children: [new Paragraph({ text: g.miad || '-' })] }),
          new TableCell({
            children: [new Paragraph({ text: String(g.adet) })],
          }),
          new TableCell({
            children: [new Paragraph({ text: `${normalizeUnitLabel(g.anaBirim)}${formatUnitMultiplier(g) ? ` (${formatUnitMultiplier(g)})` : ''}` })],
          }),
        ],
      })
  );

  const serialRows: TableRow[] = [];
  const withSerials = groups.filter((g) => (g.serials?.length || 0) > 0);
  if (withSerials.length > 0) {
    serialRows.push(
      new TableRow({
        children: ['Stok Adı', 'Stok Kodu', 'Seri No'].map(
          (h) => new TableCell({ children: [new Paragraph({ text: h })] })
        ),
      })
    );
    withSerials.forEach((g) =>
      g.serials?.forEach((s) =>
        serialRows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: g.stokAdi })] }),
              new TableCell({ children: [new Paragraph({ text: g.stokKodu })] }),
              new TableCell({ children: [new Paragraph({ text: s })] }),
            ],
          })
        )
      )
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          ...createHeader(ctx),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            alignment: AlignmentType.CENTER,
            rows: [head, ...body],
          }),
          ...(withSerials.length > 0
            ? [
                new Paragraph({ text: '' }),
                new Paragraph({
                  text: 'Seri Numarası Detayları',
                  heading: HeadingLevel.HEADING_2,
                }),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: serialRows,
                }),
              ]
            : []),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

// ---- Printing via a hidden iframe (no new tab) ----
function printHtmlViaHiddenIframe(fullHtml: string) {
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {}
    try {
      URL.revokeObjectURL(url);
    } catch {}
  };

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print(); // Browser uses the last-used printer.
      } finally {
        setTimeout(cleanup, 1000);
      }
    }, 40);
  };

  document.body.appendChild(iframe);
  iframe.src = url;
}

function wrapForPrint(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  @media print { @page { size: A4; margin: 14mm; } }
  body { font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 16px; }
  h1,h2 { margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th,td { border: 1px solid #444; padding: 6px 8px; text-align: left; }
  th { background: #f3f3f3; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// ---- MAIN: print tutanak for a transferId (using saved data) ----
export async function autoPrintTutanakFromTransferId(
  db: Firestore,
  transferId: string,
  targetLabObj: any | null | undefined,
  currentUserName?: string
) {
  // 1) Respect lab flag
  if (!isAutoTutanakEnabled(targetLabObj)) return;

  // 2) Read saved transfer + items (so we print what is actually persisted)
  const tRef = doc(db, 'transfers', transferId);
  const tSnap = await getDoc(tRef);
  if (!tSnap.exists()) return;

  const t = tSnap.data() as any;
  const itemsSnap = await getDocs(collection(db, 'transfers', transferId, 'items'));
  const items = itemsSnap.docs.map((d) => d.data() as any);

  const groups = buildGroupsFromItems(
    items.map((i) => ({
      stokKodu: i.stokKodu,
      stokAdi: i.stokAdi,
      lotNumarasi: i.lotNumarasi,
      miad:
        typeof i.miad === 'string'
          ? i.miad
          : i.miad?.toDate
          ? (i.miad as Timestamp).toDate().toLocaleDateString('tr-TR')
          : i.miad || '',
      seriNumarasi: i.seriNumarasi,
      anaBirim: i.anaBirim,
      ambalajDegeri: i.ambalajDegeri,
    }))
  );

  const ctx: TutanakContext = {
    transferOrShipmentId: transferId,
    sourceDepotName:
      t.sourceDepotName || t.gonderenDepo || t.fromDepotName || '-',
    targetLabName:
      t.targetName || t.targetLabName || t.hedefKurum || (targetLabObj?.name || targetLabObj?.ad) || '-',
    userName: currentUserName || '',
    timestamp: t.timestamp?.toDate?.()
      ? (t.timestamp as Timestamp).toDate()
      : new Date(),
  };

  // 3) Build the SAME DOCX as detail page
  const docxBlob = await createTutanakDocx(groups, ctx);

  // 4) Convert DOCX -> HTML (so we can print in browser) and print silently
  try {
    // dynamic import keeps bundle smaller; works in browser
    const mammoth: any = await import('mammoth/mammoth.browser');
    const { value: bodyHtml } = await mammoth.convertToHtml({
      arrayBuffer: await docxBlob.arrayBuffer(),
    });
    const html = wrapForPrint(
      `Teslim Tutanağı - ${ctx.transferOrShipmentId}`,
      bodyHtml
    );
    printHtmlViaHiddenIframe(html);
  } catch (e) {
    console.error('[AutoTutanak] DOCX->HTML convert failed, fallback to plain table', e);
    // Fallback: minimal HTML (still prints)
    const fallbackBody = `
      <h1>Teslim Tutanağı</h1>
      <div><strong>Ref No:</strong> ${ctx.transferOrShipmentId}</div>
      <div><strong>Kaynak Depo:</strong> ${ctx.sourceDepotName}</div>
      <div><strong>Hedef Laboratuvar:</strong> ${ctx.targetLabName}</div>
      <div><strong>İşlemi Yapan:</strong> ${ctx.userName || '-'}</div>
      <div><strong>Tarih:</strong> ${ctx.timestamp.toLocaleString('tr-TR')}</div>
      <table>
        <thead><tr><th>Stok Adı</th><th>Stok Kodu</th><th>Lot</th><th>Miad</th><th>Adet</th><th>Birim</th></tr></thead>
        <tbody>
          ${groups
            .map(
              (g) => `<tr>
            <td>${g.stokAdi}</td>
            <td>${g.stokKodu}</td>
            <td>${g.lotNumarasi || '-'}</td>
            <td>${g.miad || '-'}</td>
            <td>${g.adet}</td>
            <td>${normalizeUnitLabel(g.anaBirim)}${formatUnitMultiplier(g) ? ` (${formatUnitMultiplier(g)})` : ''}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
    printHtmlViaHiddenIframe(wrapForPrint(`Teslim Tutanağı - ${ctx.transferOrShipmentId}`, fallbackBody));
  }
}

// Re-export maybeAutoPrintTutanak from tutanak.ts for backward compatibility
export { maybeAutoPrintTutanak } from './tutanak';
