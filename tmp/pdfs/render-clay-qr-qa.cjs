const fs = require('fs');
const path = require('path');
const ts = require('../../functions/node_modules/typescript');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'output', 'pdf');
fs.mkdirSync(outDir, { recursive: true });

function transpile(sourcePath, outputPath, replacements = []) {
  let source = fs.readFileSync(sourcePath, 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
  }).outputText;
  fs.writeFileSync(outputPath, compiled);
}

const clientModulePath = path.join(__dirname, 'client-clay-qr-qa.cjs');
const serverModulePath = path.join(__dirname, 'server-clay-qr-qa.cjs');
transpile(
  path.join(root, 'src', 'lib', 'pdf', 'clay-tutanak.ts'),
  clientModulePath,
  [["import { loadPngWithSize } from '@/lib/pdf/tutanak-chrome';", 'const loadPngWithSize = async () => null;']],
);
transpile(path.join(root, 'functions', 'src', 'lib', 'clay-pdf.ts'), serverModulePath);

const clientClay = require(clientModulePath);
const serverClay = require(serverModulePath);

const asDataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const asB64 = (file) => fs.readFileSync(file).toString('base64');

async function fetchB64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset fetch failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

async function main() {
  const [semibold, extrabold, black] = await Promise.all([
    fetchB64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_600SemiBold.ttf'),
    fetchB64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_800ExtraBold.ttf'),
    fetchB64('https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_900Black.ttf'),
  ]);
  const noto = null;
  const invPath = path.join(root, 'public', 'invlogo.png');
  const qorePath = path.join(root, 'public', 'blk.png');
  const invSize = serverClay.pngSize(asB64(invPath));
  const qoreSize = serverClay.pngSize(asB64(qorePath));
  const clientKit = {
    fonts: { semibold, extrabold, black, noto },
    invLogo: { data: asDataUrl(invPath), ...invSize },
    qoreLogo: { data: asDataUrl(qorePath), ...qoreSize },
  };
  const serverAssets = {
    fonts: { semibold, extrabold, black, noto },
    invLogo: { b64: asB64(invPath), ...invSize },
    qoreLogo: { b64: asB64(qorePath), ...qoreSize },
  };

  const baseAction = {
    formNo: 'YS-T0056',
    qrPayload: 'https://qorengine.com/forms/technical/qa-styled-qr-20260724',
    labName: 'Beykoz Devlet Hastanesi Uzun Laboratuvar Adı',
    cihaz: 'BYKB1 Uzun Cihaz Açıklaması · SN 20K9-02',
    islemiYapan: 'İrem Ertuğrul',
    eslikEden: 'Yunus Şahan',
    baslangic: '24.07.2026 · 08:55',
    bitis: '24.07.2026 · 09:54',
    cihazDurumu: 'Çalışıyor',
    durumTone: 'green',
    chips: [
      { label: 'İşlem Tipi', value: 'Cihaz' },
      { label: 'İşlem Türü', value: 'Arıza' },
      { label: 'Tespit Edilen Arıza', value: 'Harici atık pompası basınç hatası ve uzun arıza açıklaması' },
    ],
    details: [{ label: 'Arıza ile İlişkili Testler', value: 'ALTL, ASTL, GLUC3 ve uzun test adı' }],
    aciklama: 'Rutin bakımları yapıldı, yıkamalar tamamlandı ve cihaz çalışır durumda teslim edildi.',
    operations: [
      { ad: 'Pipetleme / Transfer Ayarları & Kontrol', adet: 1 },
      { ad: 'Temel Fonksiyon Testleri', adet: 1 },
    ],
    parts: [],
    leftSign: { label: 'İşlemi Yapan', name: 'İrem Ertuğrul', date: '24.07.2026' },
    rightSign: { label: 'Kurum Yetkilisi', name: 'Ayşe Yılmaz', date: '24.07.2026' },
  };

  const technical = await clientClay.renderActionForm(clientKit, {
    ...baseAction,
    title: 'Teknik Servis Formu',
  });
  fs.writeFileSync(
    path.join(outDir, 'qa-teknik-servis-styled-qr.pdf'),
    Buffer.from(technical.output('arraybuffer')),
  );

  const application = await clientClay.renderActionForm(clientKit, {
    ...baseAction,
    title: 'Aplikasyon Formu',
    formNo: 'İE-A0080',
    qrPayload: 'https://qorengine.com/forms/application/qa-styled-qr-20260724',
    chips: [
      { label: 'İşlem Türü', value: 'Arıza' },
      { label: 'Tespit Edilen Arıza', value: 'Harici atık pompası basınç hatası ve uzun arıza açıklaması' },
      { label: 'Arıza ile İlişkili Testler', value: 'ALTL, ASTL, GLUC3 ve uzun test adı' },
    ],
  });
  fs.writeFileSync(
    path.join(outDir, 'qa-aplikasyon-styled-qr.pdf'),
    Buffer.from(application.output('arraybuffer')),
  );

  const transfer = await clientClay.renderTransferForm(clientKit, {
    title: 'Transfer Tutanağı',
    eyebrow: '',
    qrPayload: 'https://qorengine.com/transfer-gecmis/qa-styled-qr-20260724',
    tarihSaat: '24.07.2026 · 10:12',
    gonderen: {
      depo: 'Göztepe Merkez Depo Uzun Gönderen Birim Adı',
      teslimEden: 'İrem Ertuğrul',
    },
    teslimAlan: {
      kurum: 'Ümraniye Eğitim ve Araştırma Hastanesi Prenatal Tanı Laboratuvarı',
      firma: 'İnVitro Laboratuvar Sistemleri',
      teslimAlan: 'Ayşe Yılmaz',
    },
    rows: [{
      kod: '10385385',
      urun: 'Free Beta HGC Control uzun ürün açıklaması',
      lot: '0029',
      miad: '02.12.2027',
      adet: 1,
      birim: 'kutu',
    }],
    toplamKalem: 1,
    toplamAdet: 1,
  });
  fs.writeFileSync(
    path.join(outDir, 'qa-transfer-styled-qr.pdf'),
    Buffer.from(transfer.output('arraybuffer')),
  );

  const autoPdf = await serverClay.buildActionFormPdf({
    ...baseAction,
    title: 'Teknik Servis Formu',
    qrPayload: 'https://qorengine.com/forms/technical/qa-auto-styled-qr-20260724',
  }, serverAssets);
  fs.writeFileSync(path.join(outDir, 'qa-otomatik-teknik-styled-qr.pdf'), autoPdf);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
